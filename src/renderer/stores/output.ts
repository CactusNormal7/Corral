import { defineStore } from "pinia";
import { ref } from "vue";
import type { OutputLine, OutputTab } from "@shared/types.js";

interface Tab extends OutputTab {
  lines: OutputLine[];
}

export const useOutputStore = defineStore("output", () => {
  const tabs = ref<Tab[]>([]);
  const activeTabId = ref<string | null>(null);
  /** Sessions PTY ouvertes en onglet terminal, par identifiant. */
  const terminals = ref<Array<{ sessionId: string; label: string }>>([]);
  const activeTerminalId = ref<string | null>(null);

  /**
   * Branche les écouteurs IPC une seule fois : le main pousse les lignes, le store
   * ne scrute rien.
   */
  function bind(): void {
    window.corral.output.onStart((tab) => {
      tabs.value.push({ ...tab, lines: [] });
      activeTabId.value = tab.id;
    });

    window.corral.output.onLine((tabId, line) => {
      tabs.value.find((tab) => tab.id === tabId)?.lines.push(line);
    });

    window.corral.output.onDone((done) => {
      const tab = tabs.value.find((candidate) => candidate.id === done.id);
      if (!tab) return;
      Object.assign(tab, done);
    });

    window.corral.terminal.onExit((sessionId) => {
      // On garde l'onglet affiché : la sortie reste lisible après la fin du process.
      const terminal = terminals.value.find((candidate) => candidate.sessionId === sessionId);
      if (terminal && !terminal.label.endsWith(" (terminé)")) {
        terminal.label = `${terminal.label} (terminé)`;
      }
    });
  }

  function openTerminal(sessionId: string, label: string): void {
    if (!terminals.value.some((terminal) => terminal.sessionId === sessionId)) {
      terminals.value.push({ sessionId, label });
    }
    activeTerminalId.value = sessionId;
  }

  async function closeTerminal(sessionId: string): Promise<void> {
    await window.corral.terminal.kill(sessionId);
    terminals.value = terminals.value.filter((terminal) => terminal.sessionId !== sessionId);
    if (activeTerminalId.value === sessionId) {
      activeTerminalId.value = terminals.value.at(-1)?.sessionId ?? null;
    }
  }

  function closeTab(tabId: string): void {
    tabs.value = tabs.value.filter((tab) => tab.id !== tabId);
    if (activeTabId.value === tabId) activeTabId.value = tabs.value.at(-1)?.id ?? null;
  }

  function clear(): void {
    tabs.value = tabs.value.filter((tab) => tab.status === "running");
  }

  function textOf(tabId: string): string {
    const tab = tabs.value.find((candidate) => candidate.id === tabId);
    if (!tab) return "";
    return [tab.commandLine, "", ...tab.lines.map((line) => line.text)].join("\n");
  }

  return {
    tabs,
    activeTabId,
    terminals,
    activeTerminalId,
    bind,
    openTerminal,
    closeTerminal,
    closeTab,
    clear,
    textOf,
  };
});
