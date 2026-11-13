<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

const props = defineProps<{ sessionId: string }>();

const host = ref<HTMLDivElement | null>(null);
let terminal: Terminal | null = null;
let fit: FitAddon | null = null;
let unsubscribe: (() => void) | null = null;
let observer: ResizeObserver | null = null;

function mountTerminal(): void {
  if (!host.value) return;
  terminal = new Terminal({
    fontFamily: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
    fontSize: 12,
    convertEol: true,
    theme: { background: "#000000" },
  });
  fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(host.value);
  fit.fit();

  // Les frappes repartent vers le PTY : c'est ce qui rend `wrangler login` utilisable.
  terminal.onData((data) => void window.corral.terminal.write(props.sessionId, data));

  unsubscribe = window.corral.terminal.onData((sessionId, chunk) => {
    if (sessionId === props.sessionId) terminal?.write(chunk);
  });

  observer = new ResizeObserver(() => {
    fit?.fit();
    if (terminal) {
      void window.corral.terminal.resize(props.sessionId, terminal.cols, terminal.rows);
    }
  });
  observer.observe(host.value);
}

function disposeTerminal(): void {
  unsubscribe?.();
  unsubscribe = null;
  observer?.disconnect();
  observer = null;
  terminal?.dispose();
  terminal = null;
  fit = null;
}

onMounted(mountTerminal);
onBeforeUnmount(disposeTerminal);

// Changer de session reconstruit le terminal : le tampon d'une session n'est pas
// rejouable, mieux vaut un terminal propre qu'un mélange de deux sorties.
watch(
  () => props.sessionId,
  () => {
    disposeTerminal();
    mountTerminal();
  },
);
</script>

<template>
  <div ref="host" class="corral-terminal" />
</template>
