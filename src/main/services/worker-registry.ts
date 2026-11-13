/**
 * Résolution d'un identifiant de Worker vers tout ce qu'il faut pour lancer une
 * commande : sa config lue sur disque, son dossier d'exécution, et le wrangler du
 * projet. Lecture seule sur les fichiers du projet.
 */
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EnvConfig, Project, WorkerConfig, WorkerRef } from "../../shared/types.js";
import { buildWorkerConfig } from "../domain/config-parser.js";
import { discoverWorkers } from "../domain/worker-discovery.js";
import { detectPackageManager, wranglerCommand } from "../domain/wrangler-cli.js";
import type { ProjectStore } from "../domain/project-store.js";

export interface ResolvedWorker {
  project: Project;
  ref: WorkerRef;
  config: WorkerConfig;
  /** Dossier qui contient la config : c'est de là que wrangler doit être lancé. */
  cwd: string;
  command: string;
  /** Préfixe d'arguments (`exec wrangler`, `--no-install wrangler`…). */
  prefix: string[];
}

export class WorkerRegistry {
  /** Derniers refs connus par projet, pour résoudre un workerId sans rescanner. */
  private readonly refs = new Map<string, WorkerRef>();

  constructor(private readonly store: ProjectStore) {}

  async scan(projectId: string): Promise<WorkerRef[]> {
    const project = await this.store.get(projectId);
    if (!project) return [];
    const refs = await discoverWorkers(projectId, project.path);
    for (const ref of refs) this.refs.set(ref.id, ref);
    return refs;
  }

  /** Rescanne tous les projets : appelé au démarrage pour peupler la sidebar. */
  async scanAll(): Promise<void> {
    for (const project of await this.store.list()) await this.scan(project.id);
  }

  async resolve(workerId: string): Promise<ResolvedWorker> {
    let ref = this.refs.get(workerId);
    if (!ref) {
      // Un workerId venu d'un démarrage précédent : on rescanne avant d'abandonner.
      await this.scanAll();
      ref = this.refs.get(workerId);
    }
    if (!ref) throw new Error(`Worker inconnu : ${workerId}`);

    const project = await this.store.get(ref.projectId);
    if (!project) throw new Error(`Projet inconnu pour le Worker ${workerId}`);

    const cwd = dirname(ref.configPath);
    const prodLike = await this.store.prodLikeFor(project.id, workerId);
    const config = buildWorkerConfig(ref, await readFile(ref.configPath, "utf8"), prodLike);
    const manager = detectPackageManager(cwd, project.path);
    const { command, prefix } = wranglerCommand(manager);

    return { project, ref, config, cwd, command, prefix };
  }

  async envConfig(workerId: string, envName: string): Promise<EnvConfig | null> {
    const { config } = await this.resolve(workerId);
    return config.envs.find((env) => env.name === envName) ?? null;
  }
}
