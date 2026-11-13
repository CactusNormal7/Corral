/**
 * Source de vérité du contrat IPC : noms de canaux et signatures.
 * Le renderer n'accède au main que par ces canaux, via le preload.
 */
import type {
  CommandResult,
  CustomAction,
  DevServerStatus,
  EnvRef,
  GuardRequirement,
  MigrationsForEnv,
  OutputLine,
  OutputTab,
  Project,
  WorkerConfig,
  WorkerRef,
} from "./types.js";

export const CHANNELS = {
  projectsList: "projects:list",
  projectsAdd: "projects:add",
  projectsRemove: "projects:remove",
  projectsRename: "projects:rename",
  projectsRescan: "projects:rescan",
  projectsSetProdLike: "projects:set-prod-like",

  workersGet: "workers:get",

  accountWhoami: "account:whoami",
  accountLogin: "account:login",

  migrationsList: "migrations:list",
  migrationsApply: "migrations:apply",

  devServerStart: "devserver:start",
  devServerStop: "devserver:stop",
  devServerStatus: "devserver:status",
  devServerStatusChanged: "devserver:status-changed",
  devServerOpenApp: "devserver:open-app",
  devServerOpenExplorer: "devserver:open-explorer",

  terminalData: "terminal:data",
  terminalWrite: "terminal:write",
  terminalResize: "terminal:resize",
  terminalKill: "terminal:kill",
  terminalExit: "terminal:exit",

  outputStart: "output:start",
  outputLine: "output:line",
  outputDone: "output:done",

  guardCheck: "guard:check",

  deployRun: "deploy:run",
  d1Execute: "d1:execute",
  d1Info: "d1:info",
  deploymentsList: "deployments:list",
  logsTail: "logs:tail",

  customActionsList: "custom-actions:list",
  customActionsRun: "custom-actions:run",
} as const;

/** Référence une session PTY côté renderer (xterm). */
export interface TerminalHandle {
  sessionId: string;
}

/** Référence un onglet du panneau de sortie. */
export interface OutputHandle {
  tabId: string;
}

/**
 * Toute action qui écrit sur un environnement distant porte ce paramètre.
 * Le main vérifie la confirmation avant tout spawn : le renderer ne peut pas
 * court-circuiter le garde-fou en omettant le champ.
 */
export interface ConfirmedRequest {
  /** Texte retapé par l'utilisateur, requis pour les envs de type production. */
  confirmationText?: string;
}

/** API exposée au renderer par le preload. */
export interface CorralApi {
  projects: {
    list(): Promise<Project[]>;
    add(): Promise<Project | null>;
    remove(projectId: string): Promise<void>;
    rename(projectId: string, name: string): Promise<void>;
    rescan(projectId: string): Promise<WorkerRef[]>;
    setProdLike(projectId: string, workerId: string, envNames: string[]): Promise<void>;
  };

  workers: {
    get(workerId: string): Promise<WorkerConfig>;
  };

  account: {
    whoami(workerId: string): Promise<CommandResult>;
    login(workerId: string): Promise<TerminalHandle>;
  };

  migrations: {
    list(workerId: string, dbBinding: string, env: EnvRef): Promise<MigrationsForEnv>;
    apply(
      workerId: string,
      dbBinding: string,
      env: EnvRef,
      request?: ConfirmedRequest,
    ): Promise<OutputHandle>;
  };

  devServer: {
    start(workerId: string): Promise<TerminalHandle>;
    stop(workerId: string): Promise<void>;
    status(workerId: string): Promise<DevServerStatus>;
    onStatusChanged(listener: (status: DevServerStatus) => void): () => void;
    openApp(workerId: string): Promise<void>;
    openExplorer(workerId: string): Promise<void>;
  };

  terminal: {
    onData(listener: (sessionId: string, chunk: string) => void): () => void;
    onExit(listener: (sessionId: string, exitCode: number) => void): () => void;
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    kill(sessionId: string): Promise<void>;
  };

  output: {
    onStart(listener: (tab: OutputTab) => void): () => void;
    onLine(listener: (tabId: string, line: OutputLine) => void): () => void;
    onDone(listener: (tab: OutputTab) => void): () => void;
  };

  guard: {
    check(workerId: string, env: EnvRef): Promise<GuardRequirement>;
  };

  customActions: {
    list(projectId: string): Promise<CustomAction[]>;
    run(projectId: string, actionId: string): Promise<OutputHandle | TerminalHandle>;
  };
}
