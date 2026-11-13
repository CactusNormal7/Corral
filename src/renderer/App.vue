<script setup lang="ts">
import { onMounted } from "vue";
import Message from "primevue/message";
import ProgressSpinner from "primevue/progressspinner";
import OutputPanel from "./components/OutputPanel.vue";
import ProjectSidebar from "./components/ProjectSidebar.vue";
import WorkerView from "./components/WorkerView.vue";
import { useDevServersStore } from "./stores/dev-servers.js";
import { useOutputStore } from "./stores/output.js";
import { useProjectsStore } from "./stores/projects.js";

const projects = useProjectsStore();
const output = useOutputStore();
const devServers = useDevServersStore();

onMounted(async () => {
  output.bind();
  devServers.bind();
  await projects.refresh();
});
</script>

<template>
  <div class="corral-layout">
    <ProjectSidebar />

    <main class="corral-main">
      <template v-if="projects.loading">
        <div />
        <div class="corral-content" style="display: grid; place-items: center">
          <ProgressSpinner />
        </div>
      </template>

      <template v-else-if="projects.error">
        <div />
        <div class="corral-content">
          <Message severity="error" :closable="false">{{ projects.error }}</Message>
        </div>
      </template>

      <template v-else-if="projects.selectedConfig">
        <div />
        <WorkerView :config="projects.selectedConfig" />
      </template>

      <template v-else>
        <div />
        <div class="corral-content">
          <h2>Corral</h2>
          <p class="corral-muted">
            Cockpit de pilotage Wrangler multi-projets. Ajoutez un projet dans la barre latérale,
            puis choisissez un Worker.
          </p>
          <p class="corral-muted">
            Corral ne modifie jamais les fichiers de vos projets : la lecture passe par les configs
            wrangler, les écritures par wrangler lui-même.
          </p>
        </div>
      </template>

      <OutputPanel />
    </main>
  </div>
</template>
