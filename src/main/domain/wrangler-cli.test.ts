import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  d1ExecuteArgs,
  deployArgs,
  detectPackageManager,
  envFlag,
  formatCommandLine,
  locationFlag,
  migrationsApplyArgs,
  migrationsListArgs,
  wranglerCommand,
} from "./wrangler-cli.js";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "corral-cli-"));
  for (const [relative, content] of Object.entries(files)) {
    const full = join(root, relative);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe("detectPackageManager", () => {
  it("remonte jusqu'à la racine du monorepo pour trouver le lockfile", () => {
    const root = fixture({
      "pnpm-lock.yaml": "",
      "apps/server/wrangler.toml": "",
    });
    expect(detectPackageManager(join(root, "apps/server"))).toBe("pnpm");
  });

  it("reconnaît npm, yarn et bun", () => {
    expect(detectPackageManager(fixture({ "package-lock.json": "" }))).toBe("npm");
    expect(detectPackageManager(fixture({ "yarn.lock": "" }))).toBe("yarn");
    expect(detectPackageManager(fixture({ "bun.lockb": "" }))).toBe("bun");
  });

  it("préfère pnpm quand plusieurs lockfiles coexistent", () => {
    const root = fixture({ "pnpm-lock.yaml": "", "package-lock.json": "" });
    expect(detectPackageManager(root)).toBe("pnpm");
  });

  it("retombe sur npm sans lockfile", () => {
    expect(detectPackageManager(fixture({ "wrangler.toml": "" }))).toBe("npm");
  });
});

describe("wranglerCommand", () => {
  it("utilise toujours le wrangler du projet, jamais un global", () => {
    expect(wranglerCommand("pnpm")).toEqual({ command: "pnpm", prefix: ["exec", "wrangler"] });
    expect(wranglerCommand("npm")).toEqual({
      command: "npx",
      prefix: ["--no-install", "wrangler"],
    });
    expect(wranglerCommand("yarn")).toEqual({ command: "yarn", prefix: ["wrangler"] });
    expect(wranglerCommand("bun")).toEqual({ command: "bunx", prefix: ["wrangler"] });
  });
});

describe("envFlag", () => {
  it("n'ajoute rien pour local", () => {
    expect(envFlag("local")).toEqual([]);
  });

  it("passe --env pour tout env nommé, car les bindings ne sont pas hérités", () => {
    expect(envFlag("staging")).toEqual(["--env", "staging"]);
    expect(envFlag("production")).toEqual(["--env", "production"]);
  });
});

describe("construction des commandes", () => {
  it("local : --local et pas de --env", () => {
    expect(migrationsListArgs("db-local", { name: "local", location: "local" })).toEqual([
      "d1",
      "migrations",
      "list",
      "db-local",
      "--local",
    ]);
  });

  it("env nommé distant : --remote et --env", () => {
    expect(migrationsApplyArgs("db-staging", { name: "staging", location: "remote" })).toEqual([
      "d1",
      "migrations",
      "apply",
      "db-staging",
      "--remote",
      "--env",
      "staging",
    ]);
  });

  it("passe le SQL comme argument distinct, jamais interpolé", () => {
    const sql = `SELECT * FROM users WHERE name = 'o''brien'; DROP TABLE x;`;
    const args = d1ExecuteArgs("db", { name: "local", location: "local" }, sql);
    // La requête reste un seul élément du tableau : aucun shell ne la redécoupe.
    expect(args.at(-1)).toBe(sql);
    expect(args.at(-2)).toBe("--command");
  });

  it("locationFlag distingue local et remote", () => {
    expect(locationFlag("local")).toEqual(["--local"]);
    expect(locationFlag("remote")).toEqual(["--remote"]);
  });

  it("deploy porte --env pour un env nommé", () => {
    expect(deployArgs("staging")).toEqual(["deploy", "--env", "staging"]);
    expect(deployArgs("local")).toEqual(["deploy"]);
  });
});

describe("formatCommandLine", () => {
  it("cite les arguments contenant des espaces pour rester copiable", () => {
    expect(
      formatCommandLine("pnpm", ["exec", "wrangler", "d1", "execute", "--command", "SELECT 1"]),
    ).toBe('pnpm exec wrangler d1 execute --command "SELECT 1"');
  });
});
