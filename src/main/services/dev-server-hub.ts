/**
 * Serveurs `wrangler dev`, un par Worker, dans une session PTY.
 * Le port est lu dans la sortie de wrangler, pas supposé.
 */
import type { BrowserWindow } from "electron";
import { CHANNELS } from "../../shared/ipc-contract.js";
import type { DevServerStatus } from "../../shared/types.js";
import { isDevServerReady, parseDevServerPort } from "../domain/wrangler-parsers.js";
import type { PtyHub } from "./pty-hub.js";

export interface DevServerSpawn {
  workerId: string;
  command: string;
  args: readonly string[];
  cwd: string;
}

export class DevServerHub {
  private readonly statuses = new Map<string, DevServerStatus>();

  constructor(
    private readonly ptyHub: PtyHub,
    private readonly getWindow: () => BrowserWindow | null,
  ) {}

  private publish(status: DevServerStatus): void {
    this.statuses.set(status.workerId, status);
    const window = this.getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(CHANNELS.devServerStatusChanged, status);
    }
  }

  status(workerId: string): DevServerStatus {
    return (
      this.statuses.get(workerId) ?? {
        workerId,
        state: "stopped",
        sessionId: null,
        port: null,
      }
    );
  }

  /** Démarre le serveur, ou renvoie la session existante s'il tourne déjà. */
  start(spawn: DevServerSpawn): string {
    const current = this.status(spawn.workerId);
    if (current.sessionId && this.ptyHub.has(current.sessionId)) return current.sessionId;

    const sessionId = this.ptyHub.spawn({
      command: spawn.command,
      args: spawn.args,
      cwd: spawn.cwd,
      onLine: (line) => this.inspect(spawn.workerId, line),
      onExit: (exitCode) => {
        const previous = this.status(spawn.workerId);
        this.publish({
          workerId: spawn.workerId,
          // Un arrêt demandé passe par `stop`, qui a déjà publié « stopped » : si on
          // arrive ici encore en marche, le process est tombé tout seul.
          state: previous.state === "stopped" ? "stopped" : "crashed",
          sessionId: null,
          port: null,
          exitCode,
        });
      },
    });

    this.publish({ workerId: spawn.workerId, state: "starting", sessionId, port: null });
    return sessionId;
  }

  private inspect(workerId: string, line: string): void {
    const current = this.status(workerId);
    const port = parseDevServerPort(line) ?? current.port;
    const ready = isDevServerReady(line);
    if (port === current.port && !ready) return;
    this.publish({
      workerId,
      state: ready || (port !== null && current.state === "running") ? "running" : current.state,
      sessionId: current.sessionId,
      port,
    });
  }

  stop(workerId: string): void {
    const current = this.status(workerId);
    // On publie « stopped » avant de tuer, pour que `onExit` ne le prenne pas pour
    // un crash.
    this.publish({ workerId, state: "stopped", sessionId: null, port: null });
    if (current.sessionId) this.ptyHub.kill(current.sessionId);
  }

  running(): DevServerStatus[] {
    return [...this.statuses.values()].filter((status) => status.state === "running");
  }

  stopAll(): void {
    for (const workerId of [...this.statuses.keys()]) this.stop(workerId);
  }
}
