/**
 * Pont typé et minimal entre le renderer et le main.
 * Le renderer ne construit jamais une ligne de commande : il nomme une action et
 * ses paramètres, le main décide de l'argv.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { CHANNELS, type CorralApi } from "../shared/ipc-contract.js";
import type { DevServerStatus, EnvRef, OutputLine, OutputTab } from "../shared/types.js";

/** Abonne un écouteur et renvoie la fonction de désabonnement. */
function subscribe<Args extends unknown[]>(
  channel: string,
  listener: (...args: Args) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]): void =>
    listener(...(args as Args));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: CorralApi = {
  projects: {
    list: () => ipcRenderer.invoke(CHANNELS.projectsList),
    add: () => ipcRenderer.invoke(CHANNELS.projectsAdd),
    remove: (projectId) => ipcRenderer.invoke(CHANNELS.projectsRemove, projectId),
    rename: (projectId, name) => ipcRenderer.invoke(CHANNELS.projectsRename, projectId, name),
    rescan: (projectId) => ipcRenderer.invoke(CHANNELS.projectsRescan, projectId),
    setProdLike: (projectId, workerId, envNames) =>
      ipcRenderer.invoke(CHANNELS.projectsSetProdLike, projectId, workerId, envNames),
  },

  workers: {
    get: (workerId) => ipcRenderer.invoke(CHANNELS.workersGet, workerId),
  },

  account: {
    whoami: (workerId) => ipcRenderer.invoke(CHANNELS.accountWhoami, workerId),
    login: (workerId) => ipcRenderer.invoke(CHANNELS.accountLogin, workerId),
  },

  migrations: {
    list: (workerId, dbBinding, env) =>
      ipcRenderer.invoke(CHANNELS.migrationsList, workerId, dbBinding, env),
    apply: (workerId, dbBinding, env, request) =>
      ipcRenderer.invoke(CHANNELS.migrationsApply, workerId, dbBinding, env, request),
  },

  devServer: {
    start: (workerId) => ipcRenderer.invoke(CHANNELS.devServerStart, workerId),
    stop: (workerId) => ipcRenderer.invoke(CHANNELS.devServerStop, workerId),
    status: (workerId) => ipcRenderer.invoke(CHANNELS.devServerStatus, workerId),
    onStatusChanged: (listener) =>
      subscribe<[DevServerStatus]>(CHANNELS.devServerStatusChanged, listener),
    openApp: (workerId) => ipcRenderer.invoke(CHANNELS.devServerOpenApp, workerId),
    openExplorer: (workerId) => ipcRenderer.invoke(CHANNELS.devServerOpenExplorer, workerId),
  },

  terminal: {
    onData: (listener) => subscribe<[string, string]>(CHANNELS.terminalData, listener),
    onExit: (listener) => subscribe<[string, number]>(CHANNELS.terminalExit, listener),
    write: (sessionId, data) => ipcRenderer.invoke(CHANNELS.terminalWrite, sessionId, data),
    resize: (sessionId, cols, rows) =>
      ipcRenderer.invoke(CHANNELS.terminalResize, sessionId, cols, rows),
    kill: (sessionId) => ipcRenderer.invoke(CHANNELS.terminalKill, sessionId),
  },

  output: {
    onStart: (listener) => subscribe<[OutputTab]>(CHANNELS.outputStart, listener),
    onLine: (listener) => subscribe<[string, OutputLine]>(CHANNELS.outputLine, listener),
    onDone: (listener) => subscribe<[OutputTab]>(CHANNELS.outputDone, listener),
  },

  guard: {
    check: (workerId, env: EnvRef) => ipcRenderer.invoke(CHANNELS.guardCheck, workerId, env),
  },

  customActions: {
    list: (projectId) => ipcRenderer.invoke(CHANNELS.customActionsList, projectId),
    run: (projectId, actionId) =>
      ipcRenderer.invoke(CHANNELS.customActionsRun, projectId, actionId),
  },
};

contextBridge.exposeInMainWorld("corral", api);
