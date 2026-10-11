/**
 * YOUR DAYS — a dot per date, burning as brightly as that day was kept.
 *
 * Founder: "a calendar view where each date has a circle or like the dot and
 * then the color changes depending on how many inspirations I added that day."
 *
 * IT IS BRIGHTNESS, NOT HUE. Light is the only meaning channel this product
 * has — the companion dims when you keep less, the field's orbs carry their
 * own aliveness the same way, and `chrome.css` drains `--error` of hue with
 * the note "there is no red in Waka". A calendar that went green at four keeps
 * and amber at one would be inventing a second channel to say a thing the
 * first one already says, and it would say it in the one place the product
 * reserves for identity. So a busy day is a brighter day.
 *
 * THE SCALE IS RELATIVE TO YOUR OWN BUSIEST DAY, not to a fixed number. Three
 * keeps is a lot for one person and a quiet Tuesday for another; a constant
 * would flatten the first person's whole year to the dim end. The brightest
 * dot on the page is always the best day on the page.
 *
 * AND A SILENT DAY IS STILL DRAWN. The grid comes from the calendar, not from
 * the server — every date in the window gets a dot, and the ones with nothing
 * behind them sit at the floor rather than being absent. A gap in a calendar
 * reads as a missing square; a dim dot reads as a quiet day, which is what it
 * was.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Menu } from "../components/Menu";
import { ChatCorner } from "../components/ChatCorner";
import { listKeptDays, type ApiKeptDay } from "../lib/api";
import { useOptionalAuth } from "../lib/auth-context";
import { formatMessage, normalizeSupportedLocale, t } from "../lib/locales";
import { usePageMenu } from "../lib/page-menu";

type Phase = "loading" | "ready" | "failed";

/** How many days the grid draws. Seventeen weeks reads as a season. */
const WINDOW_DAYS = 119;

/** The dimmest a day burns. Nothing is dark: a day you kept nothing is still
    a day you had, and the product's rule is that fading never deletes. */
const DAY_FLOOR = 0.1;

interface Cell {
  key: string;
  label: string;
  kept: number;
  glow: number;
}

function buildGrid(rows: ApiKeptDay[], now: Date): Cell[] {
  const byDay = new Map(rows.map((row) => [row.day, row.kept]));
  /* The busiest day on the page sets the top of the scale — see the note. */
  const busiest = rows.reduce((top, row) => Math.max(top, row.kept), 0);
  const cells: Cell[] = [];
  for (let back = WINDOW_DAYS - 1; back >= 0; back -= 1) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - back);
    const key = date.toISOString().slice(0, 10);
    const kept = byDay.get(key) ?? 0;
    cells.push({
      key,
      label: date.toUTCString().slice(5, 16),
      kept,
      /* Square-rooted so the first keep of a day is the biggest step there is.
         Linear made one keep nearly indistinguishable from none on any week
         with a busy day in it — and "something happened here" is the fact the
         calendar exists to show. */
      glow: kept === 0 || busiest === 0 ? 0 : DAY_FLOOR + (1 - DAY_FLOOR) * Math.sqrt(kept / busiest),
    });
  }
  return cells;
}

export function Days(): JSX.Element {
  const auth = useOptionalAuth();
  const locale = normalizeSupportedLocale(auth?.profile?.preferredLocale);
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  const navigate = useNavigate();
  const menu = usePageMenu(locale, auth?.account?.id);

  const [rows, setRows] = useState<ApiKeptDay[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const days = await listKeptDays({ days: WINDOW_DAYS });
      if (!mounted.current) return;
      setRows(days);
      setPhase("ready");
    } catch {
      if (!mounted.current) return;
      setPhase("failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* The clock is read once per load, not per render: a grid that rebuilt on
     every paint would shift at midnight under a reader's hands. */
  const cells = useMemo(() => buildGrid(rows, new Date()), [rows]);
  const kept = rows.reduce((sum, row) => sum + row.kept, 0);

  return (
    <main className="waka-page">
      <Menu locale={locale} items={menu.items} current={menu.current} left={<ChatCorner locale={locale} profileId={menu.standing.id ?? auth?.profile?.id} onOpen={id => navigate(`/chat/${id ?? "new"}`)} />} label="worldDaysTitle" onSettings={menu.onSettings}
        account={auth?.account ? { name: auth?.profile?.name, email: auth?.account.email } : null} />
      <header className="waka-page-head">
        {/* NO BACK BUTTON. The menu is the navigation and the browser
            already has a back — a third way out of a page is not a
            convenience, it is one more thing to read in a header whose job
            is to name the page. */}
        {/* THE PAGE DOES NOT NAME ITSELF ANY MORE. The switcher at the top
            of the screen names the view, and printing the same words again
            as a heading made the name appear twice on two of the three pages
            and once on the third — which is exactly the inconsistency the
            founder saw between them. One namer, one style, everywhere. */}
      </header>

      {phase === "loading" ? (
        <p className="waka-page-status" role="status">
          {say("worldDaysLoad")}
        </p>
      ) : phase === "failed" ? (
        <>
          <p className="waka-page-status" role="alert">
            {say("worldDaysFail")}
          </p>
          <button type="button" className="waka-page-retry" onClick={() => void load()}>
            {say("worldRetry")}
          </button>
        </>
      ) : kept === 0 ? (
        <p className="waka-page-status">{say("worldDaysEmpty")}</p>
      ) : (
        <ol className="waka-days" aria-label={say("worldDaysTitle")}>
          {cells.map((cell) => (
            <li key={cell.key}>
              <button
                type="button"
                className="waka-day"
                style={{ "--waka-day-glow": cell.glow.toFixed(3) } as React.CSSProperties}
                /* The dot is the picture; the sentence is for anyone who
                   cannot read a brightness, which includes every screen
                   reader and anyone on a washed-out display. */
                /* THE WAY INTO YOUR OWN HISTORY. The dial's handle used to
                   be a word in the corner of the home screen; it is gone from
                   there, so the dates themselves are how a day is reached.
                   `?at=` is the reading's own address for a moment in time,
                   which is why this is a link to a date rather than a second
                   dial living on this page. */
                onClick={() => navigate(`/?at=${Date.parse(`${cell.key}T12:00:00Z`)}`)}
                title={`${cell.label} — ${
                  cell.kept
                    ? formatMessage(locale, "worldDaysKept", { count: cell.kept })
                    : say("worldDaysNone")
                }`}
              >
                <span className="sr-only">
                  {cell.label} —{" "}
                  {cell.kept
                    ? formatMessage(locale, "worldDaysKept", { count: cell.kept })
                    : say("worldDaysNone")}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
