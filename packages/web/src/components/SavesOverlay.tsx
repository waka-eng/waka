/**
 * YOUR INSPIRATIONS — the archive, OVER the world rather than instead of it.
 *
 * THIS WAS A PAGE AND IT IS NOT ANY MORE. Founder: "for your inspirations,
 * after I click on it, I feel like I'm lost how to go back to the previous
 * screen, and I didn't realise clicking on top of mind would leave me there.
 * So maybe for your inspirations, this should just be a modal that you can
 * escape to go back to your top of mind."
 *
 * WHY THE PAGE COULD NOT BE FIXED IN PLACE. Being lost was not a missing
 * back button — a page had been given everything a page can have: an
 * address, a browser Back, a switcher naming the view. The problem was that
 * reaching it UNMOUNTED THE WORLD. Once the world is gone there is nothing
 * to return to, only somewhere else to navigate, and every control that
 * could take you back necessarily reads as a trip rather than a return.
 * "Top of mind" in the switcher was the proof: pressing it did exactly what
 * it said and still felt like being moved, because it was moving you.
 *
 * An overlay cannot have that bug. The world is still mounted and still
 * visible behind the scrim, so leaving is dismissal — Escape, the scrim, the
 * close — and dismissal always lands you exactly where you were, with the
 * camera where you left it. See `ViewOpen` in `lib/view-location`: this is a
 * parameter on the world's address, not an address of its own.
 *
 * IT NAMES ITSELF NOW. As a page it deliberately did not, because the
 * switcher above it printed the view's name and two namers disagreed. An
 * overlay has no switcher above it and the world behind it is showing
 * someone's top of mind, so without a title the archive would be an
 * unlabelled grid floating over an unrelated statement.
 *
 * THE TILE IS UNIFORM WHETHER OR NOT THERE IS A PICTURE. A card is for
 * "discrete, self-contained items — things you could reorder, remove, or
 * interact with independently", which is exactly what one kept thing is. The
 * grid's whole readability comes from the tiles being the same size, so a
 * text-only keep fills the picture's space with its own words rather than
 * collapsing to a shorter card and breaking the rows.
 *
 * NOTHING IS TRUNCATED INTO A LIE. A long keep clips with a fade rather than
 * an ellipsis mid-word, and the full text is one press away on the item
 * itself — the grid is for finding the thing, not for reading it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { DialogSurface } from "./DialogSurface";
import { attachmentPreviewImageUrl, updateInspiration } from "../lib/api";
import { dateStamp } from "../lib/words";
/* THE SAME DOOR THE WORLD USES. `loadInspirations` is the archive's own
   reader — it pages, it carries the total the server reports, and it holds
   the invariant that a total is never smaller than what arrived. Reaching
   past it to the HTTP layer would have been a second way to read one thing,
   with its own pagination and its own idea of what the archive holds. */
import { loadInspirations, type Inspiration } from "../lib/data";
import { formatMessage, t, type SupportedLocale } from "../lib/locales";

type Phase = "loading" | "ready" | "failed";

/** The first image on a keep, if it has one. Links and audio do not qualify:
    a tile's picture has to be a picture, not a favicon standing in for one. */
function pictureOf(row: Inspiration): string | null {
  const image = row.attachments?.find((item) => item.type === "image");
  return image ? attachmentPreviewImageUrl(image.id) : null;
}

export function SavesOverlay({ locale, profileId, title, owners, onOwner, onClose }: {
  locale: SupportedLocale;
  /** Whose archive. The caller already knows whose world is on screen; this
      surface should never work it out a second way and risk disagreeing. */
  profileId?: string | null;
  /** Named by the caller, because only the caller knows whether the world
      behind is yours or your agent's. */
  title: string;
  /**
   * WHOSE ARCHIVE THIS COULD BE INSTEAD — and switching moves the world too.
   *
   * Founder: "From the inspirations modal, it should always let the user
   * switch between your inspirations and your agent's inspirations as well.
   * And if the user changes it in the modal, then the page behind it should
   * also change."
   *
   * That second sentence is the whole design. A switch that changed only
   * what this overlay showed would leave the world behind it disagreeing —
   * the creature wearing one face while the grid in front of it held someone
   * else's saves — and the product would be saying two things about whose
   * material you are reading. So the press changes the ADDRESS, and this
   * overlay follows it the way everything else does, rather than holding a
   * second opinion about the owner.
   *
   * Absent when the account has no agent: a switcher with one row is a label
   * pretending to be a control.
   */
  owners?: ReadonlyArray<{ id: string | null; name: string; here: boolean }>;
  onOwner?: (id: string | null) => void;
  onClose: () => void;
}): JSX.Element {
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  const [rows, setRows] = useState<Inspiration[]>([]);
  /* FIND IS A THING YOU DO TO YOUR INSPIRATIONS, so it lives on the page that
     holds them rather than as a destination of its own. It was a row in the
     menu — a verb among places — and the one entry there that did not go
     anywhere. Filtering happens here, over what is already loaded, so typing
     narrows in place with no round trip and no empty frame between keys. */
  const [query, setQuery] = useState("");
  /**
   * WHICH CATEGORY IS BEING LOOKED AT, with `null` meaning all of them.
   *
   * Founder: "for the inspirations that I saved, I want to add tabs. So it's
   * like all and then we create categories based on the inspirations."
   *
   * BASED ON THEM, NOT IMPOSED ON THEM. There is no folder to file a keep
   * into and no tag to remember to apply — saving must cost nothing, and a
   * taxonomy you maintain is a cost paid at exactly the moment the product
   * promises not to charge one. The category is read off what was saved,
   * the same way a claim is.
   *
   * THE ROW ONLY APPEARS WHEN IT DIVIDES SOMETHING. One tab is not a choice,
   * and two tabs where one holds everything is a control that looks like it
   * does something and does not. See `categories` below.
   */
  const [category, setCategory] = useState<string | null>(null);
  /* HOW MUCH IS BEHIND THIS DOOR. The archive's size was announced on the
     menu row that used to lead here; it is a fact about this page, so it
     moved onto it when the row stopped carrying one. `total` is what the
     archive holds, which is not the same as how many arrived — an older
     server omits it, and then the length of what came is the best there is. */
  const [total, setTotal] = useState<number | null>(null);
  /* Editing is a state of the OPEN card, not of the page: closing is how you
     leave it, and a page-level edit flag would survive a card it no longer
     belongs to. */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<Inspiration | null>(null);
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
      const field = await loadInspirations(profileId ?? undefined);
      if (!mounted.current) return;
      /* Newest first here: a grid is read from the top left, and the archive's
         own order is oldest first because the ground lays them down that way. */
      setRows([...field.inspirations].reverse());
      /* NEVER A NUMBER SMALLER THAN WHAT IS ON SCREEN. A stale or wrong total
         coming back below the count of cards would print "4 of 2" — the page
         contradicting itself in one line, which is worse than saying nothing.
         `loadInspirations` already holds this; holding it here too means the
         page cannot be made to lie by a reader that stops holding it. */
      setTotal(Math.max(field.total, field.inspirations.length));
      setPhase("ready");
    } catch {
      if (!mounted.current) return;
      setPhase("failed");
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Case-folded substring over the preview, which is what a person reading the
     grid can actually see. Matching text they cannot read would return cards
     with no visible reason for being there. */
  const needle = query.trim().toLowerCase();

  /* Ordered by how much each holds, largest first: the tab you are most
     likely to want is the one with the most behind it, and an alphabetical
     row would put that wherever its first letter happened to fall. */
  const categories = (() => {
    const counts = new Map<string, number>();
    for (const row of rows) if (row.category) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  })();

  /* A chosen category that no longer exists — the last keep in it was edited
     or deleted — shows everything rather than an empty grid under a tab that
     is no longer in the row to press again. */
  const active = category && categories.includes(category) ? category : null;

  const shown = rows.filter(
    (row) =>
      (!needle || row.preview.toLowerCase().includes(needle)) &&
      (!active || row.category === active),
  );

  return (
    <div className="waka-over-scrim" onClick={onClose}>
      <DialogSurface
        className="waka-over"
        aria-label={title}
        onClose={onClose}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="waka-over-head">
          {/* THE NAME, THEN WHAT IS BEHIND IT. Founder: "Just write the
              number 36 next to your inspirations so that the search bar is
              taking up the full space." The count was sharing a row with the
              search, which left the field a stub on a surface whose only
              other control is that field. It is a fact ABOUT the archive, so
              it belongs with the archive's name.

              The owner switch sits beside the title rather than replacing
              it, which is a correction: replacing it read as "Me / My agent"
              with nothing saying what of theirs you were looking at. The
              overlay has to name itself — there is no switcher above it and
              the world behind is showing somebody's top of mind. */}
          {/* THE NAME BECOMES THE WAY BACK. Founder: "with a button to go
              back to all." It replaces the title rather than sitting beside
              it, because at this depth the title would be naming a place you
              are not in — and two controls that both lead out is the stack
              this change exists to remove. */}
          {open ? (
            <button type="button" className="waka-over-back" onClick={() => { setOpen(null); setEditing(false); }}>
              <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true" focusable="false">
                <path d="M6.5 1.5 2.5 5.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {say("worldBackToAll")}
            </button>
          ) : (
          <span className="waka-over-name">
            <h2 className="waka-over-title">{title}</h2>
            {total !== null ? (
              <span className="waka-over-count jar-saved-count">
                {total > rows.length
                  ? formatMessage(locale, "worldInspirationCountCapped", { shown: rows.length, total })
                  : formatMessage(locale, "worldInspirationCount", { count: total })}
              </span>
            ) : null}
          </span>
          )}
          {/* THE SURFACE EXPLAINS ITSELF, WHERE THE QUESTION IS ASKED.
              Founder, originally: "there should be like an info icon next to
              each of the top of mind, principles, the inspirations so that
              users can see what these are." Three icons in the switcher
              answered that in the one place it is least useful — before you
              arrive, about a thing you have not seen — and they went with the
              dropdown. One line here costs no press and no icon. */}
          {!open && owners && owners.length > 1 && onOwner ? (
            <span className="waka-over-owners" role="group" aria-label={title}>
              {owners.map((owner) => (
                <button
                  key={owner.id ?? "me"}
                  type="button"
                  className={`waka-over-owner${owner.here ? " waka-over-owner--here" : ""}`}
                  aria-pressed={owner.here}
                  onClick={() => { if (!owner.here) onOwner(owner.id); }}
                >
                  {owner.name}
                </button>
              ))}
            </span>
          ) : null}
          <button type="button" className="waka-over-close" aria-label={say("worldCardClose")} onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        {/* THE TWO FACTS A GRID NEEDS BEFORE IT CAN BE SEARCHED: how much is
            behind it, and a way to narrow it. Both were in the page's header
            and both still belong together — the count tells you whether
            searching is worth it, and the field is the thing you search with.

            FINDING IS A THING YOU DO TO YOUR INSPIRATIONS, so it lives on the
            surface that holds them rather than as a destination of its own.
            It was once a row in the menu — a verb among places, and the only
            entry there that did not go anywhere. Filtering happens over what
            is already loaded, so typing narrows in place with no round trip
            and no empty frame between keys. */}
        {/* THE FIELD TAKES THE ROW, because it is the only thing on it and
            because finding is a thing you do TO your inspirations — it lives
            on the surface that holds them rather than as a destination of its
            own. Filtering happens over what is already loaded, so typing
            narrows in place with no round trip and no empty frame between
            keys. */}
        {!open ? <p className="waka-over-what">{say("worldFieldWhatIs")}</p> : null}
        {!open && rows.length ? (
          <input
            type="search"
            className="waka-over-search"
            value={query}
            placeholder={say("worldInspirationsSearch")}
            aria-label={say("worldInspirationsSearch")}
            onChange={(event) => setQuery(event.target.value)}
          />
        ) : null}

        {/* The row divides nothing until there are two things to divide into. */}
        {phase === "ready" && categories.length > 1 ? (
          <div className="waka-tabs" role="tablist" aria-label={say("worldInspirationsCategories")}>
            <button
              type="button"
              role="tab"
              aria-selected={active === null}
              className={`waka-tab${active === null ? " waka-tab--on" : ""}`}
              onClick={() => setCategory(null)}
            >
              {say("worldInspirationsAll")}
            </button>
            {categories.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={active === name}
                className={`waka-tab${active === name ? " waka-tab--on" : ""}`}
                onClick={() => setCategory(name)}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}

        {open ? (
          <article className="waka-over-one jar-panel-card">
            <div className="jar-panel-head">
                <span className="jar-panel-when jar-label">
                  {dateStamp(open.capturedMs, locale)}
                </span>
              </div>

              {pictureOf(open) ? (
                <img className="waka-sheet-picture" src={pictureOf(open)!} alt="" />
              ) : null}

              {editing ? (
                <textarea
                  className="jar-panel-text jar-panel-edit"
                  value={draft}
                  aria-label={say("worldEditWording")}
                  onChange={(event) => setDraft(event.target.value)}
                />
              ) : (
                <p className="jar-panel-text">{open.preview}</p>
              )}

              <p className="jar-ask jar-ask--after jar-panel-foot">
                <span className="jar-panel-foot-l">
                  {editing ? (
                    <button
                      type="button"
                      className="jar-panel-save"
                      disabled={saving || !draft.trim() || draft === open.preview}
                      onClick={() => {
                        const words = draft.trim();
                        setSaving(true);
                        void updateInspiration(open.id, { text: words })
                          .then(() => {
                            /* The grid holds what the page loaded, so the card
                               and the tile behind it have to agree without a
                               refetch — otherwise closing reveals the old words. */
                            setRows((all) =>
                              all.map((row) => (row.id === open.id ? { ...row, preview: words } : row)),
                            );
                            setOpen((card) => (card ? { ...card, preview: words } : card));
                            setEditing(false);
                          })
                          .catch(() => undefined)
                          .finally(() => setSaving(false));
                      }}
                    >
                      {say("worldSave")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setDraft(open.preview); setEditing(true); }}
                    >
                      {say("worldEditWording")}
                    </button>
                  )}
                </span>
                <span className="jar-panel-foot-r">
                  <button
                    type="button"
                    onClick={() => (editing ? setEditing(false) : setOpen(null))}
                  >
                    {say(editing ? "worldCancelEdit" : "worldCardClose")}
                  </button>
                </span>
              </p>
            </article>
        ) : phase === "loading" ? (
          <p className="waka-over-status" role="status">
            {say("worldInspirationsLoad")}
          </p>
        ) : phase === "failed" ? (
          <>
            <p className="waka-over-status" role="alert">
              {say("worldInspirationsFail")}
            </p>
            <button type="button" className="waka-over-retry" onClick={() => void load()}>
              {say("worldRetry")}
            </button>
          </>
        ) : rows.length === 0 ? (
          <p className="waka-over-status">{say("worldInspirationsEmpty")}</p>
        ) : shown.length === 0 ? (
          <p className="waka-over-status">{say("worldInspirationsNoHits")}</p>
        ) : (
          <ul className="waka-cards">
            {shown.map((row) => {
              const picture = pictureOf(row);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    className={`waka-card${picture ? "" : " waka-card--text"}`}
                    /* OPENS HERE, NOT SOMEWHERE ELSE (founder ruling). Pressing
                       a tile used to throw you into the world at the memory's
                       own place, which is a page change, a camera flight and a
                       lost scroll position to read one thing. It opens over the
                       grid and closes back onto it. */
                    onClick={() => setOpen(row)}
                  >
                    {picture ? (
                      <span className="waka-card-picture">
                        {/* Decorative here: the words below are the label, and a
                            filename read aloud before them would bury it. */}
                        <img src={picture} alt="" loading="lazy" />
                      </span>
                    ) : null}
                    <span className="waka-card-body">
                      <span className="waka-card-text">{row.preview}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* ONE SURFACE, TWO STATES — NOT A SHEET OVER A SHEET.
            Founder: "modal and a modal is bad, so when user clicks on a box,
            then switch this whole page to that inspiration with a button to
            go back to all."

            Right, and the second layer was never earning its separateness. A
            dialog inside a dialog has two scrims, two Escapes and two ways
            out, and a person who presses Escape has to know which of the two
            they are dismissing — the cost of a stack is paid every time, by
            everyone, for a depth nobody asked for. The archive and one kept
            thing are the same surface at two depths, so the surface simply
            goes to that depth and offers the way back.

            The grid keeps its scroll position because it is not unmounted —
            `open` only decides which half renders — so coming back lands you
            where you were rather than at the top of a reloaded page. */}
      </DialogSurface>
    </div>
  );
}
