#!/usr/bin/env tsx
/**
 * ENOUGH S3 TO PROVE OUR HALF OF THE CONTRACT. NOT ONE BYTE MORE.
 *
 * WHY IT EXISTS. On 2026-08-22 `organic` steps 7 and 8 — a saved link and a
 * saved image, both enriched — each failed after waiting ninety seconds.
 * Nothing was broken. There was no attachments bucket, so every upload was
 * refused before it began: no attachment row, no `enrich_attachment` job, and
 * a harness patiently waiting for a pipeline nobody had started. Two of the
 * product's capture kinds were proven by nothing, and could not be proven
 * without an AWS account.
 *
 * WHAT IT IS HONEST ABOUT. This proves **our** half of the contract: that the
 * API presigns a URL that can actually be written to, that the browser's PUT
 * lands, that `HEAD` confirms it, that the job enqueues, that enrichment can
 * read the object back and describe it. Every one of those is our code, and
 * every one of them is where this pipeline actually breaks.
 *
 * It proves nothing whatever about S3. Bucket policy, IAM, SigV4 correctness,
 * lifecycle rules, regional endpoints, multipart, eventual consistency — none
 * of that is exercised here and none of it should be claimed. **Signatures are
 * not verified**: the request only has to be well-formed enough to arrive.
 * That is a deliberate limit, not an oversight, and it is why the inventory in
 * `docs/goals/every-workflow-works.md` records B3 as proven *against a stub*
 * rather than proven outright. If a row in that table ever reads as more than
 * that, this comment is the thing it is contradicting.
 *
 * WHAT IT MAY NEVER BECOME. It must never be reachable from a deployed stage.
 * It is reached only through `ATTACHMENTS_ENDPOINT`, which is opt-in and which
 * nothing in `sst.config.ts` sets.
 *
 * ── TWO THINGS A BROWSER NEEDS THAT A HARNESS DID NOT ─────────────────────
 *
 * This file was written for `tools/e2e`, where the client is Node and the
 * objects only have to outlive one process. `scripts/dev-local.sh` now starts
 * it for the founder's own browser, and that client is stricter in two ways
 * that both ended in "photos do not work" rather than in an error anyone
 * could read:
 *
 *   1. **Preflight.** A cross-origin `PUT` carrying `Content-Type` is never a
 *      simple request, so the browser sends `OPTIONS` first and refuses to
 *      send the bytes unless that is answered. The stub used to reply
 *      `405 MethodNotAllowed`, so the upload died in the browser before one
 *      byte left it — no server log, nothing in the network tab but a CORS
 *      message. Real S3 needs the same thing, which is what the `cors` block
 *      on the `Attachments` bucket in `sst.config.ts` is for; answering it
 *      here is this stub matching the contract it stands in for, not a
 *      convenience.
 *
 *   2. **Surviving a restart.** In memory was right for a harness and wrong
 *      for a person: upload a photo, stop `dev:local`, come back tomorrow and
 *      the attachment row is still there pointing at an object that is gone —
 *      a broken image and "Could not open this attachment", which reads as the
 *      feature being broken rather than as the stub being empty. Given a
 *      directory (`--dir`, or `WAKA_S3_STUB_DIR`) objects are written through
 *      to disk and read back at startup. With no directory it is memory-only,
 *      exactly as before, which is what every harness in `tools/e2e` wants.
 *
 * ── RUNNING IT ────────────────────────────────────────────────────────────
 *
 *     pnpm e2e:s3-stub --port 8792            # terminal A
 *     ATTACHMENTS_BUCKET=waka-local \
 *     ATTACHMENTS_ENDPOINT=http://127.0.0.1:8792 \
 *       pnpm dev:local                        # terminal B
 *
 * `pnpm dev:local` does all of that for you now; the two terminals are for
 * pointing a stack at a stub you are watching the log of.
 *
 * Path-style addressing only — `/<bucket>/<key...>` — because
 * `bucket.127.0.0.1` does not resolve. `lib/s3-client.ts` sets
 * `forcePathStyle` whenever the endpoint override is present, so the two ends
 * agree by construction.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

interface StoredObject {
  body: Buffer;
  contentType: string;
  storedAt: number;
}

/** bucket -> key -> object. The only thing any request path reads. */
const store = new Map<string, Map<string, StoredObject>>();

function bucketFor(name: string): Map<string, StoredObject> {
  let bucket = store.get(name);
  if (!bucket) {
    bucket = new Map();
    store.set(name, bucket);
  }
  return bucket;
}

/* ── DISK, WHEN A DIRECTORY IS GIVEN ─────────────────────────────────────────
   The map above stays the source of truth for serving; disk is a write-through
   copy so that a `dev:local` restart does not turn yesterday's saved photo
   into a broken image. No directory (every `tools/e2e` harness) means no disk
   touched at all. */
let persistDir: string | null = null;

/** Bytes next to a sidecar, because content-type is not recoverable from an
    S3 key: the key is server-minted and its extension is advisory. */
const META_SUFFIX = ".s3meta.json";

/** A key is attacker-shaped input here even though ours are server-minted, and
    this stub writes to the developer's disk. Anything that resolves outside
    the directory is refused rather than clamped — a traversal is never a
    legitimate object name, so there is nothing to salvage. */
function objectPath(bucketName: string, key: string): string | null {
  if (!persistDir) return null;
  if (!bucketName || bucketName.includes("/") || bucketName.startsWith(".")) return null;
  if (key.endsWith(META_SUFFIX)) return null;
  const full = resolve(persistDir, bucketName, key);
  const inside = relative(persistDir, full);
  if (!inside || inside.startsWith("..") || inside.startsWith(sep)) return null;
  return full;
}

function persistPut(bucketName: string, key: string, object: StoredObject): void {
  const path = objectPath(bucketName, key);
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, object.body);
    writeFileSync(path + META_SUFFIX, JSON.stringify({ contentType: object.contentType, storedAt: object.storedAt }));
  } catch (err) {
    /* A dev object store that cannot write must say so and keep serving from
       memory: the upload the person just made still works in this session. */
    console.error(`[s3-stub] could not persist ${bucketName}/${key}:`, err);
  }
}

function persistDelete(bucketName: string, key: string): void {
  const path = objectPath(bucketName, key);
  if (!path) return;
  try {
    rmSync(path, { force: true });
    rmSync(path + META_SUFFIX, { force: true });
  } catch (err) {
    console.error(`[s3-stub] could not remove ${bucketName}/${key}:`, err);
  }
}

/** Read the directory back into the map at startup. Walked rather than
    indexed, because the layout IS the index — `<dir>/<bucket>/<key...>`, so a
    developer can see what the stub is holding with `ls`. */
function restoreFromDisk(dir: string): number {
  let restored = 0;
  const walk = (absolute: string, bucketName: string, keyPrefix: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = join(absolute, entry.name);
      if (entry.isDirectory()) {
        walk(child, bucketName || entry.name, bucketName ? `${keyPrefix}${entry.name}/` : "");
        continue;
      }
      if (!bucketName || entry.name.endsWith(META_SUFFIX)) continue;
      const key = `${keyPrefix}${entry.name}`;
      let contentType = "application/octet-stream";
      let storedAt = Date.now();
      try {
        const meta = JSON.parse(readFileSync(child + META_SUFFIX, "utf8")) as { contentType?: string; storedAt?: number };
        if (typeof meta.contentType === "string" && meta.contentType) contentType = meta.contentType;
        if (typeof meta.storedAt === "number") storedAt = meta.storedAt;
      } catch { /* a sidecar lost to an interrupted write costs the type, not the bytes */ }
      bucketFor(bucketName).set(key, { body: readFileSync(child), contentType, storedAt });
      restored += 1;
    }
  };
  try {
    mkdirSync(dir, { recursive: true });
    if (statSync(dir).isDirectory()) walk(dir, "", "");
  } catch (err) {
    console.error("[s3-stub] could not read the object directory:", err);
  }
  return restored;
}

/* ── CORS ────────────────────────────────────────────────────────────────────
   Mirrors the `cors` block on the `Attachments` bucket in `sst.config.ts`:
   any origin, any header, ETag exposed. Reflecting the request's own origin
   rather than printing `*` is deliberate — it is the one form that still works
   if a caller ever sends credentials, and it cannot be looser than `*`. */
function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = (req.headers.origin as string | undefined) ?? "*";
  const requested = (req.headers["access-control-request-headers"] as string | undefined) ?? "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, HEAD, PUT, POST, DELETE, OPTIONS",
    "access-control-allow-headers": requested,
    "access-control-expose-headers": "ETag",
    "access-control-max-age": "3600",
    vary: "origin",
  };
}

/** `/bucket/some/key.png` -> `{ bucket, key }`. */
function splitPath(pathname: string): { bucket: string; key: string } | null {
  const trimmed = decodeURIComponent(pathname).replace(/^\/+/, "");
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return null;
  return { bucket: trimmed.slice(0, slash), key: trimmed.slice(slash + 1) };
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** The one S3 error shape the SDK actually parses. */
function s3Error(res: ServerResponse, status: number, code: string, message: string, req?: IncomingMessage): void {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;
  res.writeHead(status, { "content-type": "application/xml", ...(req ? corsHeaders(req) : {}) });
  res.end(xml);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://stub.local");
  const method = (req.method ?? "GET").toUpperCase();
  const cors = corsHeaders(req);

  /* FIRST, because a preflight that falls through to the method switch is
     answered 405 and the browser then never sends the upload at all. */
  if (method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  /* `DeleteObjects` is a POST to the bucket with `?delete`. Answering it is
     what lets account erasure and capture deletion run here rather than being
     skipped, and those are the paths where "it silently did nothing" is worst. */
  if (method === "POST" && url.searchParams.has("delete")) {
    const name = decodeURIComponent(url.pathname).replace(/^\/+/, "").replace(/\/$/, "");
    const body = (await readBody(req)).toString("utf8");
    const keys = [...body.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1]!);
    const bucket = bucketFor(name);
    const deleted: string[] = [];
    for (const key of keys) {
      if (bucket.delete(key)) deleted.push(key);
      persistDelete(name, key);
    }
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?><DeleteResult>` +
      deleted.map((k) => `<Deleted><Key>${k}</Key></Deleted>`).join("") +
      `</DeleteResult>`;
    console.log(`[s3-stub] DELETE-OBJECTS ${name} (${deleted.length}/${keys.length})`);
    res.writeHead(200, { "content-type": "application/xml", ...cors });
    res.end(xml);
    return;
  }

  const parts = splitPath(url.pathname);
  if (!parts) return s3Error(res, 400, "InvalidRequest", "path-style addressing required", req);
  const { bucket: bucketName, key } = parts;
  const bucket = bucketFor(bucketName);

  if (method === "PUT") {
    const body = await readBody(req);
    const object: StoredObject = {
      body,
      contentType: (req.headers["content-type"] as string) || "application/octet-stream",
      storedAt: Date.now(),
    };
    bucket.set(key, object);
    persistPut(bucketName, key, object);
    console.log(`[s3-stub] PUT    ${bucketName}/${key} (${body.length} bytes)`);
    res.writeHead(200, { etag: `"${body.length.toString(16)}"`, ...cors });
    res.end();
    return;
  }

  const object = bucket.get(key);

  if (method === "HEAD") {
    if (!object) {
      console.log(`[s3-stub] HEAD   ${bucketName}/${key} -> 404`);
      res.writeHead(404, cors);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-length": String(object.body.length),
      "content-type": object.contentType,
      ...cors,
    });
    res.end();
    return;
  }

  if (method === "GET") {
    if (!object) {
      console.log(`[s3-stub] GET    ${bucketName}/${key} -> 404`);
      return s3Error(res, 404, "NoSuchKey", "The specified key does not exist.", req);
    }
    console.log(`[s3-stub] GET    ${bucketName}/${key} (${object.body.length} bytes)`);
    res.writeHead(200, {
      "content-length": String(object.body.length),
      "content-type": object.contentType,
      ...cors,
    });
    res.end(object.body);
    return;
  }

  if (method === "DELETE") {
    bucket.delete(key);
    persistDelete(bucketName, key);
    res.writeHead(204, cors);
    res.end();
    return;
  }

  return s3Error(res, 405, "MethodNotAllowed", `${method} is not stubbed`, req);
}

export interface StubHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
  /** For assertions: how many objects the stub is holding. */
  count: () => number;
}

export function startS3Stub(port = 0, dir?: string): Promise<StubHandle> {
  if (dir) {
    persistDir = resolve(dir);
    const restored = restoreFromDisk(persistDir);
    console.log(`[s3-stub] objects live in ${persistDir}${restored ? ` (${restored} restored)` : ""}`);
  }
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("[s3-stub] handler error", err);
      s3Error(res, 500, "InternalError", "stub failure", req);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        reject(new Error("could not determine the stub port"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
        count: () => [...store.values()].reduce((n, b) => n + b.size, 0),
      });
    });
  });
}

/* CLI: serve until killed. */
const invokedDirectly = process.argv[1]?.endsWith("s3-stub.ts") ?? false;
if (invokedDirectly) {
  const portFlag = process.argv.indexOf("--port");
  const port = portFlag >= 0 ? Number(process.argv[portFlag + 1]) : 8792;
  const dirFlag = process.argv.indexOf("--dir");
  const dir = dirFlag >= 0 ? process.argv[dirFlag + 1] : process.env.WAKA_S3_STUB_DIR;
  startS3Stub(port, dir).then((handle) => {
    console.log(`[s3-stub] listening on ${handle.url}`);
    console.log(
      `[s3-stub] signatures are NOT verified; objects live ${dir ? "on disk under the directory above" : "in memory only"}`,
    );
  });
}
