<script setup lang="ts">
import Badge from "primevue/badge";
import Button from "primevue/button";
import { useDevServersStore } from "@renderer/stores/dev-servers.js";
import { useProjectsStore } from "@renderer/stores/projects.js";

const projects = useProjectsStore();
const devServers = useDevServersStore();

async function renamePrompt(projectId: string, current: string): Promise<void> {
  const name = window.prompt("Nouveau nom du projet", current);
  if (name && name.trim()) await projects.rename(projectId, name.trim());
}

async function removeConfirm(projectId: string, name: string): Promise<void> {
  // Retirer du registre ne supprime rien sur le disque : on le dit explicitement.
  if (window.confirm(`Retirer « ${name} » de Corral ? Le dossier n'est pas supprimé.`)) {
    await projects.remove(projectId);
  }
}
</script>

<template>
  <aside class="corral-sidebar">
    <div class="corral-actions" style="margin-bottom: 12px">
      <Button
        label="Ajouter un projet"
        icon="pi pi-folder-open"
        size="small"
        @click="projects.add()"
      />
      <Button
        icon="pi pi-refresh"
        size="small"
        text
        v-tooltip.bottom="'Re-détecter les configs wrangler'"
        @click="projects.refresh()"
      />
    </div>

    <p v-if="projects.projects.length === 0" class="corral-muted">
      Aucun projet. Ajoutez un dossier contenant un <code>wrangler.toml</code>.
    </p>

    <div v-for="project in projects.projects" :key="project.id" class="corral-section">
      <h3 style="display: flex; align-items: center; gap: 4px">
        <span style="flex: 1">{{ project.name }}</span>
        <Button
          icon="pi pi-pencil"
          text
          size="small"
          v-tooltip.bottom="'Renommer'"
          @click="renamePrompt(project.id, project.name)"
        />
        <Button
          icon="pi pi-times"
          text
          size="small"
          severity="danger"
          v-tooltip.bottom="'Retirer du registre'"
          @click="removeConfirm(project.id, project.name)"
        />
      </h3>

      <p v-if="(projects.workersByProject[project.id] ?? []).length === 0" class="corral-muted">
        Aucune config wrangler détectée.
      </p>

      <Button
        v-for="worker in projects.workersByProject[project.id] ?? []"
        :key="worker.id"
        :label="worker.relativePath"
        :severity="projects.selectedWorkerId === worker.id ? 'primary' : 'secondary'"
        :text="projects.selectedWorkerId !== worker.id"
        size="small"
        fluid
        style="justify-content: flex-start; margin-bottom: 2px"
        @click="projects.selectWorker(worker.id)"
      >
        <span style="flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis">
          {{ worker.relativePath }}
        </span>
        <!-- Indicateur « en cours » : on voit d'un coup d'œil quels serveurs tournent. -->
        <Badge
          v-if="devServers.statusOf(worker.id).state === 'running'"
          :value="String(devServers.statusOf(worker.id).port ?? '…')"
          severity="success"
        />
        <i
          v-else-if="devServers.statusOf(worker.id).state === 'starting'"
          class="pi pi-spin pi-spinner"
        />
        <i
          v-else-if="devServers.statusOf(worker.id).state === 'crashed'"
          class="pi pi-exclamation-circle"
          style="color: var(--corral-prod)"
        />
      </Button>
    </div>
  </aside>
</template>
