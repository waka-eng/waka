/**
 * Vite config for the WAKA web frontend.
 *
 * Two responsibilities worth calling out:
 *   1. `@vitejs/plugin-react` enables Fast Refresh + the automatic JSX
 *      runtime so we never have to import React in every component.
 *   2. The `/api` path is proxied to the local Hono Lambda during
 *      `pnpm dev` / `sst dev`. This lets the React app call same-origin
 *      URLs (e.g. `fetch("/api/auth/signup")`) without CORS.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In `sst dev` the Hono Function is exposed via a Function URL whose value
// is injected as VITE_API_URL by SST. Falling back to localhost keeps
// `pnpm --filter @waka/web dev` usable in isolation.
const API_TARGET = process.env.VITE_API_URL ?? "http://localhost:3010";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true, secure: false },
    },
  },
});
