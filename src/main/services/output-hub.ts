/**
 * Panneau de sortie commun : chaque action non interactive ouvre un onglet, y
 * streame ses lignes, puis se clôt avec un statut.
 * Une erreur wrangler est affichée telle quelle, jamais avalée.
 */
import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import { CHANNELS } from "../../shared/ipc-contract.js";
import type { CommandResult, OutputLevel, OutputTab } from "../../shared/types.js";
import { stripAnsi } from "../domain/wrangler-parsers.js";
import { run, type RunOptions } from "../domain/wrangler-runner.js";

export class OutputHub {
  private readonly tabs = new Map<string, OutputTab>();

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  private send(channel: string, ...args: unknown[]): void {
    const window = this.getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, ...args);
  }

  open(label: string, commandLine: string): OutputTab {
    const tab: OutputTab = {
      id: randomUUID(),
      label,
      commandLine,
      status: "running",
      startedAt: Date.now(),
    };
    this.tabs.set(tab.id, tab);
    this.send(CHANNELS.outputStart, tab);
    return tab;
  }

  line(tabId: string, text: string, level: OutputLevel = "raw"): void {
    // Le renderer affiche du texte, pas un flux terminal : les couleurs sont
    // retirées ici plutôt que d'apparaître en clair dans le panneau.
    this.send(CHANNELS.outputLine, tabId, { level, text: stripAnsi(text), at: Date.now() });
  }

  close(tabId: string, exitCode: number): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    tab.status = exitCode === 0 ? "ok" : "fail";
    tab.exitCode = exitCode;
    tab.finishedAt = Date.now();
    this.send(CHANNELS.outputDone, tab);
  }

  /**
   * Ouvre un onglet, lance la commande en y streamant chaque ligne, et clôt
   * l'onglet avec le code de sortie. L'appelant n'attend pas : l'UI suit le flux.
   */
  async runInTab(
    label: string,
    options: Omit<RunOptions, "onLine">,
    steps?: readonly string[],
  ): Promise<OutputTab> {
    const commandLine = [options.command, ...options.args].join(" ");
    const tab = this.open(label, commandLine);
    for (const step of steps ?? []) this.line(tab.id, step, "step");
    this.line(tab.id, commandLine, "info");

    void this.execute(tab.id, options);
    return tab;
  }

  private async execute(tabId: string, options: Omit<RunOptions, "onLine">): Promise<void> {
    let result: CommandResult;
    try {
      result = await run({
        ...options,
        onLine: (line, stream) => this.line(tabId, line, stream === "err" ? "warn" : "raw"),
      });
    } catch (error) {
      // `spawn` a échoué (binaire absent, cwd invalide) : l'utilisateur doit voir
      // pourquoi, pas un onglet qui reste à « en cours ».
      this.line(tabId, error instanceof Error ? error.message : String(error), "fail");
      this.close(tabId, 1);
      return;
    }

    if (!result.ok) {
      this.line(
        tabId,
        result.exitCode === 130
          ? "Commande interrompue (tuée par un signal) — ce n'est pas un succès."
          : `Échec (code ${result.exitCode}).`,
        "fail",
      );
    }
    this.close(tabId, result.exitCode);
  }
}
