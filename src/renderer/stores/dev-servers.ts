import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { DevServerStatus } from "@shared/types.js";

export const useDevServersStore = defineStore("devServers", () => {
  const statuses = ref<Record<string, DevServerStatus>>({});

  function bind(): void {
    window.corral.devServer.onStatusChanged((status) => {
      statuses.value[status.workerId] = status;
    });
  }

  function statusOf(workerId: string): DevServerStatus {
    return statuses.value[workerId] ?? { workerId, state: "stopped", sessionId: null, port: null };
  }

  const runningCount = computed(
    () => Object.values(statuses.value).filter((status) => status.state === "running").length,
  );

  async function start(workerId: string): Promise<string> {
    const { sessionId } = await window.corral.devServer.start(workerId);
    return sessionId;
  }

  async function stop(workerId: string): Promise<void> {
    await window.corral.devServer.stop(workerId);
  }

  return { statuses, bind, statusOf, runningCount, start, stop };
});
