/**
 * Modèle de données partagé entre le main process et le renderer.
 * Aucun import Node ici : ce fichier est compilé dans les deux cibles.
 */

/** Un dossier de projet enregistré par l'utilisateur. */
export interface Project {
  id: string;
  name: string;
  /** Chemin absolu du dossier choisi dans le sélecteur natif. */
  path: string;
  /**
   * Environnements que l'utilisateur a marqués « type production », par id de Worker.
   * Corral ne peut pas le déduire de la config : seul l'utilisateur sait que son
   * env `live` ou `canary` est en réalité la prod.
   */
  prodLikeEnvs?: Record<string, string[]>;
}

/** Un fichier de config wrangler détecté dans un projet = un Worker. */
export interface WorkerRef {
  id: string;
  projectId: string;
  /** Nom déclaré dans la config, ou le nom du dossier à défaut. */
  name: string;
  /** Chemin absolu du fichier wrangler.toml|json|jsonc. */
  configPath: string;
  /** Chemin du fichier relatif à la racine du projet, pour l'affichage. */
  relativePath: string;
}

export type BindingKind = "d1" | "kv" | "r2" | "durableObject" | "queue";

export interface D1Binding {
  binding: string;
  databaseName: string;
  databaseId: string | null;
  /**
   * `database_id` absent, vide, ou visiblement un marqueur à remplacer.
   * Les commandes distantes échoueront : l'UI doit le signaler.
   */
  isPlaceholder: boolean;
  /** Dossier des migrations déclaré dans la config, défaut wrangler `./migrations`. */
  migrationsDir: string;
}

export interface SimpleBinding {
  binding: string;
  /** `id` pour KV, `bucket_name` pour R2, `class_name` pour un DO, `queue` pour une Queue. */
  target: string | null;
}

export interface EnvBindings {
  d1: D1Binding[];
  kv: SimpleBinding[];
  r2: SimpleBinding[];
  durableObjects: SimpleBinding[];
  queues: SimpleBinding[];
}

export interface EnvConfig {
  /** `local` pour la config par défaut, sinon le nom du bloc `[env.x]`. */
  name: string;
  /** Nom du Worker pour cet env (`name` du bloc, ou celui de la racine). */
  workerName: string | null;
  bindings: EnvBindings;
  /** Noms seulement : Corral n'affiche jamais la valeur d'une var. */
  varNames: string[];
  routes: string[];
  crons: string[];
  /**
   * `false` seulement pour `local`. Un env nommé cible le compte Cloudflare,
   * donc déclenche le bandeau de l'UI et les confirmations.
   */
  isRemote: boolean;
  /** Nom reconnu comme prod, ou marqué par l'utilisateur. */
  isProdLike: boolean;
}

export interface WorkerConfig extends WorkerRef {
  envs: EnvConfig[];
  /** Erreurs de parsing non bloquantes à afficher dans l'UI. */
  warnings: string[];
}

/** Désigne un environnement et l'endroit où la commande doit agir. */
export interface EnvRef {
  name: string;
  location: "local" | "remote";
}

export interface MigrationStatus {
  /** Nom du fichier de migration tel que wrangler le liste. */
  fileName: string;
  applied: boolean;
}

export interface MigrationsForEnv {
  env: EnvRef;
  status: "loaded" | "error";
  migrations: MigrationStatus[];
  /** Message wrangler en cas d'échec, affiché tel quel. */
  error?: string;
}

/** Une case de la matrice : un fichier de migration × un environnement. */
export interface MigrationCell {
  env: EnvRef;
  state: "applied" | "pending" | "unknown";
}

export interface MigrationsMatrix {
  /** Union ordonnée de tous les fichiers vus sur tous les envs chargés. */
  fileNames: string[];
  /** Envs présents en colonnes, dans l'ordre d'affichage. */
  envs: EnvRef[];
  rows: Array<{ fileName: string; cells: MigrationCell[] }>;
}

export type DevServerState = "stopped" | "starting" | "running" | "crashed";

export interface DevServerStatus {
  workerId: string;
  state: DevServerState;
  /** Session PTY associée, pour brancher xterm. */
  sessionId: string | null;
  /** Port détecté dans la sortie de wrangler dev. */
  port: number | null;
  /** Code de sortie si le process s'est arrêté (130 = tué par signal). */
  exitCode?: number;
}

export type OutputLevel = "info" | "step" | "ok" | "warn" | "fail" | "raw";

export interface OutputLine {
  level: OutputLevel;
  text: string;
  /** Epoch ms. */
  at: number;
}

export interface OutputTab {
  id: string;
  /** Libellé affiché dans l'onglet, ex. « Migrations · staging ». */
  label: string;
  /** Commande effectivement lancée, pour que l'utilisateur sache quoi reproduire. */
  commandLine: string;
  status: "running" | "ok" | "fail";
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
}

/** Résultat d'une commande courte, renvoyé directement sans onglet de log. */
export interface CommandResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  commandLine: string;
}

/** Ce que l'UI doit exiger avant de lancer une action qui écrit sur un env distant. */
export interface GuardRequirement {
  /** Aucune confirmation pour `local`. */
  requiresConfirmation: boolean;
  /** L'utilisateur doit retaper `envLabel` à l'identique. */
  requiresTypedConfirmation: boolean;
  envLabel: string;
  isProdLike: boolean;
}

export interface CustomAction {
  id: string;
  label: string;
  /** Ligne de commande écrite par l'utilisateur dans corral.json ou package.json. */
  command: string;
  /** Lancée dans un PTY plutôt que dans un onglet de log. */
  interactive: boolean;
  /** `corral.json` ou `package.json`, pour distinguer dans l'UI. */
  source: "corral.json" | "package.json";
  /** Dossier d'exécution, relatif à la racine du projet. */
  cwd: string;
}

/** Gestionnaire de paquets détecté, qui détermine comment appeler wrangler. */
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";
