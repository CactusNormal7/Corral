<script setup lang="ts">
import { computed } from "vue";
import type { EnvConfig, EnvRef } from "@shared/types.js";

const props = defineProps<{ env: EnvRef; config: EnvConfig | null }>();

const isRemote = computed(() => props.env.location === "remote");
const isProd = computed(() => isRemote.value && props.config?.isProdLike === true);

const cssClass = computed(() => {
  if (isProd.value) return "corral-env-banner corral-env-banner--prod";
  if (isRemote.value) return "corral-env-banner corral-env-banner--remote";
  return "corral-env-banner corral-env-banner--local";
});

const label = computed(() => {
  if (isProd.value) return `PRODUCTION — ${props.env.name} · compte Cloudflare`;
  if (isRemote.value) return `Environnement distant — ${props.env.name} · compte Cloudflare`;
  return `Local — ${props.env.name} · aucune ressource distante touchée`;
});
</script>

<template>
  <!-- Bandeau permanent : la couleur dit où l'on agit, sans avoir à relire les flags. -->
  <div :class="cssClass">
    <i :class="isRemote ? 'pi pi-exclamation-triangle' : 'pi pi-desktop'" />
    <span>{{ label }}</span>
  </div>
</template>
