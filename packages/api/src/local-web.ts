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

  /**
   * THE DOCUMENT IS NEVER CACHED; THE ASSETS ALWAYS ARE.
   *
   * This pairing is not an optimisation — getting it wrong breaks the app
   * permanently after any rebuild, and it did.
   *
   * `index.html` is the only file that NAMES the hashed chunks. Served with
   * no cache headers it is cached heuristically, so after a rebuild the
   * browser holds a document pointing at `Chat-LiEXv0ZN.js` while the disk
   * holds `Chat-<something else>.js`. The chunk 404s, the surface boundary
   * catches it and offers a reload — and the reload serves the SAME cached
   * document, which asks for the same dead chunk. The one screen whose job
   * is to recover could not, and the copy was telling the truth about the
   * cause ("sometimes a version that changed while you were here") while the
   * button could do nothing about it.
   *
   * So the document is `no-store`: it is a manifest, it is tiny, and a stale
   * one is unrecoverable. The hashed assets are `immutable` for a year,
   * which is safe precisely BECAUSE the name changes whenever the bytes do —
   * the same property that makes a stale document fatal makes a cached asset
   * free.
   */
  app.use("*", async (c, next) => {
    await next();
    if (c.res.status !== 200) return;
    if (c.req.path.startsWith("/assets/")) {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
      return;
    }
    /* BY CONTENT TYPE, NOT BY ROUTE. `/` is served by the static handler
       straight from index.html, never reaching the SPA fallback below — so a
       rule written against the fallback's path would have missed the one
       document people actually open. What must not be cached is HTML,
       wherever it came from. */
    if (c.res.headers.get("content-type")?.includes("text/html")) {
      c.header("Cache-Control", "no-store");
    }
  });

  app.use("*", serveStatic({ root: staticRoot }));

  app.get("*", async (c) => {
    return c.html(await readFile(indexFile, "utf8"));
  });

  console.log(`[api] serving web dist from ${distDir}`);
  return app;
}
