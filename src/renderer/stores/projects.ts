import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { Project, WorkerConfig, WorkerRef } from "@shared/types.js";

export const useProjectsStore = defineStore("projects", () => {
  const projects = ref<Project[]>([]);
  const workersByProject = ref<Record<string, WorkerRef[]>>({});
  const selectedWorkerId = ref<string | null>(null);
  const selectedConfig = ref<WorkerConfig | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const selectedProject = computed(
    () => projects.value.find((project) => project.id === selectedConfig.value?.projectId) ?? null,
  );

  async function refresh(): Promise<void> {
    projects.value = await window.corral.projects.list();
    for (const project of projects.value) {
      workersByProject.value[project.id] = await window.corral.projects.rescan(project.id);
    }
  }

  async function add(): Promise<void> {
    const project = await window.corral.projects.add();
    if (!project) return;
    await refresh();
  }

  async function remove(projectId: string): Promise<void> {
    await window.corral.projects.remove(projectId);
    if (selectedConfig.value?.projectId === projectId) {
      selectedWorkerId.value = null;
      selectedConfig.value = null;
    }
    await refresh();
  }

  async function rename(projectId: string, name: string): Promise<void> {
    await window.corral.projects.rename(projectId, name);
    await refresh();
  }

  async function selectWorker(workerId: string): Promise<void> {
    selectedWorkerId.value = workerId;
    loading.value = true;
    error.value = null;
    try {
      selectedConfig.value = await window.corral.workers.get(workerId);
    } catch (cause) {
      // Config illisible (TOML cassé, fichier supprimé) : on le dit, on ne vide pas
      // la sidebar pour autant.
      selectedConfig.value = null;
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
    }
  }

  async function reloadSelected(): Promise<void> {
    if (selectedWorkerId.value) await selectWorker(selectedWorkerId.value);
  }

  async function setProdLike(envNames: string[]): Promise<void> {
    const config = selectedConfig.value;
    if (!config) return;
    await window.corral.projects.setProdLike(config.projectId, config.id, envNames);
    await reloadSelected();
  }

  return {
    projects,
    workersByProject,
    selectedWorkerId,
    selectedConfig,
    selectedProject,
    loading,
    error,
    refresh,
    add,
    remove,
    rename,
    selectWorker,
    reloadSelected,
    setProdLike,
  };
});
