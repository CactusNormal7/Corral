/**
 * Détermine comment appeler le wrangler **du projet** et construit les argv.
 * Jamais de concaténation de chaîne : les arguments restent un tableau passé à `spawn`.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EnvRef, PackageManager } from "../../shared/types.js";
import { LOCAL_ENV } from "./config-parser.js";

/** Lockfile → gestionnaire de paquets, dans l'ordre où on les teste. */
const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/**
 * Cherche un lockfile en remontant depuis le dossier de la config : dans un
 * monorepo pnpm, le lockfile est à la racine, pas à côté de wrangler.toml.
 * `npm` par défaut, car `npx wrangler` fonctionne partout.
 */
export function detectPackageManager(startDir: string, stopDir?: string): PackageManager {
  let current = startDir;
  for (;;) {
    for (const [file, manager] of LOCKFILES) {
      if (existsSync(join(current, file))) return manager;
    }
    const parent = dirname(current);
    if (parent === current) break;
    if (stopDir && !parent.startsWith(stopDir)) break;
    current = parent;
  }
  return "npm";
}

/**
 * Commande et préfixe d'arguments pour exécuter le wrangler local.
 * Jamais un wrangler global : les versions diffèrent par projet.
 */
export function wranglerCommand(manager: PackageManager): { command: string; prefix: string[] } {
  switch (manager) {
    case "pnpm":
      return { command: "pnpm", prefix: ["exec", "wrangler"] };
    case "yarn":
      return { command: "yarn", prefix: ["wrangler"] };
    case "bun":
      return { command: "bunx", prefix: ["wrangler"] };
    case "npm":
      // `--no-install` : si wrangler n'est pas dans le projet, on veut une erreur
      // explicite plutôt qu'un téléchargement silencieux d'une version arbitraire.
      return { command: "npx", prefix: ["--no-install", "wrangler"] };
  }
}

/**
 * Drapeau d'environnement. Les bindings ne sont pas hérités par les environnements
 * nommés : toute commande visant un `[env.x]` doit porter `--env x`, sinon wrangler
 * ne lit que la configuration par défaut.
 */
export function envFlag(envName: string): string[] {
  return envName === LOCAL_ENV ? [] : ["--env", envName];
}

/** `--local` ou `--remote` selon la cible. */
export function locationFlag(location: EnvRef["location"]): string[] {
  return location === "local" ? ["--local"] : ["--remote"];
}

export function migrationsListArgs(databaseName: string, env: EnvRef): string[] {
  return [
    "d1",
    "migrations",
    "list",
    databaseName,
    ...locationFlag(env.location),
    ...envFlag(env.name),
  ];
}

export function migrationsApplyArgs(databaseName: string, env: EnvRef): string[] {
  return [
    "d1",
    "migrations",
    "apply",
    databaseName,
    ...locationFlag(env.location),
    ...envFlag(env.name),
  ];
}

export function d1ExecuteArgs(databaseName: string, env: EnvRef, sql: string): string[] {
  return [
    "d1",
    "execute",
    databaseName,
    ...locationFlag(env.location),
    ...envFlag(env.name),
    "--command",
    sql,
  ];
}

export function d1InfoArgs(databaseName: string, env: EnvRef): string[] {
  return ["d1", "info", databaseName, ...envFlag(env.name), "--json"];
}

export function deployArgs(envName: string): string[] {
  return ["deploy", ...envFlag(envName)];
}

export function deploymentsListArgs(envName: string): string[] {
  return ["deployments", "list", ...envFlag(envName)];
}

export function tailArgs(envName: string): string[] {
  return ["tail", ...envFlag(envName)];
}

/** `wrangler dev` tourne toujours sur la config par défaut, jamais sur un env nommé. */
export function devArgs(): string[] {
  return ["dev"];
}

/** Ligne affichée à l'utilisateur pour qu'il sache quoi reproduire en terminal. */
export function formatCommandLine(command: string, args: readonly string[]): string {
  return [command, ...args]
    .map((part) => (/[\s"']/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}
