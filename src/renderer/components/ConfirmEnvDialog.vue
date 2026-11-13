<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import type { GuardRequirement } from "@shared/types.js";

const props = defineProps<{
  visible: boolean;
  requirement: GuardRequirement | null;
  /** Ce que l'action va faire, en une phrase. */
  description: string;
}>();

const emit = defineEmits<{
  /** `confirmationText` est le texte retapé, vide si une simple confirmation suffit. */
  confirm: [confirmationText: string];
  cancel: [];
}>();

const typed = ref("");

watch(
  () => props.visible,
  (visible) => {
    if (visible) typed.value = "";
  },
);

const needsTyping = computed(() => props.requirement?.requiresTypedConfirmation === true);
const envLabel = computed(() => props.requirement?.envLabel ?? "");
// Comparaison exacte : c'est le même geste que côté main, affiché avant l'appel.
const canConfirm = computed(() => !needsTyping.value || typed.value === envLabel.value);
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :closable="false"
    :style="{ width: '32rem' }"
    header="Confirmer l'action distante"
    @update:visible="emit('cancel')"
  >
    <Message :severity="requirement?.isProdLike ? 'error' : 'warn'" :closable="false">
      {{
        requirement?.isProdLike
          ? `« ${envLabel} » est un environnement de production.`
          : `« ${envLabel} » est un environnement distant.`
      }}
    </Message>

    <p>{{ description }}</p>

    <div v-if="needsTyping">
      <label for="confirm-env">
        Retapez <strong>{{ envLabel }}</strong> pour confirmer :
      </label>
      <InputText
        id="confirm-env"
        v-model="typed"
        autocomplete="off"
        fluid
        @keyup.enter="canConfirm && emit('confirm', typed)"
      />
    </div>

    <template #footer>
      <Button label="Annuler" severity="secondary" text @click="emit('cancel')" />
      <Button
        :label="requirement?.isProdLike ? 'Appliquer en production' : 'Confirmer'"
        :severity="requirement?.isProdLike ? 'danger' : 'warn'"
        :disabled="!canConfirm"
        @click="emit('confirm', typed)"
      />
    </template>
  </Dialog>
</template>
