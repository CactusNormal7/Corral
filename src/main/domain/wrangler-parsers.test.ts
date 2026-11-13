import { describe, expect, it } from "vitest";
import {
  extractJson,
  isDevServerReady,
  localExplorerUrl,
  parseDevServerPort,
  parsePendingMigrations,
  saysMissing,
  saysNotAuthenticated,
  stripAnsi,
} from "./wrangler-parsers.js";

describe("stripAnsi", () => {
  it("retire les couleurs sans toucher au texte", () => {
    expect(stripAnsi("\u001B[90mundefined\u001B[39m \u001B[31mCommand not found\u001B[39m")).toBe(
      "undefined Command not found",
    );
  });

  it("laisse intact un texte sans séquence", () => {
    expect(stripAnsi("Deployed successfully")).toBe("Deployed successfully");
  });

  it("préserve les retours à la ligne", () => {
    expect(stripAnsi("\u001B[32ma\u001B[0m\nb")).toBe("a\nb");
  });
});

describe("extractJson", () => {
  it("ignore les bandeaux que wrangler imprime avant le JSON", () => {
    const stdout = [
      " ⛅️ wrangler 4.82.0",
      "-------------------",
      "Using vars defined in .dev.vars",
      '[{"name":"db","uuid":"abc"}]',
    ].join("\n");
    expect(extractJson(stdout)).toEqual([{ name: "db", uuid: "abc" }]);
  });

  it("ne se laisse pas piéger par un crochet dans un bandeau", () => {
    const stdout = ["[wrangler:info] démarrage", '{"ok":true}'].join("\n");
    expect(extractJson(stdout)).toEqual({ ok: true });
  });

  it("renvoie null quand il n'y a pas de JSON", () => {
    expect(extractJson("aucune sortie structurée")).toBeNull();
  });
});

describe("parsePendingMigrations", () => {
  it("renvoie une liste vide quand tout est appliqué", () => {
    expect(parsePendingMigrations("No migrations to apply!")).toEqual([]);
  });

  it("lit les noms dans un tableau encadré", () => {
    const stdout = [
      " ⛅️ wrangler 4.82.0",
      "Migrations to be applied:",
      "┌──────────────────────────┐",
      "│ Name                     │",
      "├──────────────────────────┤",
      "│ 0001_initial.sql         │",
      "├──────────────────────────┤",
      "│ 0002_add_users.sql       │",
      "└──────────────────────────┘",
    ].join("\n");
    expect(parsePendingMigrations(stdout)).toEqual(["0001_initial.sql", "0002_add_users.sql"]);
  });

  it("ignore les séquences de couleur", () => {
    const stdout = "│ \u001B[32m0003_index.sql\u001B[0m │";
    expect(parsePendingMigrations(stdout)).toEqual(["0003_index.sql"]);
  });

  it("ne retient que les fichiers .sql", () => {
    const stdout = [
      "Migrations to be applied:",
      "│ Name │",
      "│ 0001_a.sql │",
      "│ notes.txt │",
    ].join("\n");
    expect(parsePendingMigrations(stdout)).toEqual(["0001_a.sql"]);
  });

  it("déduplique", () => {
    expect(parsePendingMigrations("│ 0001_a.sql │\n│ 0001_a.sql │")).toEqual(["0001_a.sql"]);
  });
});

describe("parseDevServerPort", () => {
  it("lit le port réellement annoncé par wrangler", () => {
    expect(parseDevServerPort("[wrangler:info] Ready on http://localhost:8787")).toBe(8787);
    expect(parseDevServerPort("Ready on http://127.0.0.1:3001")).toBe(3001);
  });

  it("renvoie null sur une ligne sans URL", () => {
    expect(parseDevServerPort("Building...")).toBeNull();
  });

  it("ignore les URLs distantes", () => {
    expect(parseDevServerPort("Deployed to https://example.workers.dev:443")).toBeNull();
  });
});

describe("isDevServerReady", () => {
  it("détecte la ligne de disponibilité, couleurs comprises", () => {
    expect(isDevServerReady("\u001B[32mReady on\u001B[0m http://localhost:8787")).toBe(true);
    expect(isDevServerReady("Compiling...")).toBe(false);
  });
});

describe("localExplorerUrl", () => {
  it("pointe vers le Local Explorer embarqué par wrangler", () => {
    expect(localExplorerUrl(8787)).toBe("http://localhost:8787/cdn-cgi/explorer");
  });
});

describe("messages reconnus", () => {
  it("distingue une ressource absente d'une véritable erreur", () => {
    expect(saysMissing("Database 'x' does not exist")).toBe(true);
    expect(saysMissing("Internal error")).toBe(false);
  });

  it("détecte l'absence de session Cloudflare", () => {
    expect(saysNotAuthenticated("You are not authenticated. Run `wrangler login`")).toBe(true);
    expect(saysNotAuthenticated("Deployed successfully")).toBe(false);
  });
});
