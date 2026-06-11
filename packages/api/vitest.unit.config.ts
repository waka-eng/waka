import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: [
      "src/lib/feedback-application.test.ts",
      "src/routes/action-recommendations.test.ts",
      "src/routes/feedback.test.ts",
      "src/vault/*.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.sst/**",
      "**/*.smoke.ts",
    ],
  },
});
