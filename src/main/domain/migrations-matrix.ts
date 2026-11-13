/**
 * Agrégation de la matrice migrations × environnements.
 * `wrangler d1 migrations list` ne renvoie que les migrations en attente : la liste
 * complète vient des fichiers sur disque, et `appliquée = présente ∖ en attente`.
 */
import { readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type {
  EnvRef,
  MigrationCell,
  MigrationsForEnv,
  MigrationsMatrix,
} from "../../shared/types.js";

/**
 * Résout le dossier de migrations déclaré dans la config, relativement au dossier
 * qui contient cette config (c'est ainsi que wrangler l'interprète).
 */
export function resolveMigrationsDir(configDir: string, migrationsDir: string): string {
  return isAbsolute(migrationsDir) ? migrationsDir : resolve(configDir, migrationsDir);
}

/**
 * Fichiers de migration présents sur disque, triés par nom — wrangler les applique
 * dans cet ordre, c'est donc celui des lignes de la matrice.
 */
export async function listMigrationFiles(migrationsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(migrationsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  } catch {
    // Dossier absent : un Worker peut déclarer une base D1 sans migration.
    return [];
  }
}

export function migrationsDirPath(configDir: string, migrationsDir: string): string {
  return join(resolveMigrationsDir(configDir, migrationsDir));
}

/**
 * Construit la matrice depuis les fichiers sur disque et les relevés par env.
 * Un env dont le relevé a échoué, ou qui n'a pas été rafraîchi, donne des cases
 * `unknown` : on n'affirme jamais qu'une migration est appliquée sans l'avoir lu.
 */
export function buildMigrationsMatrix(
  fileNames: readonly string[],
  envs: readonly EnvRef[],
  reports: readonly MigrationsForEnv[],
): MigrationsMatrix {
  const byEnv = new Map(reports.map((report) => [envKey(report.env), report]));

  // Une migration vue par wrangler mais absente du disque existe quand même : un
  // fichier supprimé après coup reste appliqué côté base, il faut le montrer.
  const extra = reports
    .flatMap((report) => report.migrations.map((migration) => migration.fileName))
    .filter((name) => !fileNames.includes(name));
  const allFiles = [...fileNames, ...new Set(extra)];

  const rows = allFiles.map((fileName) => {
    const cells: MigrationCell[] = envs.map((env) => {
      const report = byEnv.get(envKey(env));
      if (!report || report.status === "error") return { env, state: "unknown" };
      const found = report.migrations.find((migration) => migration.fileName === fileName);
      if (!found) return { env, state: "unknown" };
      return { env, state: found.applied ? "applied" : "pending" };
    });
    return { fileName, cells };
  });

  return { fileNames: allFiles, envs: [...envs], rows };
}

/** Clé de comparaison d'un `EnvRef` : nom + emplacement, car `local` et `remote` diffèrent. */
export function envKey(env: EnvRef): string {
  return `${env.name}:${env.location}`;
}

/**
 * Transforme un relevé brut (fichiers sur disque + noms en attente rapportés par
 * wrangler) en statuts par fichier.
 */
export function toMigrationsReport(
  env: EnvRef,
  fileNames: readonly string[],
  pendingNames: readonly string[],
): MigrationsForEnv {
  const pending = new Set(pendingNames);
  return {
    env,
    status: "loaded",
    migrations: [
      ...fileNames.map((fileName) => ({ fileName, applied: !pending.has(fileName) })),
      // Une migration en attente que le disque ne connaît pas : wrangler l'a vue,
      // on la remonte telle quelle plutôt que de la perdre.
      ...pendingNames
        .filter((name) => !fileNames.includes(name))
        .map((fileName) => ({ fileName, applied: false })),
    ],
  };
}
