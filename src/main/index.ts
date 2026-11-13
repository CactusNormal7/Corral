import { join } from "node:path";
import { BrowserWindow, app, shell } from "electron";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { ProjectStore } from "./domain/project-store.js";
import { registerIpc } from "./ipc/index.js";
import { DevServerHub } from "./services/dev-server-hub.js";
import { OutputHub } from "./services/output-hub.js";
import { PtyHub } from "./services/pty-hub.js";
import { WorkerRegistry } from "./services/worker-registry.js";

let mainWindow: BrowserWindow | null = null;
const getWindow = (): BrowserWindow | null => mainWindow;

const store = new ProjectStore(app.getPath("userData"));
const registry = new WorkerRegistry(store);
const output = new OutputHub(getWindow);
const ptyHub = new PtyHub(getWindow);
const devServers = new DevServerHub(ptyHub, getWindow);

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      // Le renderer n'a aucun accès direct à Node : tout passe par le preload.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());

  // Un lien externe s'ouvre dans le navigateur, jamais dans une fenêtre Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(async () => {
  electronApp.setAppUserModelId("fr.corral.app");
  app.on("browser-window-created", (_event, window) => optimizer.watchWindowShortcuts(window));

  registerIpc({ store, registry, output, pty: ptyHub, devServers, getWindow });
  await registry.scanAll();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/**
 * Arrêt propre de tous les process à la fermeture : un `wrangler dev` orphelin
 * garderait son port et sa base locale verrouillés.
 */
function shutdown(): void {
  devServers.stopAll();
  ptyHub.killAll();
}

app.on("window-all-closed", () => {
  shutdown();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", shutdown);
