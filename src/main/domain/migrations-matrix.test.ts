import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMigrationsMatrix,
  envKey,
  listMigrationFiles,
  resolveMigrationsDir,
  toMigrationsReport,
} from "./migrations-matrix.js";
import type { EnvRef, MigrationsForEnv } from "../../shared/types.js";

const local: EnvRef = { name: "local", location: "local" };
const staging: EnvRef = { name: "staging", location: "remote" };
const production: EnvRef = { name: "production", location: "remote" };

describe("resolveMigrationsDir", () => {
  it("résout le chemin relatif depuis le dossier de la config", () => {
    expect(resolveMigrationsDir("/projet/apps/server", "./migrations")).toBe(
      join("/projet/apps/server", "migrations"),
    );
  });

  it("laisse un chemin absolu intact", () => {
    expect(resolveMigrationsDir("/projet", "/ailleurs/migrations")).toBe("/ailleurs/migrations");
  });
});

describe("listMigrationFiles", () => {
  it("liste les .sql triés numériquement", async () => {
    const root = mkdtempSync(join(tmpdir(), "corral-mig-"));
    mkdirSync(join(root, "migrations"));
    for (const name of ["0010_j.sql", "0002_b.sql", "0001_a.sql", "notes.md"]) {
      writeFileSync(join(root, "migrations", name), "");
    }
    expect(await listMigrationFiles(join(root, "migrations"))).toEqual([
      "0001_a.sql",
      "0002_b.sql",
      "0010_j.sql",
    ]);
  });

  it("renvoie une liste vide si le dossier n'existe pas", async () => {
    expect(await listMigrationFiles(join(tmpdir(), "corral-absent-mig"))).toEqual([]);
  });
});

describe("toMigrationsReport", () => {
  it("déduit les appliquées des fichiers moins les en attente", () => {
    const report = toMigrationsReport(local, ["0001_a.sql", "0002_b.sql"], ["0002_b.sql"]);
    expect(report.migrations).toEqual([
      { fileName: "0001_a.sql", applied: true },
      { fileName: "0002_b.sql", applied: false },
    ]);
  });

  it("marque tout appliqué quand rien n'est en attente", () => {
    const report = toMigrationsReport(staging, ["0001_a.sql"], []);
    expect(report.migrations).toEqual([{ fileName: "0001_a.sql", applied: true }]);
  });

  it("remonte une migration en attente absente du disque", () => {
    const report = toMigrationsReport(local, [], ["0003_ghost.sql"]);
    expect(report.migrations).toEqual([{ fileName: "0003_ghost.sql", applied: false }]);
  });
});

describe("buildMigrationsMatrix", () => {
  const files = ["0001_a.sql", "0002_b.sql"];

  it("croise fichiers et environnements", () => {
    const reports: MigrationsForEnv[] = [
      toMigrationsReport(local, files, []),
      toMigrationsReport(staging, files, ["0002_b.sql"]),
    ];
    const matrix = buildMigrationsMatrix(files, [local, staging], reports);

    expect(matrix.rows.map((row) => row.fileName)).toEqual(files);
    expect(matrix.rows[0]!.cells.map((cell) => cell.state)).toEqual(["applied", "applied"]);
    expect(matrix.rows[1]!.cells.map((cell) => cell.state)).toEqual(["applied", "pending"]);
  });

  it("laisse unknown un env jamais rafraîchi plutôt que de le supposer appliqué", () => {
    const matrix = buildMigrationsMatrix(
      files,
      [local, production],
      [toMigrationsReport(local, files, [])],
    );
    expect(matrix.rows[0]!.cells.map((cell) => cell.state)).toEqual(["applied", "unknown"]);
  });

  it("laisse unknown un env dont le relevé a échoué", () => {
    const failed: MigrationsForEnv = {
      env: staging,
      status: "error",
      migrations: [],
      error: "Authentication error",
    };
    const matrix = buildMigrationsMatrix(files, [staging], [failed]);
    expect(matrix.rows[0]!.cells[0]!.state).toBe("unknown");
  });

  it("ajoute en fin de matrice une migration vue par wrangler mais absente du disque", () => {
    const reports = [toMigrationsReport(staging, [], ["0009_removed.sql"])];
    const matrix = buildMigrationsMatrix(files, [staging], reports);
    expect(matrix.fileNames).toEqual([...files, "0009_removed.sql"]);
    expect(matrix.rows.at(-1)!.cells[0]!.state).toBe("pending");
  });

  it("distingue le même nom d'env en local et en distant", () => {
    const localDefault: EnvRef = { name: "local", location: "local" };
    const remoteDefault: EnvRef = { name: "local", location: "remote" };
    const matrix = buildMigrationsMatrix(
      files,
      [localDefault, remoteDefault],
      [toMigrationsReport(localDefault, files, ["0001_a.sql"])],
    );
    expect(matrix.rows[0]!.cells.map((cell) => cell.state)).toEqual(["pending", "unknown"]);
  });

  it("gère une matrice sans aucun fichier", () => {
    const matrix = buildMigrationsMatrix([], [local], [toMigrationsReport(local, [], [])]);
    expect(matrix.rows).toEqual([]);
  });
});

describe("envKey", () => {
  it("sépare nom et emplacement", () => {
    expect(envKey(local)).toBe("local:local");
    expect(envKey({ name: "local", location: "remote" })).toBe("local:remote");
  });
});
