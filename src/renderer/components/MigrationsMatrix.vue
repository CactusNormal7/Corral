<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Message from "primevue/message";
import Tag from "primevue/tag";
import ConfirmEnvDialog from "./ConfirmEnvDialog.vue";
import type {
  D1Binding,
  EnvRef,
  GuardRequirement,
  MigrationsForEnv,
  WorkerConfig,
} from "@shared/types.js";

const props = defineProps<{ config: WorkerConfig; binding: D1Binding }>();

/**
 * Colonnes de la matrice : `local` (config par défaut, `--local`) puis un env distant
 * par bloc `[env.x]`. Les envs distants ne sont pas chargés au démarrage.
 */
const envs = computed<EnvRef[]>(() => [
  { name: "local", location: "local" },
  ...props.config.envs
    .filter((env) => env.isRemote)
    .map((env) => ({ name: env.name, location: "remote" as const })),
]);

const reports = ref<Record<string, MigrationsForEnv>>({});
const loadingEnv = ref<string | null>(null);

function keyOf(env: EnvRef): string {
  return `${env.name}:${env.location}`;
}

function configFor(envName: string) {
  return props.config.envs.find((env) => env.name === envName) ?? null;
}

/** Fichiers vus sur tous les envs chargés, plus ceux rapportés par wrangler seul. */
const fileNames = computed(() => {
  const names = new Set<string>();
  for (const report of Object.values(reports.value)) {
    for (const migration of report.migrations) names.add(migration.fileName);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
});

const rows = computed(() =>
  fileNames.value.map((fileName) => {
    const cells: Record<string, "applied" | "pending" | "unknown"> = {};
    for (const env of envs.value) {
      const report = reports.value[keyOf(env)];
      if (!report || report.status === "error") {
        cells[keyOf(env)] = "unknown";
        continue;
      }
      const found = report.migrations.find((migration) => migration.fileName === fileName);
      cells[keyOf(env)] = found ? (found.applied ? "applied" : "pending") : "unknown";
    }
    return { fileName, cells };
  }),
);

async function load(env: EnvRef): Promise<void> {
  loadingEnv.value = keyOf(env);
  try {
    reports.value[keyOf(env)] = await window.corral.migrations.list(
      props.config.id,
      props.binding.binding,
      env,
    );
  } catch (cause) {
    reports.value[keyOf(env)] = {
      env,
      status: "error",
      migrations: [],
      error: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    loadingEnv.value = null;
  }
}

// Seul `local` se charge tout seul : un relevé distant coûte un appel au compte
// Cloudflare, donc il reste à la demande.
watch(
  () => [props.config.id, props.binding.binding],
  () => {
    reports.value = {};
    void load({ name: "local", location: "local" });
  },
  { immediate: true },
);

const pendingAction = ref<{ env: EnvRef; requirement: GuardRequirement } | null>(null);

async function requestApply(env: EnvRef): Promise<void> {
  const requirement = await window.corral.guard.check(props.config.id, env);
  if (!requirement.requiresConfirmation) {
    await apply(env);
    return;
  }
  pendingAction.value = { env, requirement };
}

async function apply(env: EnvRef, confirmationText?: string): Promise<void> {
  await window.corral.migrations.apply(props.config.id, props.binding.binding, env, {
    confirmationText,
  });
  pendingAction.value = null;
  // Le relevé n'est à jour qu'une fois la commande finie : on recharge sur demande,
  // via le bouton « rafraîchir », plutôt que de deviner quand elle se termine.
}

/**
 * Nom de la base pour un env donné : chaque `[env.x]` déclare le sien, celui de la
 * config par défaut ne vaut que pour `local`.
 */
function databaseNameFor(envName: string): string {
  const binding = configFor(envName)?.bindings.d1.find(
    (candidate) => candidate.binding === props.binding.binding,
  );
  return binding?.databaseName ?? props.binding.binding;
}

function pendingCount(env: EnvRef): number | null {
  const report = reports.value[keyOf(env)];
  if (!report || report.status === "error") return null;
  return report.migrations.filter((migration) => !migration.applied).length;
}
</script>

<template>
  <div class="corral-section">
    <h3>
      <!-- Le nom de la base change d'un env à l'autre : on titre par le binding,
           qui, lui, est stable. -->
      Migrations D1 · binding {{ binding.binding }}
    </h3>

    <Message v-if="binding.isPlaceholder" severity="warn" :closable="false">
      <code>database_id</code> manquant ou invalide pour cette base : les commandes distantes
      échoueront. Renseignez-le dans la config du projet (Corral ne modifie aucun fichier).
    </Message>

    <div class="corral-actions" style="margin: 8px 0">
      <span
        v-for="env in envs"
        :key="keyOf(env)"
        style="display: inline-flex; align-items: center; gap: 4px"
      >
        <Tag
          :value="`${env.name} · ${databaseNameFor(env.name)}`"
          v-tooltip.bottom="
            env.location === 'local' ? 'Base locale (--local)' : 'Base distante (--remote)'
          "
          :severity="
            env.location === 'local'
              ? 'success'
              : configFor(env.name)?.isProdLike
                ? 'danger'
                : 'warn'
          "
        />
        <Button
          icon="pi pi-refresh"
          size="small"
          text
          :loading="loadingEnv === keyOf(env)"
          v-tooltip.bottom="'Relever l\'état des migrations'"
          @click="load(env)"
        />
        <Button
          label="Appliquer"
          size="small"
          :severity="env.location === 'local' ? 'secondary' : 'warn'"
          :disabled="pendingCount(env) === 0"
          @click="requestApply(env)"
        />
      </span>
    </div>

    <Message
      v-for="report in Object.values(reports).filter((r) => r.status === 'error')"
      :key="keyOf(report.env)"
      severity="error"
      :closable="false"
    >
      <strong>{{ report.env.name }}</strong> — {{ report.error }}
    </Message>

    <DataTable :value="rows" size="small" scrollable scroll-height="320px" :row-hover="true">
      <template #empty>
        <span class="corral-muted">Aucune migration relevée.</span>
      </template>
      <Column field="fileName" header="Migration" style="min-width: 18rem" frozen />
      <Column
        v-for="env in envs"
        :key="keyOf(env)"
        :header="`${env.name} · ${env.location === 'local' ? 'local' : 'distant'}`"
        style="min-width: 9rem"
      >
        <template #body="{ data }">
          <Tag
            v-if="data.cells[keyOf(env)] === 'applied'"
            value="appliquée"
            severity="success"
            icon="pi pi-check"
          />
          <Tag
            v-else-if="data.cells[keyOf(env)] === 'pending'"
            value="en attente"
            severity="warn"
            icon="pi pi-clock"
          />
          <!-- `unknown` n'est pas « appliquée » : on ne l'affirme jamais sans relevé. -->
          <span v-else class="corral-muted">— non relevé</span>
        </template>
      </Column>
    </DataTable>

    <ConfirmEnvDialog
      :visible="pendingAction !== null"
      :requirement="pendingAction?.requirement ?? null"
      :description="`Appliquer les migrations sur « ${pendingAction?.env.name ?? ''} », base « ${databaseNameFor(pendingAction?.env.name ?? '')} » (binding ${binding.binding}). Cette opération écrit sur la base distante.`"
      @cancel="pendingAction = null"
      @confirm="(text) => pendingAction && apply(pendingAction.env, text)"
    />
  </div>
</template>
