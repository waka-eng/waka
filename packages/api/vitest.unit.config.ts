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
      "src/lib/ambition-synthesis.test.ts",
      "src/lib/ambition-synthesis-gemini.test.ts",
      "src/lib/auto-wow-generation.test.ts",
      "src/lib/feedback-application.test.ts",
      "src/lib/guided-reflection-question.test.ts",
      "src/lib/model-provider.test.ts",
      "src/lib/inspiration-embeddings.test.ts",
      "src/lib/signal-packets.test.ts",
      "src/lib/top-of-mind-notes.test.ts",
      "src/lib/top-of-mind-value.test.ts",
      "src/lib/top-of-mind-refresh.test.ts",
      "src/lib/wow-candidates.test.ts",
      "src/lib/wow-judge.test.ts",
      "src/lib/wow-judge-model.test.ts",
      "src/lib/admin-auth.test.ts",
      "src/routes/admin-meaning-graph.test.ts",
      "src/routes/auth-google.test.ts",
      "src/routes/auth-profile.test.ts",
      "src/routes/feedback.test.ts",
      "src/routes/public-profiles.test.ts",
      "src/routes/top-of-mind.test.ts",
      "src/routes/wow-moments.test.ts",
      "src/vault/*.test.ts",
      "src/scoring/activation.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.sst/**",
      "**/*.smoke.ts",
    ],
  },
});
