/**
 * Sessions PTY (wrangler dev, tail, login, actions interactives).
 * node-pty est requis pour ces commandes : wrangler y attend un vrai terminal.
 */
import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import { spawn as spawnPty, type IPty } from "node-pty";
import { CHANNELS } from "../../shared/ipc-contract.js";

export interface PtySpawnOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  /** Vrai pour une action personnalisée : c'est l'utilisateur qui a écrit la ligne. */
  useShell?: boolean;
  onLine?: (line: string) => void;
  onExit?: (exitCode: number) => void;
}

interface Session {
  pty: IPty;
  /** Tampon de la ligne en cours, pour ne notifier que des lignes complètes. */
  pending: string;
}

export class PtyHub {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  private send(channel: string, ...args: unknown[]): void {
    const window = this.getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, ...args);
  }

  spawn(options: PtySpawnOptions): string {
    const sessionId = randomUUID();
    // Une action personnalisée est une ligne de commande écrite par l'utilisateur :
    // elle passe par un shell. Tout le reste reste en argv.
    const pty = options.useShell
      ? spawnPty(process.env.SHELL ?? "/bin/sh", ["-lc", options.command], {
          cwd: options.cwd,
          env: { ...process.env } as Record<string, string>,
          cols: 120,
          rows: 30,
        })
      : spawnPty(options.command, [...options.args], {
          cwd: options.cwd,
          env: { ...process.env } as Record<string, string>,
          cols: 120,
          rows: 30,
        });

    const session: Session = { pty, pending: "" };
    this.sessions.set(sessionId, session);

    pty.onData((chunk) => {
      this.send(CHANNELS.terminalData, sessionId, chunk);
      if (!options.onLine) return;
      session.pending += chunk;
      const parts = session.pending.split(/\r?\n/);
      session.pending = parts.pop() ?? "";
      for (const line of parts) options.onLine(line);
    });

    pty.onExit(({ exitCode, signal }) => {
      this.sessions.delete(sessionId);
      // Tué par un signal, le process n'a pas de code utile : 130, comme ailleurs.
      const code = signal ? 130 : exitCode;
      this.send(CHANNELS.terminalExit, sessionId, code);
      options.onExit?.(code);
    });

    return sessionId;
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    // Un redimensionnement sur une session déjà morte lèverait : on l'ignore.
    try {
      this.sessions.get(sessionId)?.pty.resize(cols, rows);
    } catch {
      /* session terminée entre-temps */
    }
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.pty.kill();
    } catch {
      /* déjà mort */
    }
  }

  /** Arrêt propre de tous les process à la fermeture de l'app. */
  killAll(): void {
    for (const sessionId of [...this.sessions.keys()]) this.kill(sessionId);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}
