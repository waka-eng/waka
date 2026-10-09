/**
 * PRINCIPLES — layer 4, at its own address.
 *
 * The other half of the founder's ruling: you no longer travel the camera UP
 * to reach these. They are a page.
 *
 * ONE LINE EACH, AND NOTHING BESIDE IT. Founder ruling: "a principle shouldn't
 * be overly explained. It should be so good the user reads it and goes yeah,
 * this is like me." So this page prints statements. No evidence list, no
 * confidence, no citation count, no date — all of that exists and all of it is
 * a press away on the principle itself. What the page is FOR is recognising
 * yourself, and every number beside a sentence is something to read instead of
 * the sentence.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Menu } from "../components/Menu";
import { fetchPrinciples, type ApiPrinciple } from "../lib/api";
import { usePageMenu } from "../lib/page-menu";
import { useOptionalAuth } from "../lib/auth-context";
import { normalizeSupportedLocale, t } from "../lib/locales";

type Phase = "loading" | "ready" | "failed";

export function Principles(): JSX.Element {
  const locale = normalizeSupportedLocale(useOptionalAuth()?.profile?.preferredLocale);
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  const navigate = useNavigate();

  const menu = usePageMenu(locale);
  const [rows, setRows] = useState<ApiPrinciple[]>([]);
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
      const held = await fetchPrinciples();
      if (!mounted.current) return;
      setRows(held);
      setPhase("ready");
    } catch {
      if (!mounted.current) return;
      setPhase("failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="waka-page">
      <Menu locale={locale} items={menu.items} current={menu.current} onSettings={menu.onSettings} onChat={menu.onChat} />
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
          {say("worldPrinciplesLoading")}
        </p>
      ) : phase === "failed" ? (
        <>
          <p className="waka-page-status" role="alert">
            {say("worldPrinciplesFailed")}
          </p>
          <button type="button" className="waka-page-retry" onClick={() => void load()}>
            {say("worldRetry")}
          </button>
        </>
      ) : rows.length === 0 ? (
        <p className="waka-page-status">{say("worldPrinciplesEmpty")}</p>
      ) : (
        <ul className="waka-statements">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="waka-statement"
                onClick={() => navigate(`/principles/${row.id}`)}
              >
                {row.statement}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
