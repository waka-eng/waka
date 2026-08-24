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
 * WHAT IT MAY NEVER BECOME. It stores objects in memory, it forgets them when
 * it exits, and it must never be reachable from a deployed stage. It is
 * reached only through `ATTACHMENTS_ENDPOINT`, which is opt-in and which
 * nothing in `sst.config.ts` sets.
 *
 * ── RUNNING IT ────────────────────────────────────────────────────────────
 *
 *     pnpm e2e:s3-stub --port 8792            # terminal A
 *     ATTACHMENTS_BUCKET=waka-local \
 *     ATTACHMENTS_ENDPOINT=http://127.0.0.1:8792 \
 *       pnpm dev:local                        # terminal B
 *
 * Path-style addressing only — `/<bucket>/<key...>` — because
 * `bucket.127.0.0.1` does not resolve. `lib/s3-client.ts` sets
 * `forcePathStyle` whenever the endpoint override is present, so the two ends
 * agree by construction.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

interface StoredObject {
  body: Buffer;
  contentType: string;
  storedAt: number;
}

/** bucket -> key -> object. Memory only, on purpose. */
const store = new Map<string, Map<string, StoredObject>>();

function bucketFor(name: string): Map<string, StoredObject> {
  let bucket = store.get(name);
  if (!bucket) {
    bucket = new Map();
    store.set(name, bucket);
  }
  return bucket;
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
function s3Error(res: ServerResponse, status: number, code: string, message: string): void {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;
  res.writeHead(status, { "content-type": "application/xml" });
  res.end(xml);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://stub.local");
  const method = (req.method ?? "GET").toUpperCase();

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
    }
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?><DeleteResult>` +
      deleted.map((k) => `<Deleted><Key>${k}</Key></Deleted>`).join("") +
      `</DeleteResult>`;
    console.log(`[s3-stub] DELETE-OBJECTS ${name} (${deleted.length}/${keys.length})`);
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(xml);
    return;
  }

  const parts = splitPath(url.pathname);
  if (!parts) return s3Error(res, 400, "InvalidRequest", "path-style addressing required");
  const { bucket: bucketName, key } = parts;
  const bucket = bucketFor(bucketName);

  if (method === "PUT") {
    const body = await readBody(req);
    bucket.set(key, {
      body,
      contentType: (req.headers["content-type"] as string) || "application/octet-stream",
      storedAt: Date.now(),
    });
    console.log(`[s3-stub] PUT    ${bucketName}/${key} (${body.length} bytes)`);
    res.writeHead(200, { etag: `"${body.length.toString(16)}"` });
    res.end();
    return;
  }

  const object = bucket.get(key);

  if (method === "HEAD") {
    if (!object) {
      console.log(`[s3-stub] HEAD   ${bucketName}/${key} -> 404`);
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-length": String(object.body.length),
      "content-type": object.contentType,
    });
    res.end();
    return;
  }

  if (method === "GET") {
    if (!object) {
      console.log(`[s3-stub] GET    ${bucketName}/${key} -> 404`);
      return s3Error(res, 404, "NoSuchKey", "The specified key does not exist.");
    }
    console.log(`[s3-stub] GET    ${bucketName}/${key} (${object.body.length} bytes)`);
    res.writeHead(200, {
      "content-length": String(object.body.length),
      "content-type": object.contentType,
    });
    res.end(object.body);
    return;
  }

  if (method === "DELETE") {
    bucket.delete(key);
    res.writeHead(204);
    res.end();
    return;
  }

  return s3Error(res, 405, "MethodNotAllowed", `${method} is not stubbed`);
}

export interface StubHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
  /** For assertions: how many objects the stub is holding. */
  count: () => number;
}

export function startS3Stub(port = 0): Promise<StubHandle> {
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("[s3-stub] handler error", err);
      s3Error(res, 500, "InternalError", "stub failure");
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
  startS3Stub(port).then((handle) => {
    console.log(`[s3-stub] listening on ${handle.url}`);
    console.log("[s3-stub] signatures are NOT verified; objects live in memory only");
  });
}
