import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { Hono, type Env } from "hono";

const API_ROUTE_PREFIX = "/api";

export function defaultWebDistDir(): string {
  return resolve(process.cwd(), "../../packages/web/dist");
}

export function isApiRoute(pathname: string): boolean {
  return pathname === API_ROUTE_PREFIX || pathname.startsWith(`${API_ROUTE_PREFIX}/`);
}

export function createLocalWebApp<E extends Env>(apiApp: Hono<E>, distDir: string): Hono<E> {
  const indexFile = join(distDir, "index.html");

  if (!existsSync(indexFile)) {
    console.warn(
      `[api] WAKA_SERVE_WEB_DIST is enabled, but ${indexFile} does not exist; serving API routes only.`,
    );
    return apiApp;
  }

  const app = new Hono<E>();
  const staticRoot = relative(process.cwd(), distDir) || ".";

  // `/api` routes are registered before static assets and the SPA fallback so their
  // auth/session behavior remains unchanged.
  app.route("/", apiApp);

  // If an `/api` URL did not match the registered API routes above, return
  // the normal API 404 instead of serving a static file or index.html.
  app.use("*", async (c, next) => {
    if (isApiRoute(c.req.path)) {
      return c.notFound();
    }

    await next();
  });

  app.use("*", serveStatic({ root: staticRoot }));

  app.get("*", async (c) => {
    return c.html(await readFile(indexFile, "utf8"));
  });

  console.log(`[api] serving web dist from ${distDir}`);
  return app;
}
