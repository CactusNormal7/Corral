/**
 * Exécution des commandes wrangler : `spawn` avec tableau d'arguments, jamais un
 * shell, et streaming ligne par ligne. Reprend le découpage du TUI d'Occulis.
 */
import { spawn } from "node:child_process";
import type { CommandResult } from "../../shared/types.js";
import { formatCommandLine } from "./wrangler-cli.js";

export type LineSink = (line: string, stream: "out" | "err") => void;

export interface RunOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  onLine?: LineSink;
  /** Alimente stdin puis le ferme : répond aux confirmations de wrangler sans TTY. */
  input?: string;
  signal?: AbortSignal;
}

/**
 * Lance la commande et accumule stdout/stderr tout en les streamant.
 * Un process tué par signal n'est pas un succès : on renvoie 130, comme Occulis.
 */
export function run(options: RunOptions): Promise<CommandResult> {
  const { command, args, cwd, onLine, input, signal } = options;
  const commandLine = formatCommandLine(command, args);

  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      // Jamais `shell: true` : les arguments restent des arguments, pas du texte
      // réinterprété par un shell.
      shell: false,
      // Le panneau de sortie est du HTML, pas un terminal : on demande une sortie
      // sans couleurs plutôt que d'afficher des séquences ANSI en clair. Les
      // commandes qui veulent un vrai terminal passent par le PTY, pas par ici.
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      signal,
    });

    if (input !== undefined && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.write(input);
      child.stdin.end();
    }

    let stdout = "";
    let stderr = "";
    const buffers: Record<"out" | "err", string> = { out: "", err: "" };

    const pump = (chunk: Buffer, stream: "out" | "err"): void => {
      const text = chunk.toString();
      if (stream === "out") stdout += text;
      else stderr += text;
      buffers[stream] += text;
      const parts = buffers[stream].split("\n");
      buffers[stream] = parts.pop() ?? "";
      for (const line of parts) onLine?.(line, stream);
    };

    child.stdout?.on("data", (chunk: Buffer) => pump(chunk, "out"));
    child.stderr?.on("data", (chunk: Buffer) => pump(chunk, "err"));
    child.on("error", reject);
    child.on("close", (code, signalName) => {
      for (const stream of ["out", "err"] as const) {
        if (buffers[stream]) onLine?.(buffers[stream], stream);
      }
      // Tué par un signal, l'enfant n'a pas de code : ce n'est pas un succès.
      const exitCode = code ?? (signalName === null ? 0 : 130);
      resolvePromise({ ok: exitCode === 0, exitCode, stdout, stderr, commandLine });
    });
  });
}
