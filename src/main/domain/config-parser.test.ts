import { describe, expect, it } from "vitest";
import { buildWorkerConfig, isProdLikeName, parseConfigText } from "./config-parser.js";
import type { WorkerRef } from "../../shared/types.js";

const ref: WorkerRef = {
  id: "w1",
  projectId: "p1",
  name: "server",
  configPath: "/projet/apps/server/wrangler.toml",
  relativePath: "apps/server/wrangler.toml",
};

const jsonRef: WorkerRef = { ...ref, configPath: "/projet/wrangler.jsonc" };

const OCCULIS_LIKE = `
name = "occulis"
main = "src/index.ts"
compatibility_date = "2025-01-01"

routes = [{ pattern = "occulis.0kl.fr", custom_domain = true }]

[[d1_databases]]
binding = "DB"
database_name = "occulis-local"
database_id = "11111111-2222-3333-4444-555555555555"

[[kv_namespaces]]
binding = "CACHE"
id = "abc123"

[[r2_buckets]]
binding = "MEDIA"
bucket_name = "occulis-media"

[[durable_objects.bindings]]
name = "MATCH"
class_name = "MatchDO"

[vars]
MAIL_TO_CONSOLE = "on"
LOG_LEVEL = "debug"

[triggers]
crons = ["0 4 * * *"]

[env.staging]
name = "occulis-staging"
routes = [{ pattern = "occulis-staging.0kl.fr", custom_domain = true }]

[[env.staging.d1_databases]]
binding = "DB"
database_name = "occulis-staging"
database_id = "99999999-8888-7777-6666-555555555555"

[env.production]
name = "occulis-prod"

[[env.production.d1_databases]]
binding = "DB"
database_name = "occulis-prod"
database_id = "REMPLACER_PAR_L_ID"
`;

describe("buildWorkerConfig (TOML)", () => {
  const config = buildWorkerConfig(ref, OCCULIS_LIKE);

  it("prend le nom déclaré dans la config", () => {
    expect(config.name).toBe("occulis");
  });

  it("place local en tête puis les blocs [env.x] dans l'ordre déclaré", () => {
    expect(config.envs.map((env) => env.name)).toEqual(["local", "staging", "production"]);
  });

  it("marque local comme non distant et tous les envs nommés comme distants", () => {
    expect(config.envs.map((env) => env.isRemote)).toEqual([false, true, true]);
  });

  it("reconnaît production comme env de type prod, sans marquage utilisateur", () => {
    expect(config.envs.find((env) => env.name === "production")?.isProdLike).toBe(true);
    expect(config.envs.find((env) => env.name === "staging")?.isProdLike).toBe(false);
  });

  it("lit les bindings de la config par défaut", () => {
    const local = config.envs[0]!;
    expect(local.bindings.d1).toEqual([
      {
        binding: "DB",
        databaseName: "occulis-local",
        databaseId: "11111111-2222-3333-4444-555555555555",
        isPlaceholder: false,
        migrationsDir: "./migrations",
      },
    ]);
    expect(local.bindings.kv).toEqual([{ binding: "CACHE", target: "abc123" }]);
    expect(local.bindings.r2).toEqual([{ binding: "MEDIA", target: "occulis-media" }]);
    // Un Durable Object déclare son binding sous `name`, pas `binding`.
    expect(local.bindings.durableObjects).toEqual([{ binding: "MATCH", target: "MatchDO" }]);
  });

  it("n'expose que les noms des vars, jamais leurs valeurs", () => {
    const local = config.envs[0]!;
    expect(local.varNames).toEqual(["MAIL_TO_CONSOLE", "LOG_LEVEL"]);
    expect(JSON.stringify(local)).not.toContain("debug");
  });

  it("lit les routes objet comme les routes chaîne", () => {
    expect(config.envs[0]!.routes).toEqual(["occulis.0kl.fr"]);
    expect(config.envs.find((env) => env.name === "staging")?.routes).toEqual([
      "occulis-staging.0kl.fr",
    ]);
  });

  it("lit les crons", () => {
    expect(config.envs[0]!.crons).toEqual(["0 4 * * *"]);
  });

  it("ne fait pas hériter les bindings aux envs nommés", () => {
    // Les envs nommés ne reçoivent pas les bindings de la racine : staging ne doit
    // donc voir ni KV ni DO, même si la config par défaut en déclare.
    const staging = config.envs.find((env) => env.name === "staging")!;
    expect(staging.bindings.kv).toEqual([]);
    expect(staging.bindings.durableObjects).toEqual([]);
  });

  it("signale un database_id placeholder et l'ajoute aux avertissements", () => {
    const production = config.envs.find((env) => env.name === "production")!;
    expect(production.bindings.d1[0]!.isPlaceholder).toBe(true);
    expect(config.warnings.some((warning) => warning.includes("production"))).toBe(true);
  });

  it("n'avertit pas pour les envs dont le database_id est valide", () => {
    expect(config.warnings.some((warning) => warning.includes("staging"))).toBe(false);
  });
});

describe("buildWorkerConfig (JSONC)", () => {
  it("accepte commentaires et virgules finales", () => {
    const text = `{
      // nom du Worker
      "name": "api",
      "d1_databases": [
        { "binding": "DB", "database_name": "api-db", "database_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      ],
      "env": {
        "prod": { "name": "api-prod" }
      }
    }`;
    const config = buildWorkerConfig(jsonRef, text);
    expect(config.name).toBe("api");
    expect(config.envs.map((env) => env.name)).toEqual(["local", "prod"]);
    expect(config.envs.find((env) => env.name === "prod")?.isProdLike).toBe(true);
  });

  it("lève sur un JSON syntaxiquement invalide", () => {
    expect(() => parseConfigText("/x/wrangler.json", "{ oops")).toThrow();
  });
});

describe("marquage utilisateur", () => {
  it("traite un env marqué par l'utilisateur comme prod", () => {
    const config = buildWorkerConfig(ref, OCCULIS_LIKE, ["staging"]);
    expect(config.envs.find((env) => env.name === "staging")?.isProdLike).toBe(true);
  });

  it("ne marque jamais local comme prod, même si l'utilisateur le demande", () => {
    const config = buildWorkerConfig(ref, OCCULIS_LIKE, ["local"]);
    expect(config.envs[0]!.isProdLike).toBe(false);
  });
});

describe("configs dégradées", () => {
  it("se replie sur le nom du dossier quand la config ne déclare pas de nom", () => {
    const config = buildWorkerConfig(ref, `compatibility_date = "2025-01-01"`);
    expect(config.name).toBe("server");
  });

  it("tolère un bloc env qui n'est pas une table", () => {
    const config = buildWorkerConfig(jsonRef, `{ "name": "x", "env": { "bad": 42 } }`);
    expect(config.envs.map((env) => env.name)).toEqual(["local"]);
    expect(config.warnings.some((warning) => warning.includes("bad"))).toBe(true);
  });

  it("ne plante pas sur une config vide", () => {
    const config = buildWorkerConfig(jsonRef, "{}");
    expect(config.envs).toHaveLength(1);
    expect(config.envs[0]!.bindings.d1).toEqual([]);
  });

  it("respecte migrations_dir quand il est déclaré", () => {
    const text = `
[[d1_databases]]
binding = "DB"
database_name = "db"
database_id = "11111111-2222-3333-4444-555555555555"
migrations_dir = "./db/migrations"
`;
    expect(buildWorkerConfig(ref, text).envs[0]!.bindings.d1[0]!.migrationsDir).toBe(
      "./db/migrations",
    );
  });
});

describe("isProdLikeName", () => {
  it("reconnaît production et prod, insensible à la casse", () => {
    expect(isProdLikeName("production")).toBe(true);
    expect(isProdLikeName("PROD")).toBe(true);
    expect(isProdLikeName("staging")).toBe(false);
    expect(isProdLikeName("preprod")).toBe(false);
  });
});
