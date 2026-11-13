<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import Button from "primevue/button";
import Tab from "primevue/tab";
import TabList from "primevue/tablist";
import TabPanel from "primevue/tabpanel";
import TabPanels from "primevue/tabpanels";
import Tabs from "primevue/tabs";
import TerminalPane from "./TerminalPane.vue";
import { useOutputStore } from "@renderer/stores/output.js";

const output = useOutputStore();
const linesHost = ref<HTMLElement | null>(null);

/** Onglets de log et onglets terminal cohabitent, préfixés pour distinguer les clés. */
const activeKey = ref<string>("");

const hasAnything = computed(() => output.tabs.length > 0 || output.terminals.length > 0);

watch(
  () => output.activeTabId,
  (tabId) => {
    if (tabId) activeKey.value = `log:${tabId}`;
  },
);

watch(
  () => output.activeTerminalId,
  (sessionId) => {
    if (sessionId) activeKey.value = `pty:${sessionId}`;
  },
);

// Autoscroll : on suit la sortie en direct, comme un terminal.
watch(
  () => output.tabs.map((tab) => tab.lines.length).join(","),
  async () => {
    await nextTick();
    if (linesHost.value) linesHost.value.scrollTop = linesHost.value.scrollHeight;
  },
);

async function copy(tabId: string): Promise<void> {
  await navigator.clipboard.writeText(output.textOf(tabId));
}

function stamp(at: number): string {
  return new Date(at).toLocaleTimeString("fr-FR");
}

function statusIcon(status: "running" | "ok" | "fail"): string {
  if (status === "running") return "pi pi-spin pi-spinner";
  return status === "ok" ? "pi pi-check-circle" : "pi pi-times-circle";
}
</script>

<template>
  <section v-if="hasAnything" class="corral-output">
    <Tabs :value="activeKey" scrollable @update:value="(value) => (activeKey = String(value))">
      <TabList>
        <Tab v-for="tab in output.tabs" :key="tab.id" :value="`log:${tab.id}`">
          <i :class="statusIcon(tab.status)" style="margin-right: 6px" />
          {{ tab.label }}
          <i class="pi pi-times" style="margin-left: 8px" @click.stop="output.closeTab(tab.id)" />
        </Tab>
        <Tab
          v-for="terminal in output.terminals"
          :key="terminal.sessionId"
          :value="`pty:${terminal.sessionId}`"
        >
          <i class="pi pi-desktop" style="margin-right: 6px" />
          {{ terminal.label }}
          <i
            class="pi pi-times"
            style="margin-left: 8px"
            @click.stop="output.closeTerminal(terminal.sessionId)"
          />
        </Tab>
      </TabList>

      <TabPanels>
        <TabPanel v-for="tab in output.tabs" :key="tab.id" :value="`log:${tab.id}`">
          <div class="corral-actions" style="padding: 4px 12px">
            <code class="corral-muted" style="flex: 1">{{ tab.commandLine }}</code>
            <span class="corral-muted">{{ stamp(tab.startedAt) }}</span>
            <span v-if="tab.exitCode !== undefined" class="corral-muted">
              code {{ tab.exitCode }}
            </span>
            <Button label="Copier" icon="pi pi-copy" size="small" text @click="copy(tab.id)" />
          </div>
          <div ref="linesHost" class="corral-output-lines">
            <div
              v-for="(line, index) in tab.lines"
              :key="index"
              :class="`corral-line--${line.level}`"
            >
              {{ line.text }}
            </div>
          </div>
        </TabPanel>

        <TabPanel
          v-for="terminal in output.terminals"
          :key="terminal.sessionId"
          :value="`pty:${terminal.sessionId}`"
        >
          <TerminalPane :session-id="terminal.sessionId" />
        </TabPanel>
      </TabPanels>
    </Tabs>
  </section>
</template>
