/**
 * Enregistrement des handlers IPC. Seul point d'entrée du renderer vers le disque
 * et les process. Tout garde-fou est vérifié ici, avant le moindre `spawn`.
 */
import { basename, join } from "node:path";
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { CHANNELS } from "../../shared/ipc-contract.js";
import type {
  CommandResult,
  CustomAction,
  EnvRef,
  MigrationsForEnv,
  Project,
  WorkerConfig,
  WorkerRef,
} from "../../shared/types.js";
import type { ConfirmedRequest, OutputHandle, TerminalHandle } from "../../shared/ipc-contract.js";
import { assertConfirmed, requirementFor } from "../domain/guard.js";
import { loadCustomActions } from "../domain/custom-actions-loader.js";
import {
  listMigrationFiles,
  resolveMigrationsDir,
  toMigrationsReport,
} from "../domain/migrations-matrix.js";
import type { ProjectStore } from "../domain/project-store.js";
import {
  d1ExecuteArgs,
  d1InfoArgs,
  deployArgs,
  deploymentsListArgs,
  devArgs,
  formatCommandLine,
  migrationsApplyArgs,
  migrationsListArgs,
  tailArgs,
} from "../domain/wrangler-cli.js";
import {
  localExplorerUrl,
  devServerUrl,
  parsePendingMigrations,
  stripAnsi,
} from "../domain/wrangler-parsers.js";
import { run } from "../domain/wrangler-runner.js";
import type { DevServerHub } from "../services/dev-server-hub.js";
import type { OutputHub } from "../services/output-hub.js";
import type { PtyHub } from "../services/pty-hub.js";
import type { WorkerRegistry } from "../services/worker-registry.js";

export interface IpcDeps {
  store: ProjectStore;
  registry: WorkerRegistry;
  output: OutputHub;
  pty: PtyHub;
  devServers: DevServerHub;
  getWindow: () => BrowserWindow | null;
}

export function registerIpc(deps: IpcDeps): void {
  const { store, registry, output, pty, devServers, getWindow } = deps;

  /** Vérifie la confirmation requise pour un env avant toute écriture distante. */
  const guard = async (
    workerId: string,
    env: EnvRef,
    request?: ConfirmedRequest,
  ): Promise<void> => {
    const config = await registry.envConfig(workerId, env.name);
    assertConfirmed(requirementFor(env, config), request?.confirmationText);
  };

  /** Nom de la base D1 derrière un binding, pour l'env visé. */
  const databaseFor = async (
    workerId: string,
    dbBinding: string,
    envName: string,
  ): Promise<{ databaseName: string; migrationsDir: string }> => {
    const env = await registry.envConfig(workerId, envName);
    const binding = env?.bindings.d1.find((candidate) => candidate.binding === dbBinding);
    if (!binding) {
      throw new Error(`Binding D1 « ${dbBinding} » absent de l'environnement « ${envName} ».`);
    }
    if (!binding.databaseName) {
      throw new Error(`La base de « ${dbBinding} » n'a pas de database_name dans la config.`);
    }
    return { databaseName: binding.databaseName, migrationsDir: binding.migrationsDir };
  };

  // --- Registre de projets -------------------------------------------------

  ipcMain.handle(CHANNELS.projectsList, (): Promise<Project[]> => store.list());

  ipcMain.handle(CHANNELS.projectsAdd, async (): Promise<Project | null> => {
    const window = getWindow();
    const result = window
      ? await dialog.showOpenDialog(window, {
          properties: ["openDirectory", "createDirectory"],
          title: "Ajouter un projet",
        })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    const project = await store.add(path, basename(path));
    await registry.scan(project.id);
    return project;
  });

  ipcMain.handle(CHANNELS.projectsRemove, (_event, projectId: string): Promise<void> =>
    store.remove(projectId),
  );

  ipcMain.handle(
    CHANNELS.projectsRename,
    (_event, projectId: string, name: string): Promise<void> => store.rename(projectId, name),
  );

  ipcMain.handle(CHANNELS.projectsRescan, (_event, projectId: string): Promise<WorkerRef[]> =>
    registry.scan(projectId),
  );

  ipcMain.handle(
    CHANNELS.projectsSetProdLike,
    (_event, projectId: string, workerId: string, envNames: string[]): Promise<void> =>
      store.setProdLike(projectId, workerId, envNames),
  );

  // --- Lecture Worker ------------------------------------------------------

  ipcMain.handle(CHANNELS.workersGet, async (_event, workerId: string): Promise<WorkerConfig> => {
    return (await registry.resolve(workerId)).config;
  });

  // --- Compte Cloudflare ---------------------------------------------------

  ipcMain.handle(
    CHANNELS.accountWhoami,
    async (_event, workerId: string): Promise<CommandResult> => {
      const { command, prefix, cwd } = await registry.resolve(workerId);
      return run({ command, args: [...prefix, "whoami"], cwd });
    },
  );

  ipcMain.handle(
    CHANNELS.accountLogin,
    async (_event, workerId: string): Promise<TerminalHandle> => {
      const { command, prefix, cwd } = await registry.resolve(workerId);
      // `login` ouvre un navigateur et attend une entrée : il faut un vrai TTY.
      return { sessionId: pty.spawn({ command, args: [...prefix, "login"], cwd }) };
    },
  );

  // --- Migrations D1 -------------------------------------------------------

  ipcMain.handle(
    CHANNELS.migrationsList,
    async (_event, workerId: string, dbBinding: string, env: EnvRef): Promise<MigrationsForEnv> => {
      const { command, prefix, cwd } = await registry.resolve(workerId);
      const { databaseName, migrationsDir } = await databaseFor(workerId, dbBinding, env.name);
      const files = await listMigrationFiles(resolveMigrationsDir(cwd, migrationsDir));
      const result = await run({
        command,
        args: [...prefix, ...migrationsListArgs(databaseName, env)],
        cwd,
      });
      if (!result.ok) {
        // Une erreur wrangler est remontée telle quelle : l'UI laisse la case
        // « inconnue » plutôt que de prétendre savoir.
        return {
          env,
          status: "error",
          migrations: [],
          error:
            stripAnsi(result.stderr || result.stdout).trim() || `Échec (code ${result.exitCode}).`,
        };
      }
      return toMigrationsReport(env, files, parsePendingMigrations(result.stdout));
    },
  );

  ipcMain.handle(
    CHANNELS.migrationsApply,
    async (
      _event,
      workerId: string,
      dbBinding: string,
      env: EnvRef,
      request?: ConfirmedRequest,
    ): Promise<OutputHandle> => {
      await guard(workerId, env, request);
      const { command, prefix, cwd } = await registry.resolve(workerId);
      const { databaseName } = await databaseFor(workerId, dbBinding, env.name);
      const tab = await output.runInTab(
        `Migrations · ${env.name} (${env.location === "local" ? "local" : "distant"})`,
        { command, args: [...prefix, ...migrationsApplyArgs(databaseName, env)], cwd },
      );
      return { tabId: tab.id };
    },
  );

  // --- Serveur de dev ------------------------------------------------------

  ipcMain.handle(
    CHANNELS.devServerStart,
    async (_event, workerId: string): Promise<TerminalHandle> => {
      const { command, prefix, cwd } = await registry.resolve(workerId);
      return {
        sessionId: devServers.start({
          workerId,
          command,
          args: [...prefix, ...devArgs()],
          cwd,
        }),
      };
    },
  );

  ipcMain.handle(CHANNELS.devServerStop, (_event, workerId: string): void => {
    devServers.stop(workerId);
  });

  ipcMain.handle(CHANNELS.devServerStatus, (_event, workerId: string) =>
    devServers.status(workerId),
  );

  ipcMain.handle(CHANNELS.devServerOpenApp, async (_event, workerId: string): Promise<void> => {
    const { port } = devServers.status(workerId);
    if (port === null) throw new Error("Le serveur de dev n'a pas encore annoncé de port.");
    await shell.openExternal(devServerUrl(port));
  });

  ipcMain.handle(
    CHANNELS.devServerOpenExplorer,
    async (_event, workerId: string): Promise<void> => {
      const { port } = devServers.status(workerId);
      if (port === null) throw new Error("Le serveur de dev n'a pas encore annoncé de port.");
      // Corral lie vers le Local Explorer de wrangler, il ne le duplique pas.
      await shell.openExternal(localExplorerUrl(port));
    },
  );

  // --- Terminal PTY --------------------------------------------------------

  ipcMain.handle(CHANNELS.terminalWrite, (_event, sessionId: string, data: string): void => {
    pty.write(sessionId, data);
  });

  ipcMain.handle(
    CHANNELS.terminalResize,
    (_event, sessionId: string, cols: number, rows: number): void => {
      pty.resize(sessionId, cols, rows);
    },
  );

  ipcMain.handle(CHANNELS.terminalKill, (_event, sessionId: string): void => {
    pty.kill(sessionId);
  });

  // --- Garde-fous ----------------------------------------------------------

  ipcMain.handle(CHANNELS.guardCheck, async (_event, workerId: string, env: EnvRef) =>
    requirementFor(env, await registry.envConfig(workerId, env.name)),
  );

  // --- v0.2 : déploiement, SQL, infos, logs --------------------------------

  ipcMain.handle(
    CHANNELS.deployRun,
    async (
      _event,
      workerId: string,
      env: EnvRef,
      options: { applyMigrationsFirst?: boolean } = {},
      request?: ConfirmedRequest,
    ): Promise<OutputHandle> => {
      await guard(workerId, env, request);
      const { command, prefix, cwd } = await registry.resolve(workerId);
      const steps = options.applyMigrationsFirst
        ? ["Migrations avant déploiement activées — lancez-les d'abord depuis la matrice."]
        : [];
      const tab = await output.runInTab(
        `Déploiement · ${env.name}`,
        { command, args: [...prefix, ...deployArgs(env.name)], cwd },
        steps,
      );
      return { tabId: tab.id };
    },
  );

  ipcMain.handle(
    CHANNELS.d1Execute,
    async (
      _event,
      workerId: string,
      dbBinding: string,
      env: EnvRef,
      sql: string,
      request?: ConfirmedRequest,
    ): Promise<OutputHandle> => {
      await guard(workerId, env, request);
      const { command, prefix, cwd } = await registry.resolve(workerId);
      const { databaseName } = await databaseFor(workerId, dbBinding, env.name);
      // Le SQL est un argument de `spawn`, jamais une portion de ligne shell.
      const tab = await output.runInTab(`SQL · ${env.name}`, {
        command,
        args: [...prefix, ...d1ExecuteArgs(databaseName, env, sql)],
        cwd,
      });
      return { tabId: tab.id };
    },
  );

  ipcMain.handle(
    CHANNELS.d1Info,
    async (_event, workerId: string, dbBinding: string, env: EnvRef): Promise<OutputHandle> => {
      const { command, prefix, cwd } = await registry.resolve(workerId);
      const { databaseName } = await databaseFor(workerId, dbBinding, env.name);
      const tab = await output.runInTab(`Base · ${env.name}`, {
        command,
        args: [...prefix, ...d1InfoArgs(databaseName, env)],
        cwd,
      });
      return { tabId: tab.id };
    },
  );

  ipcMain.handle(
    CHANNELS.deploymentsList,
    async (_event, workerId: string, env: EnvRef): Promise<OutputHandle> => {
      const { command, prefix, cwd } = await registry.resolve(workerId);
      const tab = await output.runInTab(`Déploiements · ${env.name}`, {
        command,
        args: [...prefix, ...deploymentsListArgs(env.name)],
        cwd,
      });
      return { tabId: tab.id };
    },
  );

  ipcMain.handle(
    CHANNELS.logsTail,
    async (_event, workerId: string, env: EnvRef): Promise<TerminalHandle> => {
      const { command, prefix, cwd } = await registry.resolve(workerId);
      return {
        sessionId: pty.spawn({ command, args: [...prefix, ...tailArgs(env.name)], cwd }),
      };
    },
  );

  // --- Actions personnalisées ----------------------------------------------

  ipcMain.handle(
    CHANNELS.customActionsList,
    async (_event, projectId: string): Promise<CustomAction[]> => {
      const project = await store.get(projectId);
      return project ? loadCustomActions(project.path) : [];
    },
  );

  ipcMain.handle(
    CHANNELS.customActionsRun,
    async (_event, projectId: string, actionId: string): Promise<OutputHandle | TerminalHandle> => {
      const project = await store.get(projectId);
      if (!project) throw new Error(`Projet inconnu : ${projectId}`);
      const action = (await loadCustomActions(project.path)).find(
        (candidate) => candidate.id === actionId,
      );
      if (!action) throw new Error(`Action inconnue : ${actionId}`);

      const cwd = join(project.path, action.cwd);
      // Seules les actions personnalisées passent par un shell : c'est l'utilisateur
      // qui a écrit la ligne dans son propre dépôt.
      if (action.interactive) {
        return {
          sessionId: pty.spawn({ command: action.command, args: [], cwd, useShell: true }),
        };
      }
      const shellPath = process.env.SHELL ?? "/bin/sh";
      const args = ["-lc", action.command];
      const tab = await output.runInTab(action.label, {
        command: shellPath,
        args,
        cwd,
      });
      output.line(tab.id, formatCommandLine(shellPath, args), "info");
      return { tabId: tab.id };
    },
  );
}
