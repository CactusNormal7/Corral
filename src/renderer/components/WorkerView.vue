<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import Card from "primevue/card";
import Message from "primevue/message";
import Select from "primevue/select";
import Tag from "primevue/tag";
import ToggleSwitch from "primevue/toggleswitch";
import EnvBanner from "./EnvBanner.vue";
import MigrationsMatrix from "./MigrationsMatrix.vue";
import { useDevServersStore } from "@renderer/stores/dev-servers.js";
import { useOutputStore } from "@renderer/stores/output.js";
import { useProjectsStore } from "@renderer/stores/projects.js";
import type { EnvRef, WorkerConfig } from "@shared/types.js";

const props = defineProps<{ config: WorkerConfig }>();

const projects = useProjectsStore();
const devServers = useDevServersStore();
const output = useOutputStore();

const selectedEnvName = ref<string>("local");

watch(
  () => props.config.id,
  () => {
    selectedEnvName.value = "local";
  },
);

const envOptions = computed(() =>
  props.config.envs.map((env) => ({
    label: env.name === "local" ? "local (config par défaut)" : env.name,
    value: env.name,
  })),
);

const selectedEnv = computed(
  () => props.config.envs.find((env) => env.name === selectedEnvName.value) ?? null,
);

const envRef = computed<EnvRef>(() => ({
  name: selectedEnvName.value,
  location: selectedEnv.value?.isRemote ? "remote" : "local",
}));

const devStatus = computed(() => devServers.statusOf(props.config.id));

/** Bascule le marquage « type production » de l'env affiché. */
const markedProd = computed({
  get: () => selectedEnv.value?.isProdLike ?? false,
  set: (value: boolean) => {
    const current = props.config.envs
      .filter((env) => env.isProdLike && env.name !== selectedEnvName.value)
      .map((env) => env.name);
    void projects.setProdLike(value ? [...current, selectedEnvName.value] : current);
  },
});

const whoami = ref<string | null>(null);
const whoamiLoading = ref(false);

async function runWhoami(): Promise<void> {
  whoamiLoading.value = true;
  try {
    const result = await window.corral.account.whoami(props.config.id);
    whoami.value = (result.stdout + result.stderr).trim();
  } catch (cause) {
    whoami.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    whoamiLoading.value = false;
  }
}

async function login(): Promise<void> {
  const { sessionId } = await window.corral.account.login(props.config.id);
  output.openTerminal(sessionId, "wrangler login");
}

async function startDev(): Promise<void> {
  const sessionId = await devServers.start(props.config.id);
  output.openTerminal(sessionId, `dev · ${props.config.name}`);
}

async function openApp(): Promise<void> {
  await window.corral.devServer.openApp(props.config.id);
}

async function openExplorer(): Promise<void> {
  await window.corral.devServer.openExplorer(props.config.id);
}
</script>

<template>
  <div>
    <EnvBanner :env="envRef" :config="selectedEnv" />

    <div class="corral-content">
      <div class="corral-actions" style="margin-bottom: 16px">
        <h2 style="margin: 0; flex: 1">
          {{ config.name }}
          <code class="corral-muted" style="font-size: 12px">{{ config.relativePath }}</code>
        </h2>
        <Select
          v-model="selectedEnvName"
          :options="envOptions"
          option-label="label"
          option-value="value"
          size="small"
        />
        <Button icon="pi pi-refresh" size="small" text @click="projects.reloadSelected()" />
      </div>

      <Message v-for="warning in config.warnings" :key="warning" severity="warn" :closable="false">
        {{ warning }}
      </Message>

      <!-- Serveur de dev ------------------------------------------------- -->
      <Card class="corral-section">
        <template #title>Serveur de développement</template>
        <template #content>
          <div class="corral-actions">
            <Button
              v-if="devStatus.state === 'stopped' || devStatus.state === 'crashed'"
              label="Démarrer wrangler dev"
              icon="pi pi-play"
              size="small"
              @click="startDev()"
            />
            <Button
              v-else
              label="Arrêter"
              icon="pi pi-stop"
              severity="danger"
              size="small"
              @click="devServers.stop(config.id)"
            />
            <Tag
              v-if="devStatus.state === 'running'"
              :value="`en cours · port ${devStatus.port ?? '…'}`"
              severity="success"
            />
            <Tag v-else-if="devStatus.state === 'starting'" value="démarrage…" severity="info" />
            <Tag
              v-else-if="devStatus.state === 'crashed'"
              :value="`arrêté (code ${devStatus.exitCode ?? '?'})`"
              severity="danger"
            />
            <Button
              label="Ouvrir l'app"
              icon="pi pi-external-link"
              size="small"
              text
              :disabled="devStatus.port === null"
              @click="openApp()"
            />
            <!-- Corral lie vers le Local Explorer de wrangler, il ne le duplique pas. -->
            <Button
              label="Local Explorer"
              icon="pi pi-database"
              size="small"
              text
              :disabled="devStatus.port === null"
              v-tooltip.bottom="'Explorateur KV / R2 / D1 embarqué par wrangler'"
              @click="openExplorer()"
            />
          </div>
        </template>
      </Card>

      <!-- Compte Cloudflare ---------------------------------------------- -->
      <Card class="corral-section">
        <template #title>Compte Cloudflare</template>
        <template #content>
          <div class="corral-actions">
            <Button
              label="whoami"
              icon="pi pi-user"
              size="small"
              :loading="whoamiLoading"
              @click="runWhoami()"
            />
            <Button label="Se connecter" icon="pi pi-sign-in" size="small" text @click="login()" />
          </div>
          <pre v-if="whoami" class="corral-output-lines" style="margin-top: 8px">{{ whoami }}</pre>
        </template>
      </Card>

      <!-- Environnement sélectionné -------------------------------------- -->
      <Card v-if="selectedEnv" class="corral-section">
        <template #title> Environnement « {{ selectedEnv.name }} » </template>
        <template #content>
          <div v-if="selectedEnv.isRemote" class="corral-actions" style="margin-bottom: 12px">
            <ToggleSwitch v-model="markedProd" input-id="mark-prod" />
            <label for="mark-prod">
              Traiter comme un environnement de production (confirmation par saisie du nom)
            </label>
          </div>

          <p>
            Worker :
            <code>{{ selectedEnv.workerName ?? "— non déclaré" }}</code>
          </p>

          <div class="corral-section">
            <h3>Bindings</h3>
            <p v-if="selectedEnv.bindings.d1.length" class="corral-chip-row">
              <Tag
                v-for="d1 in selectedEnv.bindings.d1"
                :key="d1.binding"
                :value="`D1 ${d1.binding} → ${d1.databaseName}`"
                :severity="d1.isPlaceholder ? 'danger' : 'info'"
                :icon="d1.isPlaceholder ? 'pi pi-exclamation-triangle' : undefined"
              />
            </p>
            <p v-if="selectedEnv.bindings.kv.length" class="corral-chip-row">
              <Tag
                v-for="kv in selectedEnv.bindings.kv"
                :key="kv.binding"
                :value="`KV ${kv.binding}`"
              />
            </p>
            <p v-if="selectedEnv.bindings.r2.length" class="corral-chip-row">
              <Tag
                v-for="r2 in selectedEnv.bindings.r2"
                :key="r2.binding"
                :value="`R2 ${r2.binding} → ${r2.target ?? '?'}`"
              />
            </p>
            <p v-if="selectedEnv.bindings.durableObjects.length" class="corral-chip-row">
              <Tag
                v-for="durable in selectedEnv.bindings.durableObjects"
                :key="durable.binding"
                :value="`DO ${durable.binding} → ${durable.target ?? '?'}`"
              />
            </p>
            <p v-if="selectedEnv.bindings.queues.length" class="corral-chip-row">
              <Tag
                v-for="queue in selectedEnv.bindings.queues"
                :key="queue.binding"
                :value="`Queue ${queue.binding}`"
              />
            </p>
            <p
              v-if="
                !selectedEnv.bindings.d1.length &&
                !selectedEnv.bindings.kv.length &&
                !selectedEnv.bindings.r2.length &&
                !selectedEnv.bindings.durableObjects.length &&
                !selectedEnv.bindings.queues.length
              "
              class="corral-muted"
            >
              Aucun binding déclaré. Rappel : les bindings ne sont pas hérités par les
              environnements nommés.
            </p>
          </div>

          <div class="corral-section">
            <h3>Variables (noms seulement)</h3>
            <p v-if="selectedEnv.varNames.length" class="corral-chip-row">
              <Tag
                v-for="name in selectedEnv.varNames"
                :key="name"
                :value="name"
                severity="secondary"
              />
            </p>
            <p v-else class="corral-muted">Aucune var déclarée.</p>
          </div>

          <div class="corral-section">
            <h3>Routes</h3>
            <p v-if="selectedEnv.routes.length">
              <code v-for="route in selectedEnv.routes" :key="route" style="margin-right: 8px">
                {{ route }}
              </code>
            </p>
            <p v-else class="corral-muted">Aucune route déclarée.</p>
          </div>

          <div class="corral-section">
            <h3>Crons</h3>
            <p v-if="selectedEnv.crons.length">
              <code v-for="cron in selectedEnv.crons" :key="cron" style="margin-right: 8px">
                {{ cron }}
              </code>
            </p>
            <p v-else class="corral-muted">Aucun cron déclaré.</p>
          </div>
        </template>
      </Card>

      <!-- Matrice des migrations ----------------------------------------- -->
      <MigrationsMatrix
        v-for="binding in config.envs[0]?.bindings.d1 ?? []"
        :key="binding.binding"
        :config="config"
        :binding="binding"
      />
      <Message
        v-if="(config.envs[0]?.bindings.d1 ?? []).length === 0"
        severity="info"
        :closable="false"
      >
        Aucune base D1 déclarée dans la config par défaut : pas de matrice de migrations.
      </Message>
    </div>
  </div>
</template>
