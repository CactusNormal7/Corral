/**
 * Lecture d'une config wrangler (TOML ou JSON/JSONC) vers le modèle `WorkerConfig`.
 * Lecture seule : aucune fonction de ce module n'écrit sur le disque.
 */
import { basename, dirname } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import type {
  D1Binding,
  EnvBindings,
  EnvConfig,
  SimpleBinding,
  WorkerConfig,
  WorkerRef,
} from "../../shared/types.js";

/** Nom de l'environnement par défaut (bloc racine), jamais un `[env.x]`. */
export const LOCAL_ENV = "local";

/** Noms qui désignent la production sans que l'utilisateur ait à le dire. */
const PROD_ENV_NAMES = new Set(["production", "prod"]);

/** Dossier de migrations par défaut de wrangler quand `migrations_dir` est absent. */
const DEFAULT_MIGRATIONS_DIR = "./migrations";

/**
 * Un `database_id` vide, ou qui ne ressemble pas à un UUID, est un marqueur laissé
 * par le développeur (Occulis utilise `REMPLACER_PAR_L_ID`). Les commandes distantes
 * échoueraient : on le signale plutôt que de laisser wrangler s'en plaindre plus tard.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawRecord = Record<string, unknown>;

export function isProdLikeName(envName: string): boolean {
  return PROD_ENV_NAMES.has(envName.toLowerCase());
}

function asRecord(value: unknown): RawRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RawRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** `routes` accepte des chaînes et des objets `{ pattern, custom_domain }`. */
function parseRoutes(raw: RawRecord): string[] {
  const routes = asArray(raw.routes).flatMap((entry) => {
    const direct = asString(entry);
    if (direct) return [direct];
    const pattern = asString(asRecord(entry)?.pattern);
    return pattern ? [pattern] : [];
  });
  // `route` au singulier est la forme historique, toujours acceptée par wrangler.
  const single = asString(raw.route);
  return single ? [single, ...routes] : routes;
}

function parseD1(raw: RawRecord): D1Binding[] {
  return asArray(raw.d1_databases).flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    const databaseId = asString(record.database_id);
    return [
      {
        binding: asString(record.binding) ?? "",
        databaseName: asString(record.database_name) ?? "",
        databaseId,
        isPlaceholder: databaseId === null || !UUID_PATTERN.test(databaseId),
        migrationsDir: asString(record.migrations_dir) ?? DEFAULT_MIGRATIONS_DIR,
      },
    ];
  });
}

/**
 * Les bindings simples ne portent pas tous la même clé : KV expose `id`, R2
 * `bucket_name`, un Durable Object `class_name` sous `name` (et non `binding`).
 */
function parseSimple(entries: unknown, nameKey: string, targetKey: string): SimpleBinding[] {
  return asArray(entries).flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    return [
      {
        binding: asString(record[nameKey]) ?? "",
        target: asString(record[targetKey]),
      },
    ];
  });
}

function parseBindings(raw: RawRecord): EnvBindings {
  const durableObjects = asRecord(raw.durable_objects);
  const queues = asRecord(raw.queues);
  return {
    d1: parseD1(raw),
    kv: parseSimple(raw.kv_namespaces, "binding", "id"),
    r2: parseSimple(raw.r2_buckets, "binding", "bucket_name"),
    durableObjects: parseSimple(durableObjects?.bindings, "name", "class_name"),
    queues: [
      ...parseSimple(queues?.producers, "binding", "queue"),
      // Un consumer n'a pas de binding : on l'identifie par sa file.
      ...parseSimple(queues?.consumers, "queue", "queue"),
    ],
  };
}

function parseCrons(raw: RawRecord): string[] {
  const triggers = asRecord(raw.triggers);
  return asArray(triggers?.crons).flatMap((entry) => {
    const cron = asString(entry);
    return cron ? [cron] : [];
  });
}

function parseEnv(
  name: string,
  raw: RawRecord,
  rootWorkerName: string | null,
  prodLikeOverrides: readonly string[],
): EnvConfig {
  const isRemote = name !== LOCAL_ENV;
  return {
    name,
    workerName: asString(raw.name) ?? rootWorkerName,
    bindings: parseBindings(raw),
    varNames: Object.keys(asRecord(raw.vars) ?? {}),
    routes: parseRoutes(raw),
    crons: parseCrons(raw),
    isRemote,
    // `local` ne vise jamais la prod, même si l'utilisateur l'a marqué par erreur.
    isProdLike: isRemote && (isProdLikeName(name) || prodLikeOverrides.includes(name)),
  };
}

/** Décode le texte d'une config selon son extension. Lève si le fichier est illisible. */
export function parseConfigText(configPath: string, text: string): RawRecord {
  if (configPath.endsWith(".toml")) {
    const parsed = asRecord(parseToml(text));
    if (!parsed) throw new Error("La racine du TOML n'est pas une table.");
    return parsed;
  }
  const errors: ParseError[] = [];
  // `allowTrailingComma` : wrangler accepte les .jsonc, donc les virgules finales.
  const parsed = asRecord(
    parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false }),
  );
  if (errors.length > 0 || !parsed) {
    throw new Error(`JSON invalide (${errors.length} erreur(s) de syntaxe).`);
  }
  return parsed;
}

/**
 * Construit le `WorkerConfig` depuis le texte brut de la config.
 * `local` est toujours en tête, suivi des `[env.x]` dans leur ordre de déclaration.
 */
export function buildWorkerConfig(
  ref: WorkerRef,
  text: string,
  prodLikeOverrides: readonly string[] = [],
): WorkerConfig {
  const warnings: string[] = [];
  const raw = parseConfigText(ref.configPath, text);
  const rootWorkerName = asString(raw.name);

  const envs: EnvConfig[] = [parseEnv(LOCAL_ENV, raw, rootWorkerName, prodLikeOverrides)];

  const envBlocks = asRecord(raw.env);
  for (const [name, block] of Object.entries(envBlocks ?? {})) {
    const record = asRecord(block);
    if (!record) {
      warnings.push(`Le bloc « env.${name} » n'est pas une table — ignoré.`);
      continue;
    }
    envs.push(parseEnv(name, record, rootWorkerName, prodLikeOverrides));
  }

  for (const env of envs) {
    for (const d1 of env.bindings.d1) {
      // Un placeholder sur un env n'empêche pas de travailler sur les autres : on
      // avertit sans invalider la config, comme `configuredDatabaseId` dans Occulis.
      if (d1.isPlaceholder) {
        warnings.push(
          `« ${env.name} » : database_id manquant ou invalide pour la base « ${d1.databaseName || d1.binding} ».`,
        );
      }
    }
  }

  return {
    ...ref,
    name: rootWorkerName ?? basename(dirname(ref.configPath)),
    envs,
    warnings,
  };
}
