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
const mobile = process.env.WAKA_BUILD_TARGET === 'mobile';
const mobileValues = mobile ? Object.fromEntries([
  'VITE_BUILD_TARGET', 'VITE_API_URL', 'VITE_PUBLIC_WEB_URL',
  'VITE_APP_ENVIRONMENT', 'VITE_APP_ID', 'VITE_MOBILE_DIAGNOSTICS',
].map(key => [`import.meta.env.${key}`, JSON.stringify(process.env[key] ?? '')])) : {};

export default defineConfig({
  plugins: [react(), ...(mobile ? [{
    name: 'waka-mobile-fonts', enforce: 'pre' as const,
    transformIndexHtml(html: string) {
      return html.replace(/<link\b[^>]*href="https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)[^"]*"[^>]*>/gs, '')
        .replace('content="width=device-width,initial-scale=1"', 'content="width=device-width,initial-scale=1,viewport-fit=cover"');
    },
  }] : [])],
  ...(mobile ? { css: { postcss: { plugins: [{
    postcssPlugin: 'waka-mobile-font-family-names',
    Declaration(declaration: { prop: string; value: string }) {
      // @import expansion happens inside PostCSS, after ordinary Vite module
      // transforms. Rename families here, before CSS hashing, so existing
      // WAKA styles actually use their bundled variable font faces.
      if (declaration.prop === 'font-family') declaration.value = declaration.value.replace(/(['"])([^'"]+) Variable\1/g, '$1$2$1');
    },
  }] } } } : {}),
  // Mobile builds expose only the explicit public configuration passed by
  // their build script; workstation .env files must not enter an app binary.
  ...(mobile ? { envDir: false as const, envPrefix: [], define: mobileValues } : {}),
  server: {
    port: 5173,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true, secure: false },
    },
  },
});
