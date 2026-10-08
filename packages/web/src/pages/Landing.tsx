/**
 * THE LANDING — three things, and a hard rule about the fourth.
 *
 * Founder layout: the character in the middle, the top of mind above it, the
 * box you keep things in at the bottom, the menu top left, settings top right.
 * Nothing else. This file exists to make that a structure rather than a wish,
 * so the next feature that needs a way in gets a line in `Menu.tsx` instead of
 * a control here.
 *
 * WHY THE LOOP NEEDS NO EXPLAINING HERE. The two changes merged immediately
 * before this page was written were a cue explaining how inspirations form a
 * reading, and a help line explaining it again — copy added because the loop
 * was not legible. This layout makes it legible as GEOMETRY: what you keep
 * goes in at the bottom, what it became sits at the top, and the thing that
 * does the reading is in between, dimming when you stop feeding it. The
 * explanation is not simplified here; it is made unnecessary, which is the
 * only honest way to remove it.
 *
 * THE ONE ADDITION TO THE FOUNDER'S LAYOUT, SAID PLAINLY SO IT CAN BE CUT.
 * When a claim is waiting, the character says it, under the bulb. The reason:
 * answering is the single thing WAKA needs from a person and cannot do alone,
 * and with every destination behind a menu there is otherwise nothing on this
 * screen that asks. A badge was the alternative and is worse — it is chrome
 * that persists whether or not it has anything to say. This line exists only
 * when there is a claim, and it is the character talking, which is the one
 * thing on this page whose job is to have an opinion about you.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Bulb } from "../components/Bulb";
import { Menu } from "../components/Menu";
import {
  createInspiration,
  fetchInspirations,
  fetchTopOfMind,
  listClaims,
  type ApiClaim,
} from "../lib/api";
import { useOptionalAuth } from "../lib/auth-context";
import { normalizeSupportedLocale, t, type SupportedLocale } from "../lib/locales";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface Standing {
  /** Days since the last thing was kept; null until known. */
  quietDays: number | null;
  /** The lines currently at the top of this person's mind. */
  reading: string[];
  /** The next claim waiting, if any. */
  waiting: ApiClaim | null;
}

const NOTHING: Standing = { quietDays: null, reading: [], waiting: null };

export function Landing(): JSX.Element {
  const locale = normalizeSupportedLocale(useOptionalAuth()?.profile?.preferredLocale);
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  const navigate = useNavigate();

  const [standing, setStanding] = useState<Standing>(NOTHING);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    /* Three independent reads, and a failure in any one of them must not blank
       the other two: a person whose top of mind is slow should still see a lit
       bulb and still be able to keep something. */
    void (async () => {
      const [kept, reading, claims] = await Promise.allSettled([
        fetchInspirations({ limit: 1 }),
        fetchTopOfMind(),
        listClaims({ limit: 1 }),
      ]);
      if (!mounted.current) return;

      const latest =
        kept.status === "fulfilled" ? kept.value[0]?.createdAt : undefined;
      const quietDays = latest
        ? Math.max(0, (Date.now() - new Date(latest).getTime()) / MS_PER_DAY)
        : null;

      const entries =
        reading.status === "fulfilled" ? (reading.value?.entries ?? []) : [];

      setStanding({
        quietDays,
        /* Two lines at most. The top of mind is a reading, not a feed, and a
           list long enough to scroll would make the character the thing you
           scroll past. */
        reading: entries
          .filter((entry) => !entry.dismissed)
          .slice(0, 2)
          .map((entry) => entry.body),
        waiting: claims.status === "fulfilled" ? (claims.value.claims[0] ?? null) : null,
      });
    })();
  }, []);

  return (
    <div className="waka-landing">
      <Menu locale={locale} />

      {/* ABOVE: what it currently adds up to. */}
      <section className="waka-landing-reading" aria-label={say("worldReadingTitle")}>
        {standing.reading.map((line) => (
          <p key={line} className="waka-landing-line">
            {line}
          </p>
        ))}
      </section>

      {/* MIDDLE: the character, and the only thing it says. */}
      <section className="waka-landing-character">
        <Bulb locale={locale} quietDays={standing.quietDays} />
        {standing.waiting ? (
          <button
            type="button"
            className="waka-landing-asks"
            onClick={() => navigate("/claims")}
          >
            <span className="waka-landing-asks-label">{say("worldCharacterAsks")}</span>
            <span className="waka-landing-asks-statement">{standing.waiting.statement}</span>
          </button>
        ) : null}
      </section>

      {/* BELOW: the box. The only input on the page, and the only one it needs. */}
      <section className="waka-landing-keep">
        <KeepBox locale={locale} onKept={() => setStanding((s) => ({ ...s, quietDays: 0 }))} />
      </section>
    </div>
  );
}

/**
 * THE BOX — one field, and no modes.
 *
 * Deliberately not the existing composer. That one opens a drawer with a photo
 * button, a link button, a record button and a cancel — four modes for one act,
 * and a link only reachable by pressing "＋ Link" first and typing into a
 * second field. Wiring it in unchanged would import the problem this page
 * exists to remove.
 *
 * What a link needs is nothing: `createInspiration` takes text, and a URL
 * inside that text is a URL the server can enrich. So pasting a link, pasting
 * a sentence, and typing a thought are the same gesture here, which is the
 * whole point of there being one box. Photos and audio are a real capability
 * and they come back through this box later — as something it ACCEPTS, not as
 * three buttons beside it.
 *
 * The bulb brightens the moment a keep lands, because the one fact the
 * character reports is "something was kept just now" and it would be strange
 * for the page to know that and not show it.
 */
function KeepBox({
  locale,
  onKept,
}: {
  locale: SupportedLocale;
  onKept: () => void;
}): JSX.Element {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const keep = useCallback(async () => {
    const words = text.trim();
    if (!words || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await createInspiration({ text: words });
      /* Cleared only on success. A box that empties on failure has thrown away
         the thing a person wrote, which is the one unforgivable bug here. */
      setText("");
      onKept();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }, [text, saving, onKept]);

  return (
    <div className="waka-keep">
      <textarea
        className="waka-keep-box"
        value={text}
        rows={1}
        placeholder={t(locale, "worldKeepPlaceholder")}
        aria-label={t(locale, "worldKeepPlaceholder")}
        disabled={saving}
        onChange={(event) => {
          setText(event.target.value);
          setFailed(false);
        }}
        onKeyDown={(event) => {
          /* Enter keeps; Shift+Enter makes a line. Keeping is the common case
             and should cost one key, but a person writing two sentences must
             not have the first one saved out from under them. */
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void keep();
          }
        }}
      />
      <button
        type="button"
        className="waka-keep-go"
        disabled={saving || text.trim().length === 0}
        onClick={() => void keep()}
      >
        {t(locale, saving ? "worldKeepSaving" : "worldKeepSave")}
      </button>
      {failed ? (
        <p className="waka-keep-failed" role="alert">
          {t(locale, "worldKeepFailed")}
        </p>
      ) : null}
    </div>
  );
}
