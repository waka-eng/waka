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
      "test/sst-config-env.test.ts",
      "src/lib/ambition-synthesis.test.ts",
      "src/lib/ambition-synthesis-gemini.test.ts",
      "src/lib/account-erasure.test.ts",
      "src/lib/auto-wow-generation.test.ts",
      "src/lib/feedback-application.test.ts",
      "src/lib/gemini-http.test.ts",
      "src/lib/guided-reflection-question.test.ts",
      "src/lib/model-provider.test.ts",
      "src/lib/inspiration-embeddings.test.ts",
      "src/lib/signal-packets.test.ts",
      "src/lib/meaning-graph-keywords.test.ts",
      "src/lib/signal-enrichment.test.ts",
      "src/lib/salience.test.ts",
      "src/lib/combination-reading.test.ts",
      "src/lib/reading-divergence.test.ts",
      "src/lib/reading-divergence-gemini.test.ts",
      "src/lib/trigger-selection.test.ts",
      "src/lib/room-timeline.test.ts",
      "src/lib/signal-readings.test.ts",
      "src/lib/top-of-mind-notes.test.ts",
      "src/lib/top-of-mind-value.test.ts",
      "src/lib/top-of-mind-refresh.test.ts",
      "src/lib/wow-candidates.test.ts",
      "src/lib/group-combination.test.ts",
      "src/lib/group-note-lifecycle.test.ts",
      "src/lib/group-reading-refresh.test.ts",
      "src/lib/wow-judge.test.ts",
      "src/lib/wow-judge-model.test.ts",
      "src/lib/admin-auth.test.ts",
      "src/routes/admin-meaning-graph.test.ts",
      "src/routes/auth-cli.test.ts",
      "src/routes/auth-google.test.ts",
      "src/routes/auth-profile.test.ts",
      "src/routes/feedback.test.ts",
      "src/routes/groups.test.ts",
      "src/routes/health.test.ts",
      "src/routes/inspirations-readings.test.ts",
      "src/routes/public-profiles.test.ts",
      "src/routes/top-of-mind.test.ts",
      "src/routes/wow-moments.test.ts",
      "src/queue/classifier.test.ts",
      "src/vault/*.test.ts",
      "src/scoring/activation.test.ts",
      "src/scoring/stability.test.ts",
      "src/lib/node-dynamics.test.ts",
      "src/scoring/board-selection.test.ts",
      "src/scoring/algorithm-integrity.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.sst/**",
      "**/*.smoke.ts",
    ],
  },
});
