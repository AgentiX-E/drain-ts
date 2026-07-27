import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/masker/index.ts", "src/persistence/index.ts", "src/core/index.ts", "src/persistence/PersistenceHandler.ts", "src/presets.ts"],
      thresholds: {
        statements: 91,
        branches: 84,
        functions: 94,
        lines: 92,
      },
      reporter: ["text", "json", "html"],
    },
  },
});
