import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/top-of-mind-persistence.integration.test.ts"],
    pool: "forks",
    maxWorkers: 1,
  },
});
