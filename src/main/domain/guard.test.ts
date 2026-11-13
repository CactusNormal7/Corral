import { describe, expect, it } from "vitest";
import { GuardError, assertConfirmed, requirementFor } from "./guard.js";
import type { EnvConfig, EnvRef } from "../../shared/types.js";

function envConfig(name: string, isProdLike: boolean): EnvConfig {
  return {
    name,
    workerName: null,
    bindings: { d1: [], kv: [], r2: [], durableObjects: [], queues: [] },
    varNames: [],
    routes: [],
    crons: [],
    isRemote: name !== "local",
    isProdLike,
  };
}

const localRef: EnvRef = { name: "local", location: "local" };
const stagingRef: EnvRef = { name: "staging", location: "remote" };
const prodRef: EnvRef = { name: "production", location: "remote" };

describe("requirementFor", () => {
  it("n'exige rien en local", () => {
    const requirement = requirementFor(localRef, envConfig("local", false));
    expect(requirement.requiresConfirmation).toBe(false);
    expect(requirement.requiresTypedConfirmation).toBe(false);
  });

  it("exige une confirmation simple sur un env distant non prod", () => {
    const requirement = requirementFor(stagingRef, envConfig("staging", false));
    expect(requirement.requiresConfirmation).toBe(true);
    expect(requirement.requiresTypedConfirmation).toBe(false);
  });

  it("exige le nom retapé sur un env de type production", () => {
    const requirement = requirementFor(prodRef, envConfig("production", true));
    expect(requirement.requiresTypedConfirmation).toBe(true);
    expect(requirement.envLabel).toBe("production");
  });

  it("exige le nom retapé sur un env marqué prod par l'utilisateur", () => {
    const requirement = requirementFor(
      { name: "live", location: "remote" },
      envConfig("live", true),
    );
    expect(requirement.requiresTypedConfirmation).toBe(true);
  });

  it("reste prudent si la config de l'env est introuvable", () => {
    const requirement = requirementFor(stagingRef, null);
    expect(requirement.requiresConfirmation).toBe(true);
  });
});

describe("assertConfirmed", () => {
  it("laisse passer le local sans confirmation", () => {
    expect(() =>
      assertConfirmed(requirementFor(localRef, envConfig("local", false))),
    ).not.toThrow();
  });

  it("refuse une action distante sans confirmation", () => {
    expect(() => assertConfirmed(requirementFor(stagingRef, envConfig("staging", false)))).toThrow(
      GuardError,
    );
  });

  it("accepte une confirmation simple sur un env distant non prod", () => {
    expect(() =>
      assertConfirmed(requirementFor(stagingRef, envConfig("staging", false)), ""),
    ).not.toThrow();
  });

  it("refuse un nom mal retapé sur la prod", () => {
    const requirement = requirementFor(prodRef, envConfig("production", true));
    expect(() => assertConfirmed(requirement, "prod")).toThrow(GuardError);
    expect(() => assertConfirmed(requirement, "Production")).toThrow(GuardError);
    expect(() => assertConfirmed(requirement, " production ")).toThrow(GuardError);
  });

  it("accepte le nom exact sur la prod", () => {
    const requirement = requirementFor(prodRef, envConfig("production", true));
    expect(() => assertConfirmed(requirement, "production")).not.toThrow();
  });

  it("refuse une confirmation vide sur la prod", () => {
    const requirement = requirementFor(prodRef, envConfig("production", true));
    expect(() => assertConfirmed(requirement, "")).toThrow(GuardError);
    expect(() => assertConfirmed(requirement)).toThrow(GuardError);
  });
});
