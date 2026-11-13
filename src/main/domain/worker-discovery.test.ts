import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverWorkers, workerIdFor } from "./worker-discovery.js";

function fixture(files: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), "corral-scan-"));
  for (const relative of files) {
    const full = join(root, relative);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "");
  }
  return root;
}

describe("discoverWorkers", () => {
  it("trouve plusieurs configs dans un monorepo", async () => {
    const root = fixture(["apps/server/wrangler.toml", "apps/jobs/wrangler.jsonc"]);
    const workers = await discoverWorkers("p1", root);
    expect(workers.map((worker) => worker.relativePath)).toEqual([
      join("apps", "jobs", "wrangler.jsonc"),
      join("apps", "server", "wrangler.toml"),
    ]);
  });

  it("trouve une config à la racine", async () => {
    const workers = await discoverWorkers("p1", fixture(["wrangler.toml"]));
    expect(workers.map((worker) => worker.relativePath)).toEqual(["wrangler.toml"]);
  });

  it("ignore node_modules, .wrangler, dist et .git", async () => {
    const root = fixture([
      "wrangler.toml",
      "node_modules/pkg/wrangler.toml",
      ".wrangler/tmp/wrangler.toml",
      "dist/wrangler.toml",
      ".git/wrangler.toml",
    ]);
    const workers = await discoverWorkers("p1", root);
    expect(workers).toHaveLength(1);
    expect(workers[0]!.relativePath).toBe("wrangler.toml");
  });

  it("ne garde qu'une config par dossier, en préférant le TOML", async () => {
    const root = fixture(["wrangler.toml", "wrangler.json"]);
    const workers = await discoverWorkers("p1", root);
    expect(workers).toHaveLength(1);
    expect(workers[0]!.relativePath).toBe("wrangler.toml");
  });

  it("nomme provisoirement le Worker d'après son dossier", async () => {
    const workers = await discoverWorkers("p1", fixture(["apps/server/wrangler.toml"]));
    expect(workers[0]!.name).toBe("server");
  });

  it("renvoie une liste vide pour un dossier sans config", async () => {
    expect(await discoverWorkers("p1", fixture(["package.json"]))).toEqual([]);
  });

  it("ne lève pas sur un dossier inexistant", async () => {
    expect(await discoverWorkers("p1", join(tmpdir(), "corral-absent-xyz"))).toEqual([]);
  });

  it("donne des identifiants stables entre deux scans", async () => {
    const root = fixture(["wrangler.toml"]);
    const first = await discoverWorkers("p1", root);
    const second = await discoverWorkers("p1", root);
    expect(first[0]!.id).toBe(second[0]!.id);
  });

  it("donne des identifiants distincts à deux projets différents", () => {
    expect(workerIdFor("p1", "/a/wrangler.toml")).not.toBe(workerIdFor("p2", "/a/wrangler.toml"));
  });
});
