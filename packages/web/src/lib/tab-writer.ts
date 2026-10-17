/**
 * WHO IS WRITING A DRAFT: THIS TAB, ACROSS RELOADS — AND WHO STILL IS.
 *
 * The chat composer and the share card both stamp each draft with a writer
 * id, and an edit to a draft some OTHER writer left is forked under a new key
 * rather than written over it — so two tabs never clobber each other's words.
 *
 * THE WRITER IS THE TAB. The id used to be minted per mount, so a reload made
 * the tab a stranger to its own draft: the next keystroke forked, the
 * original stayed on disk, and after the fork was sent the next reload
 * restored the original — words already sent, back in the box. The id lives
 * in `sessionStorage`, which is per tab and survives a reload, so a reload
 * keeps writing its own draft in place.
 *
 * AND A TAB SAYS IT IS STILL OPEN. Two facts `sessionStorage` cannot give:
 *
 *   - A DUPLICATED TAB copies `sessionStorage`, so it would start as the same
 *     writer as the tab it came from, and the two would collide on every
 *     keystroke. So each page load LEASES its writer id in `localStorage`
 *     under a per-load nonce and renews the lease on a heartbeat. A page that
 *     finds its stored id leased by another live page is a duplicate, and
 *     mints its own.
 *   - A DRAFT LEFT BY A CLOSED TAB is safe to clear once its words have been
 *     sent from a fork; one left by an OPEN tab is that tab's unsent words.
 *     `writerIsLive` answers which: a writer with a fresh lease is open.
 *
 * The lease is released on `pagehide`, so a reload's new page finds it free
 * and keeps the id. A page that dies without `pagehide` leaves a lease that
 * goes stale in `LEASE_MS`; until then its writer reads as live, which errs
 * toward keeping a draft rather than deleting one. Without storage at all
 * this falls back to a fresh id per call: the old per-mount behaviour.
 */
const WRITER_KEY = "waka:draftWriter";
const LEASE_PREFIX = "waka:draftWriterLease:";
/** How long a lease counts as live without a renewal. */
export const LEASE_MS = 20_000;
const HEARTBEAT_MS = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** This page load. A reload is a new page; a duplicated tab is a new page. */
const PAGE = crypto.randomUUID();
/* Every writer this page holds a lease on — one in a browser; more only
   when a test swaps `sessionStorage` under a running page. */
const leased = new Set<string>();
let heartbeat: ReturnType<typeof setInterval> | null = null;

interface Lease { page: string; at: number }

function readLease(writer: string): Lease | null {
  try {
    const raw = localStorage.getItem(LEASE_PREFIX + writer);
    const lease = raw ? (JSON.parse(raw) as Lease) : null;
    return lease && typeof lease.page === "string" && Number.isFinite(lease.at) ? lease : null;
  } catch {
    return null;
  }
}

const fresh = (lease: Lease | null): lease is Lease => lease !== null && Date.now() - lease.at < LEASE_MS;

function renew(): void {
  for (const writer of leased) {
    try { localStorage.setItem(LEASE_PREFIX + writer, JSON.stringify({ page: PAGE, at: Date.now() })); } catch { /* best effort */ }
  }
}

function release(): void {
  for (const writer of leased) {
    try { if (readLease(writer)?.page === PAGE) localStorage.removeItem(LEASE_PREFIX + writer); } catch { /* best effort */ }
  }
  leased.clear();
  if (heartbeat !== null) { clearInterval(heartbeat); heartbeat = null; }
}

let listening = false;
function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("pagehide", release);
  /* back from the back-forward cache: the same page, still this tab's writer */
  window.addEventListener("pageshow", (event) => { if (event.persisted) tabWriterId(); });
}

/**
 * The writer id `page` should use: the tab's own, unless another live page
 * already holds it, in which case a new one. Exported with `page` as a
 * parameter so a test can be two pages; the product calls `tabWriterId`.
 */
export function claimTabWriter(page: string): string {
  const held = sessionStorage.getItem(WRITER_KEY);
  const lease = held && UUID.test(held) ? readLease(held) : null;
  const mine = held && UUID.test(held) && !(fresh(lease) && lease.page !== page) ? held : crypto.randomUUID();
  if (mine !== held) sessionStorage.setItem(WRITER_KEY, mine);
  localStorage.setItem(LEASE_PREFIX + mine, JSON.stringify({ page, at: Date.now() }));
  return mine;
}

export function tabWriterId(): string {
  try {
    const writer = claimTabWriter(PAGE);
    leased.add(writer);
    listen();
    if (heartbeat === null) heartbeat = setInterval(renew, HEARTBEAT_MS);
    return writer;
  } catch {
    return crypto.randomUUID();
  }
}

/** Whether some open tab — this one included — is still writing as `writer`. */
export function writerIsLive(writer: string): boolean {
  return fresh(readLease(writer));
}
