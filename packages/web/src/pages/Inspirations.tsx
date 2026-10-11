/**
 * INSPIRATIONS — the archive, as a card grid, at its own address.
 *
 * Founder ruling, twice: principles and inspirations stop being places you
 * travel the camera UP and DOWN to reach. They are pages. The home screen
 * keeps the reading, the character and the box; everything else is a
 * destination with a URL, which also means a browser Back that works and a
 * link you can send someone.
 *
 * THE TILE IS UNIFORM WHETHER OR NOT THERE IS A PICTURE. A card is for
 * "discrete, self-contained items — things you could reorder, remove, or
 * interact with independently", which is exactly what one kept thing is. The
 * grid's whole readability comes from the tiles being the same size, so a
 * text-only keep fills the picture's space with its own words rather than
 * collapsing to a shorter card and breaking the rows. Same height, same
 * width, different filling.
 *
 * NOTHING IS TRUNCATED INTO A LIE. A long keep clips with a fade rather than
 * an ellipsis mid-word, and the full text is one press away on the item
 * itself — the grid is for finding the thing, not for reading it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Menu } from "../components/Menu";
import { ChatCorner } from "../components/ChatCorner";
import { attachmentPreviewImageUrl, updateInspiration } from "../lib/api";
import { dateStamp } from "../lib/words";
/* THE SAME DOOR THE WORLD USES. `loadInspirations` is the archive's own
   reader — it pages, it carries the total the server reports, and it holds
   the invariant that a total is never smaller than what arrived. Reaching
   past it to the HTTP layer would have been a second way to read one thing,
   with its own pagination and its own idea of what the archive holds. */
import { loadInspirations, type Inspiration } from "../lib/data";
import { usePageMenu } from "../lib/page-menu";
import { useOptionalAuth } from "../lib/auth-context";
import { useStanding } from "../lib/standing";
import { formatMessage, normalizeSupportedLocale, t } from "../lib/locales";

type Phase = "loading" | "ready" | "failed";

/** The first image on a keep, if it has one. Links and audio do not qualify:
    a tile's picture has to be a picture, not a favicon standing in for one. */
function pictureOf(row: Inspiration): string | null {
  const image = row.attachments?.find((item) => item.type === "image");
  return image ? attachmentPreviewImageUrl(image.id) : null;
}

export function Inspirations(): JSX.Element {
  const auth = useOptionalAuth();
  const locale = normalizeSupportedLocale(auth?.profile?.preferredLocale);
  /**
   * WHOSE ARCHIVE THIS IS.
   *
   * Founder: "my agent should have its own top of mind, your inspirations,
   * principles." The corner switch moved the camera and nothing else, so
   * standing on an agent's wall and opening this page read your own keeps
   * back at you. The reader already took a profile; nothing was handing it
   * one. See `lib/standing`.
   */
  const standing = useStanding(auth?.account?.id);
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);

  const navigate = useNavigate();
  const menu = usePageMenu(locale, auth?.account?.id);
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
      const field = await loadInspirations(standing.id ?? undefined);
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
  }, [standing.id]);

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
    <main className="waka-page">
      <Menu locale={locale} items={menu.items} current={menu.current} left={<ChatCorner locale={locale} profileId={menu.standing.id ?? auth?.profile?.id} onOpen={id => navigate(`/chat/${id ?? "new"}`)} />} onSettings={menu.onSettings}
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
        {total !== null ? (
          <p className="waka-page-count jar-saved-count">
            {total > rows.length
              ? formatMessage(locale, "worldInspirationCountCapped", { shown: rows.length, total })
              : formatMessage(locale, "worldInspirationCount", { count: total })}
          </p>
        ) : null}
        {rows.length ? (
          <input
            type="search"
            className="waka-page-search"
            value={query}
            placeholder={say("worldInspirationsSearch")}
            aria-label={say("worldInspirationsSearch")}
            onChange={(event) => setQuery(event.target.value)}
          />
        ) : null}
      </header>

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

      {phase === "loading" ? (
        <p className="waka-page-status" role="status">
          {say("worldInspirationsLoad")}
        </p>
      ) : phase === "failed" ? (
        <>
          <p className="waka-page-status" role="alert">
            {say("worldInspirationsFail")}
          </p>
          <button type="button" className="waka-page-retry" onClick={() => void load()}>
            {say("worldRetry")}
          </button>
        </>
      ) : rows.length === 0 ? (
        <p className="waka-page-status">{say("worldInspirationsEmpty")}</p>
      ) : shown.length === 0 ? (
        <p className="waka-page-status">{say("worldInspirationsNoHits")}</p>
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

      {open ? (
        <div className="waka-sheet-scrim" onClick={() => { setOpen(null); setEditing(false); }}>
          {/* THE CARD THE PRODUCT ALREADY HAS (founder: bring back this card
              design). It wears `.jar-panel`'s own inner classes — the date
              stamp, the text, the footer row — so the design comes from the
              one stylesheet that defines it rather than from a lookalike that
              would drift the first time the original moved. Only the
              positioning is this page's: in the world the panel flies in from
              a memory's own place, and here it opens over the grid it was
              pressed on.

              WITHOUT THE VISIBILITY PAIR OR THE LINK (founder: remove this).
              Private/public and the copy-link both still exist on the card in
              the world; this surface is for reading what you kept and fixing
              its words. */}
          <article
            className="waka-sheet jar-panel-card"
            role="dialog"
            aria-modal="true"
            aria-label={open.preview.slice(0, 60)}
            onClick={(event) => event.stopPropagation()}
          >
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
        </div>
      ) : null}
    </main>
  );
}
