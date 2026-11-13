/**
 * Chargement des actions personnalisées : `corral.json` à la racine du projet, plus
 * les scripts du `package.json` racine proposés en lecture.
 * Ce sont les seules commandes qui passent par un shell, puisque c'est l'utilisateur
 * qui les a écrites dans son propre dépôt.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import type { CustomAction } from "../../shared/types.js";

/** Scripts de cycle de vie npm : lancés automatiquement, inutiles comme boutons. */
const LIFECYCLE_SCRIPTS = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "prepare",
  "prepublishOnly",
  "prepack",
  "postpack",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return parseJsonc(await readFile(path, "utf8"), [], { allowTrailingComma: true });
  } catch {
    return null;
  }
}

async function loadCorralActions(projectPath: string): Promise<CustomAction[]> {
  const raw = asRecord(await readJsonFile(join(projectPath, "corral.json")));
  const actions = raw?.actions;
  if (!Array.isArray(actions)) return [];

  return actions.flatMap((entry) => {
    const record = asRecord(entry);
    const id = typeof record?.id === "string" ? record.id : null;
    const command = typeof record?.command === "string" ? record.command : null;
    if (!record || !id || !command) return [];
    return [
      {
        id,
        label: typeof record.label === "string" ? record.label : id,
        command,
        interactive: record.interactive === true,
        source: "corral.json" as const,
        cwd: typeof record.cwd === "string" ? record.cwd : ".",
      },
    ];
  });
}

async function loadPackageScripts(projectPath: string): Promise<CustomAction[]> {
  const raw = asRecord(await readJsonFile(join(projectPath, "package.json")));
  const scripts = asRecord(raw?.scripts);
  if (!scripts) return [];

  return Object.keys(scripts)
    .filter((name) => !LIFECYCLE_SCRIPTS.has(name))
    .map((name) => ({
      id: `script:${name}`,
      label: name,
      // Le script est lancé par son nom : Corral ne recopie pas son contenu.
      command: `npm run ${name}`,
      interactive: false,
      source: "package.json" as const,
      cwd: ".",
    }));
}

/**
 * Fusionne les deux sources. Une action de `corral.json` l'emporte sur un script
 * homonyme : c'est la déclaration explicite de l'utilisateur.
 */
export async function loadCustomActions(projectPath: string): Promise<CustomAction[]> {
  const declared = await loadCorralActions(projectPath);
  const declaredIds = new Set(declared.map((action) => action.id));
  const scripts = (await loadPackageScripts(projectPath)).filter(
    (action) => !declaredIds.has(action.id),
  );
  return [...declared, ...scripts];
}
