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
    /**
     * TWENTY SECONDS, MATCHING THE API's.
     *
     * The default is five, and these suites mount a real world with a real
     * frame loop under fake timers: `settle()` steps it eight times and each
     * step's wall-clock cost rises with how many files are running beside it.
     * So `home-navigation` passes alone and times out in a full parallel run
     * — a failure that says nothing about the code and everything about the
     * machine it ran on, which is the worst kind to chase.
     *
     * The API config has carried 20s for exactly this reason. A timeout is a
     * backstop against a hang, not a performance budget; an assertion is what
     * measures the code.
     */
    testTimeout: 20_000,
  },
});
