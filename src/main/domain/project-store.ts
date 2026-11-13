/**
 * Registre des projets, persisté en JSON dans `app.getPath('userData')`.
 * Le chemin est injecté pour que le store reste testable hors Electron.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { Project } from "../../shared/types.js";

interface StoreFile {
  version: 1;
  projects: Project[];
}

const EMPTY: StoreFile = { version: 1, projects: [] };

/** Identifiant stable d'un projet : dérivé de son chemin, donc jamais dupliqué. */
export function projectIdFor(path: string): string {
  return createHash("sha1").update(path).digest("hex").slice(0, 16);
}

function isProject(value: unknown): value is Project {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.path === "string";
}

export class ProjectStore {
  private readonly filePath: string;
  private cache: StoreFile | null = null;

  constructor(userDataDir: string) {
    this.filePath = join(userDataDir, "projects.json");
  }

  private async load(): Promise<StoreFile> {
    if (this.cache) return this.cache;
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
      const projects = (raw as StoreFile | null)?.projects;
      // Un registre corrompu ne doit pas empêcher l'app de démarrer : on garde
      // les entrées lisibles et on jette le reste.
      this.cache = {
        version: 1,
        projects: Array.isArray(projects) ? projects.filter(isProject) : [],
      };
    } catch {
      this.cache = { ...EMPTY, projects: [] };
    }
    return this.cache;
  }

  private async persist(): Promise<void> {
    const data = await this.load();
    await mkdir(dirname(this.filePath), { recursive: true });
    // Écriture atomique : une coupure en pleine écriture ne doit pas laisser un
    // registre tronqué, qui serait silencieusement vidé au prochain démarrage.
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(temporary, this.filePath);
  }

  async list(): Promise<Project[]> {
    return [...(await this.load()).projects];
  }

  async get(projectId: string): Promise<Project | null> {
    return (await this.load()).projects.find((project) => project.id === projectId) ?? null;
  }

  /** Ajoute un projet, ou renvoie l'existant si le dossier est déjà enregistré. */
  async add(path: string, name: string): Promise<Project> {
    const data = await this.load();
    const id = projectIdFor(path);
    const existing = data.projects.find((project) => project.id === id);
    if (existing) return existing;
    const project: Project = { id, name, path };
    data.projects.push(project);
    await this.persist();
    return project;
  }

  async remove(projectId: string): Promise<void> {
    const data = await this.load();
    const index = data.projects.findIndex((project) => project.id === projectId);
    if (index < 0) return;
    data.projects.splice(index, 1);
    await this.persist();
  }

  async rename(projectId: string, name: string): Promise<void> {
    const project = await this.get(projectId);
    if (!project) return;
    project.name = name;
    await this.persist();
  }

  /** Marque (ou démarque) des environnements comme « type production » pour un Worker. */
  async setProdLike(
    projectId: string,
    workerId: string,
    envNames: readonly string[],
  ): Promise<void> {
    const project = await this.get(projectId);
    if (!project) return;
    project.prodLikeEnvs ??= {};
    if (envNames.length === 0) delete project.prodLikeEnvs[workerId];
    else project.prodLikeEnvs[workerId] = [...envNames];
    await this.persist();
  }

  async prodLikeFor(projectId: string, workerId: string): Promise<string[]> {
    const project = await this.get(projectId);
    return project?.prodLikeEnvs?.[workerId] ?? [];
  }
}
