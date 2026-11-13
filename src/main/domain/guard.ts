/**
 * Garde-fous des actions qui écrivent sur un environnement distant.
 * La décision est prise dans le main process : le renderer ne peut pas contourner
 * une confirmation en omettant le champ.
 */
import type { EnvConfig, EnvRef, GuardRequirement } from "../../shared/types.js";

/**
 * Toute écriture distante demande une confirmation ; un env de type production
 * demande en plus que son nom soit retapé à l'identique.
 */
export function requirementFor(env: EnvRef, config: EnvConfig | null): GuardRequirement {
  const isRemote = env.location === "remote";
  const isProdLike = isRemote && (config?.isProdLike ?? false);
  return {
    requiresConfirmation: isRemote,
    requiresTypedConfirmation: isProdLike,
    envLabel: env.name,
    isProdLike,
  };
}

export class GuardError extends Error {}

/**
 * Lève si la confirmation fournie ne satisfait pas l'exigence.
 * Appelée avant tout `spawn`, jamais après.
 */
export function assertConfirmed(requirement: GuardRequirement, confirmationText?: string): void {
  if (!requirement.requiresConfirmation) return;
  if (!requirement.requiresTypedConfirmation) {
    if (confirmationText === undefined) {
      throw new GuardError(
        `Action distante sur « ${requirement.envLabel} » : confirmation manquante.`,
      );
    }
    return;
  }
  // Comparaison exacte, sans normalisation : retaper le nom est précisément le geste
  // qui doit coûter quelque chose.
  if (confirmationText !== requirement.envLabel) {
    throw new GuardError(
      `Confirmation incorrecte pour « ${requirement.envLabel} » — rien n'a été lancé.`,
    );
  }
}
