import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // `.tsx` too. A test that renders JSX has to be written in one, and the
    // old pattern excluded such files SILENTLY — a test that never runs looks
    // exactly like a test that passes.
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["./test/setup-jsdom.ts"],
  },
});
