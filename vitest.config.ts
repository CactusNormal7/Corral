import { defineConfig } from "vitest/config";

// Seule la logique pure est testée : parsing de config, parsing des sorties wrangler,
// construction des commandes, registre, matrice, garde-fous. Rien qui lance Electron.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
