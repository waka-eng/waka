/**
 * Vite config for the separate WAKA admin frontend.
 *
 * The admin app intentionally runs on a different port from the user app and
 * talks to the existing API through a same-origin /api proxy so auth cookies are
 * sent with requests during local development.
 */

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_TARGET = process.env.VITE_API_URL ?? "http://localhost:3010";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true, secure: false },
    },
  },
  test: {
    environment: "jsdom",
  },
});
