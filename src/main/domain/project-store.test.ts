import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectStore, projectIdFor } from "./project-store.js";

function store(): { dir: string; instance: ProjectStore } {
  const dir = mkdtempSync(join(tmpdir(), "corral-store-"));
  return { dir, instance: new ProjectStore(dir) };
}

describe("ProjectStore", () => {
  it("part d'un registre vide", async () => {
    expect(await store().instance.list()).toEqual([]);
  });

  it("ajoute, relit et persiste sur disque", async () => {
    const { dir, instance } = store();
    const added = await instance.add("/projets/occulis", "Occulis");
    expect(added.name).toBe("Occulis");
    expect(await new ProjectStore(dir).list()).toEqual([added]);
  });

  it("ne duplique pas un dossier déjà enregistré", async () => {
    const { instance } = store();
    const first = await instance.add("/projets/occulis", "Occulis");
    const second = await instance.add("/projets/occulis", "Autre nom");
    expect(second.id).toBe(first.id);
    expect(await instance.list()).toHaveLength(1);
  });

  it("renomme sans toucher au chemin", async () => {
    const { instance } = store();
    const project = await instance.add("/projets/occulis", "Occulis");
    await instance.rename(project.id, "Occulis v2");
    const reloaded = await instance.get(project.id);
    expect(reloaded?.name).toBe("Occulis v2");
    expect(reloaded?.path).toBe("/projets/occulis");
  });

  it("retire un projet du registre", async () => {
    const { instance } = store();
    const project = await instance.add("/projets/a", "A");
    await instance.add("/projets/b", "B");
    await instance.remove(project.id);
    expect((await instance.list()).map((p) => p.name)).toEqual(["B"]);
  });

  it("ignore le retrait d'un projet inconnu", async () => {
    const { instance } = store();
    await instance.add("/projets/a", "A");
    await instance.remove("inconnu");
    expect(await instance.list()).toHaveLength(1);
  });

  it("mémorise les envs marqués type production, par Worker", async () => {
    const { dir, instance } = store();
    const project = await instance.add("/projets/a", "A");
    await instance.setProdLike(project.id, "w1", ["live"]);
    expect(await new ProjectStore(dir).prodLikeFor(project.id, "w1")).toEqual(["live"]);
    expect(await instance.prodLikeFor(project.id, "w2")).toEqual([]);
  });

  it("efface le marquage quand la liste est vide", async () => {
    const { instance } = store();
    const project = await instance.add("/projets/a", "A");
    await instance.setProdLike(project.id, "w1", ["live"]);
    await instance.setProdLike(project.id, "w1", []);
    expect(await instance.prodLikeFor(project.id, "w1")).toEqual([]);
  });

  it("repart d'un registre vide si le fichier est corrompu, sans lever", async () => {
    const { dir } = store();
    writeFileSync(join(dir, "projects.json"), "{ pas du json");
    const instance = new ProjectStore(dir);
    expect(await instance.list()).toEqual([]);
    // Et il doit rester utilisable après coup.
    await instance.add("/projets/a", "A");
    expect(await instance.list()).toHaveLength(1);
  });

  it("écarte les entrées illisibles sans jeter les valides", async () => {
    const { dir } = store();
    writeFileSync(
      join(dir, "projects.json"),
      JSON.stringify({
        version: 1,
        projects: [{ id: "ok", path: "/projets/a", name: "A" }, { bancal: true }, null],
      }),
    );
    expect(await new ProjectStore(dir).list()).toEqual([
      { id: "ok", path: "/projets/a", name: "A" },
    ]);
  });

  it("écrit un JSON relisible", async () => {
    const { dir, instance } = store();
    await instance.add("/projets/a", "A");
    const raw = JSON.parse(readFileSync(join(dir, "projects.json"), "utf8")) as {
      version: number;
      projects: unknown[];
    };
    expect(raw.version).toBe(1);
    expect(raw.projects).toHaveLength(1);
  });
});

describe("projectIdFor", () => {
  it("est stable et distingue deux chemins", () => {
    expect(projectIdFor("/a")).toBe(projectIdFor("/a"));
    expect(projectIdFor("/a")).not.toBe(projectIdFor("/b"));
  });
});
