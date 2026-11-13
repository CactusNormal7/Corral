/**
 * Détection des fichiers de config wrangler dans un dossier de projet.
 * Un monorepo peut en contenir plusieurs (Occulis : apps/server/wrangler.toml).
 */
import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import type { WorkerRef } from "../../shared/types.js";

/** Noms exacts reconnus par wrangler, par ordre de priorité quand plusieurs coexistent. */
export const CONFIG_FILE_NAMES = ["wrangler.toml", "wrangler.jsonc", "wrangler.json"] as const;

/** Dossiers jamais parcourus : volumineux et sans config utile. */
export const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".wrangler",
  "dist",
  ".git",
  "out",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);

/** Profondeur maximale, pour qu'un dossier mal choisi ne fasse pas scanner tout le disque. */
const MAX_DEPTH = 6;

/**
 * Identifiant stable d'un Worker : dérivé du chemin de sa config, donc inchangé
 * entre deux scans tant que le fichier ne bouge pas.
 */
export function workerIdFor(projectId: string, configPath: string): string {
  return createHash("sha1").update(`${projectId}:${configPath}`).digest("hex").slice(0, 16);
}

interface FoundConfig {
  directory: string;
  fileName: string;
}

async function scan(root: string, current: string, depth: number): Promise<FoundConfig[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    // Dossier illisible (permissions, lien cassé) : on l'ignore sans faire échouer le scan.
    return [];
  }

  const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const found: FoundConfig[] = [];

  // Un dossier n'expose qu'une config : si wrangler.toml et wrangler.json coexistent,
  // wrangler lit le premier de la liste, donc Corral aussi.
  const fileName = CONFIG_FILE_NAMES.find((candidate) => names.has(candidate));
  if (fileName) found.push({ directory: current, fileName });

  if (depth >= MAX_DEPTH) return found;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    found.push(...(await scan(root, join(current, entry.name), depth + 1)));
  }
  return found;
}

/**
 * Liste les Workers d'un projet. Le `name` reste provisoire (nom du dossier) :
 * c'est `buildWorkerConfig` qui le remplace par celui déclaré dans la config.
 */
export async function discoverWorkers(
  projectId: string,
  projectPath: string,
): Promise<WorkerRef[]> {
  const found = await scan(projectPath, projectPath, 0);
  return found
    .map(({ directory, fileName }) => {
      const configPath = join(directory, fileName);
      const relativePath = relative(projectPath, configPath) || fileName;
      return {
        id: workerIdFor(projectId, configPath),
        projectId,
        name: relative(projectPath, directory).split(sep).pop() || fileName,
        configPath,
        relativePath,
      };
    })
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
