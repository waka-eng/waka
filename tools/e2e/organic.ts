#!/usr/bin/env tsx
/**
 * The organic e2e harness — a library first, a gate second.
 *
 * Why this exists
 * ---------------
 * Unit tests prove each piece behaves when handed the arguments the test
 * chose. They cannot prove that a person signing up, capturing, searching, and
 * saving a link gets their memory back, because every seam between those steps
 * — the session cookie, the queue, the drain, S3, the model — is mocked away.
 * This drives the real stack over HTTP the way a client does, and every later
 * phase's gate is written by importing the helpers below rather than by
 * re-deriving how to talk to the API.
 *
 * Library
 * -------
 *   const session = await signUp({ baseUrl });
 *   const capture1 = await capture(session, { text: "…" });
 *   const found = await listInspirations(session, { q: "…" });
 *   const attachment = await attachLink(session, { inspirationId, url });
 *   await waitFor(async () => …, { timeoutMs: 90_000, label: "enrichment" });
 *
 * Every helper throws `ApiError` on a non-2xx, carrying the method, path,
 * status, and a redacted body — a gate is only as useful as the sentence it
 * prints when it fails.
 *
 * CLI (the Phase 3 gate)
 * ----------------------
 *   pnpm e2e:organic                       # against http://localhost:3010
 *   pnpm e2e:organic --base-url <url>      # against a deployed stage
 *   pnpm e2e:organic --keep-data           # leave the created accounts behind
 *
 * Eight numbered steps, each printing PASS or FAIL, non-zero exit if any
 * failed. Steps 7 and 8 need the background worker draining — see the README.
 *
 * Nothing here prints a password, a token, or a connection string. Bodies
 * quoted in errors go through `redact` first: an e2e failure is pasted into
 * issues and chat logs, and a live credential must not travel with it.
 */

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  FIXTURE_ARTICLE_BOILERPLATE_MARKER,
  FIXTURE_ARTICLE_MARKER,
  FIXTURE_IMAGE_MARKER,
  startFixtureServer,
  type FixtureServer,
} from "./fixture-server.js";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export const DEFAULT_BASE_URL = "http://localhost:3010";

export interface Session {
  baseUrl: string;
  /** Bearer credential. Never printed. */
  token: string;
  email: string;
  accountId: string;
  profileId: string;
  profileType: "human" | "agent";
}

export interface AccountIdentity {
  account: { id: string; email: string; onboardingCompletedAt: string | null };
  profile: { id: string; accountId: string; type: "human" | "agent"; name: string };
}

export interface HealthResponse {
  ok: boolean;
  service?: string;
  capabilities?: string[];
}

export type InspirationKind = "note" | "link" | "image" | "mixed";
export type InspirationSource = "app" | "agent";

export interface AttachmentEnrichment {
  status: "pending" | "ready" | "failed" | "unavailable" | null;
  kind: "page_body" | "image_description" | null;
  text: string | null;
  errorReason: string | null;
  updatedAt: string | null;
}

export interface Attachment {
  id: string;
  inspirationId: string;
  type: "link" | "image" | "file";
  url: string;
  name: string | null;
  contentType: string | null;
  size: number | null;
  createdAt: string;
  enrichment: AttachmentEnrichment;
}

export interface Reflection {
  id: string;
  inspirationId: string;
  question: string;
  answer: string | null;
  skipped: boolean;
  createdAt: string;
}

export interface Inspiration {
  id: string;
  profileId: string;
  text: string;
  kind: InspirationKind | null;
  source: InspirationSource;
  createdAt: string;
  updatedAt: string;
  attachments: Attachment[];
  reflections: Reflection[];
}

export interface InspirationSummary {
  id: string;
  textPreview: string;
  kind: InspirationKind | null;
  source: InspirationSource;
  createdAt: string;
  updatedAt: string;
  attachmentSummary: Array<{ id: string; type: string; label: string }>;
  reflectionCount: number;
}

export interface InspirationPage {
  inspirations: InspirationSummary[];
  nextCursor?: string;
}

export interface Signal {
  id: string;
  statement: string;
  status: string;
  confidence: number | null;
  evidenceCount?: number;
  [key: string]: unknown;
}

export interface TopOfMind {
  id: string;
  version: number;
  entries: Array<{ id: string; type: string; body: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Errors and redaction
// ---------------------------------------------------------------------------

/**
 * Anything shaped like a credential, replaced before it can be printed.
 *
 * A signup response carries a live 30-day session token; an error body from a
 * misconfigured stack can quote the request it rejected. Both end up in a
 * transcript the moment a gate fails, so redaction happens at the boundary
 * rather than at each call site that might remember to do it.
 */
export function redact(value: string): string {
  return value
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-token]")
    .replace(/("(?:token|password|passwordHash|secret)"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"')
    .replace(/\b(postgres(?:ql)?:\/\/)[^\s"']+/gi, "$1[redacted]")
    .replace(/([?&](?:X-Amz-Signature|X-Amz-Credential|Signature)=)[^&\s"']+/gi, "$1[redacted]");
}

export class ApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly body: string;

  constructor(input: { method: string; path: string; status: number; body: string }) {
    const body = redact(input.body).slice(0, 600);
    super(`${input.method} ${input.path} → ${input.status}${body ? `: ${body}` : ""}`);
    this.name = "ApiError";
    this.status = input.status;
    this.method = input.method;
    this.path = input.path;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

interface RequestOptions {
  method?: string;
  path: string;
  baseUrl: string;
  token?: string;
  body?: unknown;
  /** Statuses to return instead of throwing — for negative assertions. */
  expect?: number[];
  timeoutMs?: number;
}

interface RawResponse {
  status: number;
  text: string;
}

async function rawRequest(options: RequestOptions): Promise<RawResponse> {
  const method = options.method ?? "GET";
  const url = `${options.baseUrl.replace(/\/$/, "")}${options.path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);

  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        // Bearer rather than a cookie jar: one header, no shared mutable
        // state between the accounts a test drives at the same time.
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    return { status: response.status, text: await response.text() };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${method} ${options.path} could not reach ${options.baseUrl} — ${redact(reason)}. Is the stack running?`,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(options: RequestOptions): Promise<T> {
  const { status, text } = await rawRequest(options);
  const accepted = options.expect ?? [];
  const ok = (status >= 200 && status < 300) || accepted.includes(status);
  if (!ok) {
    throw new ApiError({
      method: options.method ?? "GET",
      path: options.path,
      status,
      body: text,
    });
  }
  if (text.length === 0) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError({
      method: options.method ?? "GET",
      path: options.path,
      status,
      body: `response was not JSON: ${text.slice(0, 200)}`,
    });
  }
}

/** The status of a request whose failure is the point. */
export async function statusOf(options: RequestOptions): Promise<number> {
  const { status } = await rawRequest(options);
  return status;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : "";
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function health(baseUrl = DEFAULT_BASE_URL): Promise<HealthResponse> {
  return request<HealthResponse>({ baseUrl, path: "/api/health" });
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface SignUpOptions {
  baseUrl?: string;
  email?: string;
  password?: string;
  name?: string;
}

/**
 * A fresh account, its human profile, and a session bound to that profile.
 *
 * The generated address uses `.test`, which is reserved by RFC 2606 and
 * therefore cannot belong to anyone: a harness that occasionally sends mail to
 * a stranger would be a bug with a victim.
 */
export function generateTestEmail(): string {
  return `waka-e2e-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}@example.test`;
}

function generatePassword(): string {
  return `e2e-${randomUUID()}`;
}

export async function signUp(options: SignUpOptions = {}): Promise<Session> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const email = options.email ?? generateTestEmail();
  const password = options.password ?? generatePassword();

  const body = await request<{
    account: AccountIdentity["account"];
    profile: AccountIdentity["profile"];
    token: string;
  }>({
    method: "POST",
    baseUrl,
    path: "/api/auth/signup",
    body: { email, password, name: options.name ?? "E2E Organic" },
  });

  return {
    baseUrl,
    token: body.token,
    email,
    accountId: body.account.id,
    profileId: body.profile.id,
    profileType: body.profile.type,
  };
}

export async function login(input: {
  baseUrl?: string;
  email: string;
  password: string;
}): Promise<Session> {
  const baseUrl = input.baseUrl ?? DEFAULT_BASE_URL;
  const body = await request<{
    account: AccountIdentity["account"];
    profile: AccountIdentity["profile"];
    token: string;
  }>({
    method: "POST",
    baseUrl,
    path: "/api/auth/login",
    body: { email: input.email, password: input.password },
  });

  return {
    baseUrl,
    token: body.token,
    email: body.account.email,
    accountId: body.account.id,
    profileId: body.profile.id,
    profileType: body.profile.type,
  };
}

export async function me(session: Session): Promise<AccountIdentity> {
  return request<AccountIdentity>({
    baseUrl: session.baseUrl,
    path: "/api/auth/me",
    token: session.token,
  });
}

/** Erase the account and everything under it. The confirmation is the API's. */
export async function deleteAccount(session: Session): Promise<void> {
  await request<{ ok: boolean }>({
    method: "DELETE",
    baseUrl: session.baseUrl,
    path: "/api/auth/me",
    token: session.token,
    body: { confirmation: "DELETE" },
  });
}

// ---------------------------------------------------------------------------
// Layer 1 — inspirations
// ---------------------------------------------------------------------------

export interface CaptureInput {
  text: string;
  kind?: InspirationKind;
  source?: InspirationSource;
  reflections?: Array<{ question: string; answer?: string; skipped?: boolean }>;
  /** Capture into another profile of the same account, per the matrix. */
  profile?: string;
  /**
   * Public is what puts a memory on the ground of every room its keeper is
   * in — since 2026-08-24 there is no other way a statement reaches a room,
   * so a harness that wants a room to have anything to say must say this.
   */
  visibility?: "private" | "public";
}

export async function capture(session: Session, input: CaptureInput): Promise<Inspiration> {
  const { profile, ...body } = input;
  const response = await request<{ inspiration: Inspiration }>({
    method: "POST",
    baseUrl: session.baseUrl,
    path: `/api/inspirations${query({ profile })}`,
    token: session.token,
    body,
  });
  return response.inspiration;
}

export interface ListInspirationsQuery {
  q?: string;
  limit?: number;
  cursor?: string;
  profile?: string;
}

export async function listInspirations(
  session: Session,
  params: ListInspirationsQuery = {},
): Promise<InspirationPage> {
  return request<InspirationPage>({
    baseUrl: session.baseUrl,
    path: `/api/inspirations${query({ ...params })}`,
    token: session.token,
  });
}

export async function getInspiration(
  session: Session,
  id: string,
  params: { profile?: string } = {},
): Promise<Inspiration> {
  const response = await request<{ inspiration: Inspiration }>({
    baseUrl: session.baseUrl,
    path: `/api/inspirations/${id}${query(params)}`,
    token: session.token,
  });
  return response.inspiration;
}

export async function updateInspiration(
  session: Session,
  id: string,
  patch: { text?: string; kind?: InspirationKind | null },
  params: { profile?: string } = {},
): Promise<Inspiration> {
  const response = await request<{ inspiration: Inspiration }>({
    method: "PATCH",
    baseUrl: session.baseUrl,
    path: `/api/inspirations/${id}${query(params)}`,
    token: session.token,
    body: patch,
  });
  return response.inspiration;
}

export async function deleteInspiration(
  session: Session,
  id: string,
  params: { profile?: string } = {},
): Promise<void> {
  await request<{ id: string }>({
    method: "DELETE",
    baseUrl: session.baseUrl,
    path: `/api/inspirations/${id}${query(params)}`,
    token: session.token,
  });
}

/** The status a read of someone else's capture answers with. */
export async function statusOfInspirationRead(
  session: Session,
  id: string,
): Promise<number> {
  return statusOf({
    baseUrl: session.baseUrl,
    path: `/api/inspirations/${id}`,
    token: session.token,
  });
}

// ---------------------------------------------------------------------------
// Layers 2 and 3
// ---------------------------------------------------------------------------

export async function listSignals(
  session: Session,
  params: { status?: string; limit?: number; profile?: string } = {},
): Promise<Signal[]> {
  const response = await request<{ signals: Signal[] }>({
    baseUrl: session.baseUrl,
    path: `/api/signals${query({ ...params })}`,
    token: session.token,
  });
  return response.signals;
}

/** Null when nothing has been synthesized yet — a different state from empty. */
export async function getTopOfMind(
  session: Session,
  params: { profile?: string; includeDismissed?: boolean } = {},
): Promise<TopOfMind | null> {
  const response = await request<{ topOfMind: TopOfMind | null }>({
    baseUrl: session.baseUrl,
    path: `/api/top-of-mind${query({
      profile: params.profile,
      includeDismissed: params.includeDismissed ? "true" : undefined,
    })}`,
    token: session.token,
  });
  return response.topOfMind;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export async function attachLink(
  session: Session,
  input: { inspirationId: string; url: string; name?: string },
): Promise<Attachment> {
  const response = await request<{ attachment: Attachment }>({
    method: "POST",
    baseUrl: session.baseUrl,
    path: "/api/attachments",
    token: session.token,
    body: {
      type: "link",
      inspirationId: input.inspirationId,
      url: input.url,
      ...(input.name ? { name: input.name } : {}),
    },
  });
  return response.attachment;
}

/**
 * The full upload path an image really takes: presign, PUT the bytes straight
 * to S3, then finalize the row against the key.
 *
 * Shortcutting any of it would test a path no client uses — and the finalize
 * endpoint HEADs the object, so a row cannot be conjured without bytes behind
 * it anyway. A stack with no bucket configured fails at the presign step with
 * that said plainly, rather than at some confusing point downstream.
 */
/**
 * MINT AN AGENT-BOUND CREDENTIAL, the way `waka-mcp` does.
 *
 * The loopback login end to end: open the consent page, submit its form as the
 * signed-in human, follow the redirect for the one-time code, exchange it. What
 * comes back is a token bound to ONE profile, and the last check here is that
 * the profile it is bound to is the profile that was asked for — a consent
 * screen that quietly bound a credential to the wrong profile would hand an
 * agent somebody else's memory, and every response would still look correct.
 *
 * IT LIVES HERE RATHER THAN IN ONE SUITE. It was written inside `groups.ts`
 * and a second suite needed it the moment there was a second question about
 * what an agent may do. This file is where the e2e family keeps the things
 * more than one of them speaks — and a rule with two copies is two places for
 * it to drift, silently, in a direction nobody re-reads.
 */
export async function mintAgentToken(browser: Session, profileId: string): Promise<string> {
  const callback = "http://127.0.0.1:65535/callback";
  const state = "e2e-state";

  const page = await fetch(
    `${browser.baseUrl}/api/auth/cli/start?callback=${encodeURIComponent(callback)}` +
      `&state=${state}&profile=${profileId}&device=e2e`,
    { headers: { Authorization: `Bearer ${browser.token}` } },
  );
  if (!page.ok) throw new Error(`cli/start → ${page.status}`);
  const html = await page.text();

  const field = (name: string): string => {
    const match = html.match(new RegExp(`name="${name}" value="([^"]*)"`));
    if (!match) throw new Error(`consent form is missing ${name}`);
    return match[1]!.replace(/&amp;/g, "&").replace(/&#39;/g, "'");
  };

  const form = new URLSearchParams({
    callback: field("callback"),
    state: field("state"),
    device: field("device"),
    consent: field("consent"),
    requestedProfileId: field("requestedProfileId"),
    profileId,
  });

  const consented = await fetch(`${browser.baseUrl}/api/auth/cli/consent`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${browser.token}`,
    },
    body: form.toString(),
  });
  if (consented.status !== 302) throw new Error(`cli/consent → ${consented.status}`);

  const code = new URL(consented.headers.get("location")!).searchParams.get("code");
  if (!code) throw new Error("consent redirect carried no code");

  const exchanged = await fetch(`${browser.baseUrl}/api/auth/cli/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!exchanged.ok) throw new Error(`cli/exchange → ${exchanged.status}`);
  const { token } = (await exchanged.json()) as { token: string };
  const who = await fetch(`${browser.baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json() as Promise<{ profile: { id: string; type: string } }>);
  if (who.profile.id !== profileId) {
    throw new Error(
      `consent bound the credential to ${who.profile.type} ${who.profile.id}, not the requested ${profileId}`,
    );
  }
  return token;
}


/**
 * Record an image that already lives at a URL, the way a pasted image arrives.
 *
 * Distinct from {@link attachImage}, which uploads bytes: this path needs no
 * object store, so the enrichment steps can run against a plain local stack.
 * Both end in the same place — an image attachment whose bytes enrichment
 * reads before describing them.
 */
export async function attachImageByUrl(
  session: Session,
  input: {
    inspirationId: string;
    url: string;
    contentType?: string;
    name?: string;
  },
): Promise<Attachment> {
  const response = await request<{ attachment: Attachment }>({
    method: "POST",
    baseUrl: session.baseUrl,
    path: "/api/attachments",
    token: session.token,
    body: {
      type: "image",
      inspirationId: input.inspirationId,
      url: input.url,
      ...(input.contentType ? { contentType: input.contentType } : {}),
      ...(input.name ? { name: input.name } : {}),
    },
  });
  return response.attachment;
}

export async function attachImage(
  session: Session,
  input: {
    inspirationId: string;
    bytes: Uint8Array;
    filename: string;
    contentType?: string;
    name?: string;
  },
): Promise<Attachment> {
  const contentType = input.contentType ?? "image/png";
  const size = input.bytes.byteLength;

  const presigned = await request<{
    uploadUrl: string;
    key: string;
    headers: Record<string, string>;
  }>({
    method: "POST",
    baseUrl: session.baseUrl,
    path: "/api/attachments/presign",
    token: session.token,
    body: { filename: input.filename, contentType, size },
  }).catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 500) {
      throw new Error(
        `${err.message} — the stack under test has no attachments bucket configured ` +
          "(ATTACHMENTS_BUCKET / SST_RESOURCE_Attachments), so image capture cannot run here.",
      );
    }
    throw err;
  });

  // Content-Length is computed by the runtime from the body; sending it by
  // hand is rejected as a forbidden header. Every other signed header is
  // forwarded verbatim, since S3 validates the signature against them.
  const uploadHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(presigned.headers ?? {})) {
    if (key.toLowerCase() === "content-length") continue;
    uploadHeaders[key] = value;
  }

  // Copied into a view over a plain ArrayBuffer: a Uint8Array that may sit on
  // shared memory is not a request body fetch will take.
  const uploadBody = new Uint8Array(size);
  uploadBody.set(input.bytes);

  const upload = await fetch(presigned.uploadUrl, {
    method: "PUT",
    headers: { "content-type": contentType, ...uploadHeaders },
    body: uploadBody,
  });
  if (!upload.ok) {
    const detail = redact((await upload.text().catch(() => "")).slice(0, 400));
    throw new Error(`PUT to the presigned upload URL failed → ${upload.status}: ${detail}`);
  }

  const response = await request<{ attachment: Attachment }>({
    method: "POST",
    baseUrl: session.baseUrl,
    path: "/api/attachments",
    token: session.token,
    body: {
      type: "image",
      inspirationId: input.inspirationId,
      key: presigned.key,
      contentType,
      size,
      ...(input.name ? { name: input.name } : {}),
    },
  });
  return response.attachment;
}

/** One attachment, re-read from its inspiration — enrichment lands out of band. */
export async function getAttachment(
  session: Session,
  input: { inspirationId: string; attachmentId: string },
): Promise<Attachment | null> {
  const inspiration = await getInspiration(session, input.inspirationId);
  return inspiration.attachments.find((row) => row.id === input.attachmentId) ?? null;
}

// ---------------------------------------------------------------------------
// Waiting
// ---------------------------------------------------------------------------

export interface WaitContext {
  /** Record what was seen this round, so a timeout can say what it kept seeing. */
  note(message: string): void;
  attempt: number;
}

export interface WaitForOptions {
  timeoutMs: number;
  /** Named in the timeout message. Write it as "the thing being waited for". */
  label: string;
  intervalMs?: number;
}

/**
 * Poll until the predicate returns something truthy, or give up loudly.
 *
 * The timeout message carries the label, the elapsed budget, the number of
 * attempts, and whatever the last round noted — because the only thing worse
 * than a flaky gate is a flaky gate that says "timed out" and nothing else.
 */
export async function waitFor<T>(
  predicate: (ctx: WaitContext) => Promise<T | null | undefined | false>,
  options: WaitForOptions,
): Promise<T> {
  const intervalMs = options.intervalMs ?? 1_000;
  const deadline = Date.now() + options.timeoutMs;
  let attempt = 0;
  let lastNote: string | null = null;
  let lastError: string | null = null;

  for (;;) {
    attempt += 1;
    const ctx: WaitContext = {
      attempt,
      note: (message) => {
        lastNote = message;
      },
    };

    try {
      const result = await predicate(ctx);
      if (result) return result;
      lastError = null;
    } catch (err) {
      // A transient 5xx while a stack is still warming is ordinary; it only
      // matters if it is still happening when the budget runs out.
      lastError = redact(err instanceof Error ? err.message : String(err));
    }

    if (Date.now() >= deadline) {
      const detail = [
        lastNote ? `last seen: ${lastNote}` : null,
        lastError ? `last error: ${lastError}` : null,
      ]
        .filter(Boolean)
        .join("; ");
      throw new Error(
        `Timed out after ${options.timeoutMs}ms (${attempt} attempts) waiting for ${options.label}` +
          (detail ? ` — ${detail}` : ""),
      );
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Wait for an attachment's enrichment to settle, then hand back the row.
 *
 * `failed` is not terminal — the queue retries it with backoff — so this keeps
 * waiting through it and reports it as the last thing seen if the budget runs
 * out. `unavailable` is a settled verdict and stops the wait immediately, since
 * polling a decided answer only delays the failure.
 */
export async function waitForEnrichment(
  session: Session,
  input: { inspirationId: string; attachmentId: string; timeoutMs?: number; label?: string },
): Promise<Attachment> {
  return waitFor<Attachment>(
    async (ctx) => {
      const attachment = await getAttachment(session, input);
      if (!attachment) {
        ctx.note("attachment is gone from its inspiration");
        return null;
      }
      const { status, kind, errorReason } = attachment.enrichment;
      ctx.note(
        `status=${status ?? "null"} kind=${kind ?? "null"}${errorReason ? ` reason=${errorReason}` : ""}`,
      );
      if (status === "ready") return attachment;
      if (status === "unavailable") return attachment;
      return null;
    },
    {
      timeoutMs: input.timeoutMs ?? 90_000,
      label: input.label ?? `enrichment of attachment ${input.attachmentId}`,
      intervalMs: 1_500,
    },
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  baseUrl: string;
  keepData: boolean;
  fillerCount: number;
  enrichmentTimeoutMs: number;
  fixturePort: number;
  fixtureUrl?: string;
}

const USAGE = [
  "Usage: pnpm e2e:organic [flags]",
  "",
  "Drives the Phase 3 gate against a running stack: signup, capture, search",
  "past the newest 200, edit, delete, tenant isolation, link enrichment,",
  "image enrichment. Prints PASS/FAIL per step; exits non-zero if any failed.",
  "",
  "Flags:",
  `  --base-url <url>            Stack under test (default ${DEFAULT_BASE_URL})`,
  "  --keep-data                 Do not erase the accounts this run creates",
  "  --filler <n>                Filler captures for the search step (default 205)",
  "  --enrichment-timeout-ms <n> Budget per enrichment wait (default 90000)",
  "  --fixture-port <n>          Port for the fixture server (default 0 = any free port)",
  "  --fixture-url <url>         Advertise this base URL to the API instead of the",
  "                              loopback one (a tunnel, or a name reachable from a",
  "                              container). The API refuses private addresses.",
  "  -h, --help                  Print this and exit",
  "",
  "Steps 7 and 8 need the background worker draining and, for step 8, a",
  "configured attachments bucket. See tools/e2e/README.md.",
].join("\n");

function parseArgs(argv: string[]): CliArgs | null {
  const args: CliArgs = {
    baseUrl: DEFAULT_BASE_URL,
    keepData: false,
    fillerCount: 205,
    enrichmentTimeoutMs: 90_000,
    fixturePort: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined) throw new Error(`${flag} requires a value`);
      i += 1;
      return next;
    };
    const numeric = (raw: string): number => {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${flag} expects a non-negative number, got ${raw}`);
      }
      return Math.trunc(parsed);
    };

    switch (flag) {
      case "-h":
      case "--help":
        return null;
      case "--base-url":
        args.baseUrl = value();
        break;
      case "--keep-data":
        args.keepData = true;
        break;
      case "--filler":
        args.fillerCount = numeric(value());
        break;
      case "--enrichment-timeout-ms":
        args.enrichmentTimeoutMs = numeric(value());
        break;
      case "--fixture-port":
        args.fixturePort = numeric(value());
        break;
      case "--fixture-url":
        args.fixtureUrl = value();
        break;
      default:
        throw new Error(`Unknown flag: ${flag}\n\n${USAGE}`);
    }
  }

  return args;
}

/**
 * THIS STACK CANNOT EXERCISE THE CLAIM — WHICH IS NOT THE PRODUCT FAILING.
 *
 * Founder, 2026-08-25: every workflow should reach its end "without breaking
 * in the middle". Auditing the eleven suites against that found the same shape
 * four times over: a step discovers, at run time, that the stack it is pointed
 * at cannot host the thing being claimed — no attachments bucket, a fixture on
 * loopback that the API's SSRF guard refuses by design — and reports FAIL. The
 * product is fine. The guard blocking loopback IS the product working.
 *
 * A red run whose red is environmental is worse than a missing gate, because a
 * genuine regression then arrives into a suite that is already red and nobody
 * looks twice. Every suite here already had a skip concept; none of them used
 * it for the conditions they can only discover while running.
 *
 * The rule for using this, and it is narrow: throw `NotExercised` ONLY when
 * the stack lacks a capability the claim needs. Never when the product
 * answered and answered wrongly — that is a failure and stays one.
 */
class NotExercised extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "NotExercised";
  }
}

interface StepResult {
  number: number;
  title: string;
  outcome: "pass" | "fail" | "skip";
  detail: string;
  ms: number;
}

/** Shared between steps: what earlier ones created, for later ones to use. */
interface RunState {
  args: CliArgs;
  fixtures: FixtureServer;
  sessions: Session[];
  primary?: Session;
  captured: Inspiration[];
}

interface Step {
  title: string;
  /** A failure here makes the rest meaningless, so the run stops. */
  critical?: boolean;
  run: (state: RunState) => Promise<string>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Fresh session for the run, remembered so cleanup can erase it. */
async function newAccount(state: RunState, name: string): Promise<Session> {
  const session = await signUp({ baseUrl: state.args.baseUrl, name });
  state.sessions.push(session);
  return session;
}

const STEPS: Step[] = [
  {
    title: "the stack answers as waka",
    critical: true,
    run: async (state) => {
      const body = await health(state.args.baseUrl);
      assert(body.ok === true, `health did not report ok: ${JSON.stringify(body)}`);
      assert(
        body.service === "waka",
        `health reported service ${JSON.stringify(body.service)}, expected "waka"`,
      );
      return `service=waka, ${body.capabilities?.length ?? 0} capabilities`;
    },
  },
  {
    title: "signup creates an account and its human profile",
    critical: true,
    run: async (state) => {
      const session = await newAccount(state, "E2E Organic");
      state.primary = session;

      const identity = await me(session);
      assert(identity.account?.id, "GET /api/auth/me returned no account");
      assert(identity.profile?.id, "GET /api/auth/me returned no profile");
      assert(
        identity.profile.type === "human",
        `session acts as a ${identity.profile.type} profile, expected human`,
      );
      assert(
        identity.account.id === session.accountId &&
          identity.profile.id === session.profileId,
        "identity from /me disagrees with the identity signup returned",
      );
      return "account + human profile, session bound to the profile";
    },
  },
  {
    title: "three captures land and come back from the archive",
    run: async (state) => {
      const session = state.primary!;
      const texts = [
        "Reading about estuary surveys and why the same bend of river repays returning to.",
        "A note on tools that stay useful precisely because they refuse to grow features.",
        "Watching how a small team decides what not to build, which is most of the decision.",
      ];

      for (const text of texts) {
        const inspiration = await capture(session, { text, kind: "note" });
        assert(inspiration.id, "capture returned no id");
        assert(inspiration.text === text, "capture stored different text than it was sent");
        state.captured.push(inspiration);
      }

      const page = await listInspirations(session, { limit: 50 });
      const ids = new Set(page.inspirations.map((row) => row.id));
      const missing = state.captured.filter((row) => !ids.has(row.id));
      assert(
        missing.length === 0,
        `${missing.length} of 3 captures are absent from GET /api/inspirations`,
      );
      return `3 captured, all 3 in the archive (${page.inspirations.length} rows read)`;
    },
  },
  {
    title: "search finds a capture buried past the newest 200",
    run: async (state) => {
      const session = state.primary!;
      const marker = `zqx${randomUUID().replace(/-/g, "").slice(0, 12)}`;

      const marked = await capture(session, {
        text: `A capture worth recalling later, tagged ${marker} so search has something exact to find.`,
        kind: "note",
      });

      // Sequential on purpose: the archive is ordered by capture time, and the
      // point of the step is that the marked row ends up genuinely below the
      // newest window rather than racing into it.
      for (let i = 0; i < state.args.fillerCount; i += 1) {
        await capture(session, {
          text: `Filler capture ${i + 1} of ${state.args.fillerCount}, written only to push the archive past one page.`,
          kind: "note",
        });
      }

      const newest = await listInspirations(session, { limit: 200 });
      assert(
        !newest.inspirations.some((row) => row.id === marked.id),
        `the marked capture is still inside the newest 200 — raise --filler above ${state.args.fillerCount}`,
      );

      const found = await listInspirations(session, { q: marker });
      const hit = found.inspirations.find((row) => row.id === marked.id);
      assert(
        hit,
        `search for the marker returned ${found.inspirations.length} rows, none of them the marked capture — ` +
          "recall is filtering a fetched window instead of querying the archive",
      );
      return `marked capture sits below ${state.args.fillerCount} newer rows and search still returns it`;
    },
  },
  {
    title: "an edit is readable back and a delete is gone",
    run: async (state) => {
      const session = state.primary!;
      const [target, doomed] = state.captured;
      assert(target && doomed, "step 3 did not leave two captures to work with");

      const edited = `${target.text} Edited during the organic run.`;
      await updateInspiration(session, target.id, { text: edited });
      const readBack = await getInspiration(session, target.id);
      assert(
        readBack.text === edited,
        "the edited text did not come back from GET /api/inspirations/:id",
      );

      await deleteInspiration(session, doomed.id);
      const status = await statusOfInspirationRead(session, doomed.id);
      assert(status === 404, `a deleted capture answered ${status}, expected 404`);

      state.captured = state.captured.filter((row) => row.id !== doomed.id);
      return "PATCH readable back, DELETE answers 404 afterwards";
    },
  },
  {
    title: "a second account can reach nothing of the first",
    run: async (state) => {
      const primary = state.primary!;
      const intruder = await newAccount(state, "E2E Neighbour");
      const target = state.captured[0];
      assert(target, "no surviving capture to attempt a cross-account read against");

      const status = await statusOfInspirationRead(intruder, target.id);
      assert(
        status === 404 || status === 403,
        `a foreign capture answered ${status} to another account, expected 404 or 403`,
      );

      const page = await listInspirations(intruder);
      assert(
        page.inspirations.length === 0,
        `the second account's archive holds ${page.inspirations.length} rows, expected none`,
      );
      return `cross-account read → ${status}, neighbour's archive empty`;
    },
  },
  {
    title: "a saved link is enriched from the page body",
    run: async (state) => {
      /* ITS OWN ACCOUNT, BECAUSE STEP 4 SPENDS THIS ONE'S BUDGET.
         `MODEL_BUDGET_JOBS_PER_ACCOUNT` is 60 per rolling hour
         (`lib/model-budget.ts`). Step 4 buries its marker under 205 filler
         captures, each of which enqueues a `derive_signals` job, so by the
         time these steps run the primary account has started exactly 60 and
         the queue has deferred its ENTIRE remaining backlog — including this
         enrichment job — to the next window boundary, an hour out.
         Measured 2026-08-22: with `--filler 205` these two steps failed after
         90s each; with `--filler 12` they passed in 1.5s each. Nothing about
         enrichment was ever broken. The harness was competing with itself,
         and the timeout could not say so.
         A fresh account carries a fresh budget and needs two jobs of it. */
      const session = await newAccount(state, "enrichment link");

      const inspiration = await capture(session, {
        text: "Saving this to read properly later.",
        kind: "link",
      });
      const attachment = await attachLink(session, {
        inspirationId: inspiration.id,
        url: state.fixtures.articleUrl,
      });

      const settled = await waitForEnrichment(session, {
        inspirationId: inspiration.id,
        attachmentId: attachment.id,
        timeoutMs: state.args.enrichmentTimeoutMs,
        label: `the fixture link's enrichment (${state.fixtures.articleUrl})`,
      });

      if (settled.enrichment.errorReason === "private_address") {
        throw new NotExercised(
          "the fixture is on loopback and the API's SSRF guard refuses private addresses — " +
            "by design, so this is the product working rather than failing. To exercise the " +
            "claim, pass --fixture-url pointing at an address that routes back to this machine, " +
            "or add a dev-only allowance in packages/api/src/lib/signal-enrichment.ts.",
        );
      }
      assert(
        settled.enrichment.status === "ready",
        `enrichment settled as ${settled.enrichment.status} (${settled.enrichment.errorReason ?? "no reason"}), expected ready`,
      );
      assert(
        settled.enrichment.kind === "page_body",
        `enrichment kind is ${settled.enrichment.kind}, expected page_body`,
      );
      const text = settled.enrichment.text ?? "";
      assert(
        text.includes(FIXTURE_ARTICLE_MARKER),
        "enrichment text does not contain the body-only marker — the page was summarized from its " +
          "title and meta tags rather than read",
      );
      assert(
        !text.includes(FIXTURE_ARTICLE_BOILERPLATE_MARKER),
        "enrichment text carries the fixture's aside/footer boilerplate — chrome was not stripped",
      );
      return `page_body enrichment, ${text.length} chars, body marker present and boilerplate absent`;
    },
  },
  {
    title: "a saved image is enriched from what it depicts",
    run: async (state) => {
      /* Its own account, for the reason spelled out on the link step above. */
      const session = await newAccount(state, "enrichment image");
      const inspiration = await capture(session, {
        text: "A screenshot I want findable by what it says.",
        kind: "image",
      });

      // Recording the fixture by URL rather than uploading it keeps this step
      // runnable against a stack with no object store. The enrichment path
      // under test is the same either way: read the bytes, then describe them.
      const attachment = await attachImageByUrl(session, {
        inspirationId: inspiration.id,
        url: state.fixtures.imageUrl,
        contentType: "image/png",
      });

      const settled = await waitForEnrichment(session, {
        inspirationId: inspiration.id,
        attachmentId: attachment.id,
        timeoutMs: state.args.enrichmentTimeoutMs,
        label: "the fixture image's enrichment",
      });

      /* THE SAME GUARD AS THE LINK STEP ABOVE. This one reached a plain
         `assert` instead and so reported the identical environmental cause as
         a product failure — the two steps share a cause and must share an
         answer. */
      if (settled.enrichment.errorReason === "private_address") {
        throw new NotExercised(
          "the fixture image is on loopback and the API's SSRF guard refuses private " +
            "addresses — by design. Pass --fixture-url pointing at an address that routes " +
            "back to this machine to exercise the claim.",
        );
      }
      assert(
        settled.enrichment.status === "ready",
        `enrichment settled as ${settled.enrichment.status} (${settled.enrichment.errorReason ?? "no reason"}), expected ready`,
      );
      assert(
        settled.enrichment.kind === "image_description",
        `enrichment kind is ${settled.enrichment.kind}, expected image_description`,
      );
      const text = settled.enrichment.text ?? "";
      assert(
        text.toLowerCase().includes(FIXTURE_IMAGE_MARKER.toLowerCase()),
        `the description does not transcribe ${JSON.stringify(FIXTURE_IMAGE_MARKER)} — ` +
          `it reads: ${JSON.stringify(text.slice(0, 200))}`,
      );
      return `image_description enrichment, ${text.length} chars, marker transcribed`;
    },
  },
];

/** The fixture's own bytes, read over HTTP so the served file is what is tested. */
async function fetchFixtureImage(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fixture image ${url} answered ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function formatResult(result: StepResult): string {
  const badge =
    result.outcome === "pass" ? "PASS" : result.outcome === "fail" ? "FAIL" : "SKIP";
  const seconds = (result.ms / 1000).toFixed(1);
  return `${badge} ${result.number}. ${result.title} (${seconds}s)\n     ${result.detail}`;
}

async function runScenario(args: CliArgs): Promise<number> {
  console.log(`[organic] base url: ${args.baseUrl}`);

  const fixtures = await startFixtureServer({
    port: args.fixturePort,
    ...(args.fixtureUrl ? { publicUrl: args.fixtureUrl } : {}),
  });
  console.log(`[organic] fixtures: ${fixtures.url} (listening on ${fixtures.listeningUrl})`);
  console.log("");

  const state: RunState = { args, fixtures, sessions: [], captured: [] };
  const results: StepResult[] = [];
  let aborted = false;

  try {
    for (const [index, step] of STEPS.entries()) {
      const number = index + 1;
      if (aborted) {
        results.push({
          number,
          title: step.title,
          outcome: "skip",
          detail: "skipped: an earlier step the run depends on failed",
          ms: 0,
        });
        console.log(formatResult(results[results.length - 1]!));
        continue;
      }

      const startedAt = Date.now();
      try {
        const detail = await step.run(state);
        results.push({
          number,
          title: step.title,
          outcome: "pass",
          detail,
          ms: Date.now() - startedAt,
        });
      } catch (err) {
        const message = redact(err instanceof Error ? err.message : String(err));
        /* A capability this stack has not got is a SKIP, not a FAIL, and it
           never aborts the run — see `NotExercised`. */
        const notExercised = err instanceof NotExercised;
        results.push({
          number,
          title: step.title,
          outcome: notExercised ? "skip" : "fail",
          detail: notExercised ? `NOT EXERCISED — ${message}` : message,
          ms: Date.now() - startedAt,
        });
        if (step.critical && !notExercised) aborted = true;
      }
      console.log(formatResult(results[results.length - 1]!));
    }
  } finally {
    await fixtures.close();

    if (args.keepData) {
      console.log(`\n[organic] --keep-data: ${state.sessions.length} account(s) left in place`);
    } else {
      for (const session of state.sessions) {
        try {
          await deleteAccount(session);
        } catch (err) {
          // Cleanup failing must not rewrite the verdict of the run: say so and
          // let the step results stand.
          console.warn(
            `[organic] could not erase a test account: ${redact(err instanceof Error ? err.message : String(err))}`,
          );
        }
      }
    }
  }

  const failed = results.filter((row) => row.outcome === "fail").length;
  const skipped = results.filter((row) => row.outcome === "skip").length;
  const passed = results.filter((row) => row.outcome === "pass").length;
  console.log(`\n[organic] ${passed} passed, ${failed} failed, ${skipped} skipped`);
  /* A SKIP NO LONGER MAKES THE RUN RED, and the distinction is the point. Two
     things wear the skip badge: a step this stack cannot host (`NotExercised`)
     and a step abandoned because an earlier one failed. The second only ever
     happens alongside a real failure, so `failed` is already non-zero and the
     run is red anyway; keeping `skipped` in this sum only had the effect of
     painting a healthy stack red for lacking an object store. */
  return failed > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  let args: CliArgs | null;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  if (!args) {
    console.log(USAGE);
    return;
  }

  process.exit(await runScenario(args));
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(`[organic] fatal: ${redact(error instanceof Error ? error.message : String(error))}`);
    process.exit(1);
  });
}
