/**
 * ═══ WHY WAKA — ONE SCENE IN FOUR BEATS ══════════════════════════════════
 *
 * The four intro frames (A–D on the canvas): the pile you never reopen,
 * saving is one tap, I read what you keep, I find your people. Founder: "the
 * transition should be smooth for the 4 onboarding pages too. the character
 * should move etc continuously rather than each screen feeling like its own."
 *
 * So this is ONE plate that stays mounted, and Next (or a swipe, or an arrow
 * key) advances a BEAT. Each frame's composition is a beat's resting state,
 * and every prop carries into the next instead of cutting:
 *
 *   A → B  the sinking note cards dissolve into small lights — three of them
 *          become the lights that rise from the three glyphs into the creature
 *   B → C  those lights become the ones orbiting it, and one gathers bright
 *   C → D  the orbit closes into that one light, which is the light that
 *          passes between the two creatures once the other one has walked in
 *
 * The creature is the page's one creature (`CreatureStage`), hopping between
 * its places; this file only leaves it a slot per beat. Text cross-fades in
 * place. Going back reverses the same beats. Under reduced motion nothing
 * travels: the beats cross-fade with every prop already where it ends.
 *
 * THE PLATE IS 390 WIDE in the frames' coordinates and is scaled down to fit a
 * smaller phone. The scale is OBSERVED (`ResizeObserver`), never read once.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

import { t, type SupportedLocale } from "../../lib/locales";
import type { MessageKey } from "../../lib/i18n";
import { WALK_MS } from "../../character/walk";
import { OWNER_BEING } from "../../character/body";
import { WalkingCompanion } from "../WalkingCompanion";
import { CreatureSlot, type SlotLook } from "./CreatureStage";
import { Dots, Glyph } from "./Creature";

const PLATE_W = 390;
const PLATE_H = 752;
const BEATS = 4;
/** How long the intro takes to step aside when Start is pressed. */
const INTRO_LEAVE_MS = 250;

function useFit() {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (!box || !box.width || !box.height) return;
      setFit(Math.min(1, box.width / PLATE_W, box.height / PLATE_H));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, fit };
}

/* ── where the creature stands in each beat (its footprint's top-left) ── */
const CREATURE: Array<SlotLook & { left: number; top: number }> = [
  { size: "small", left: 157, top: 430 },
  { size: "large", left: 137, top: 150, motion: "catch" },
  { size: "large", left: 137, top: 262, eyes: "closed", motion: "lift" },
  { size: "medium", left: 66, top: 300, motion: "lean" },
];

/* ── the five props: a note card in A, a light after it ── */
interface Card { left: number; top: number; w: number; h: number; r: string; ground: string; sink: string; delay: string }
const CARDS: Card[] = [
  { left: 34, top: 120, w: 120, h: 80, r: "-8deg", ground: "#2a2c33", sink: "6s", delay: "0s" },
  { left: 210, top: 96, w: 132, h: 96, r: "6deg", ground: "#26303c", sink: "7s", delay: "1s" },
  { left: 120, top: 232, w: 150, h: 64, r: "3deg", ground: "#2b2a30", sink: "5.5s", delay: "0.5s" },
  { left: 22, top: 300, w: 110, h: 60, r: "-4deg", ground: "#2c2a2f", sink: "6.5s", delay: "2s" },
  { left: 256, top: 268, w: 104, h: 70, r: "9deg", ground: "#292d33", sink: "7.5s", delay: "1.5s" },
];
/** After a prop has travelled to its new place, that beat's own motion starts. */
const SETTLE = 0.6;
/* The other person sets off this long after D begins and walks `WALK_MS`;
   the light passes between them only once it has arrived. */
const SET_OFF_MS = 400;
const ARRIVED = `${(SET_OFF_MS + WALK_MS) / 1000}s`;

interface Light { left: number; top: number; size: number; colour: string; glow: string; animation: string; dx?: string; d?: string }
const rise = (at: number, dx: string, delay: number, colour: string): Light =>
  ({ left: at, top: 696, size: 12, colour, glow: `0 0 18px ${colour}`, dx, animation: `onb-rise 2.4s ease-out ${SETTLE + delay}s infinite` });
const orbit = (d: string, size: number, duration: string, delay: string, colour: string): Light =>
  ({ left: 190, top: 300, size, colour, glow: `0 0 14px ${colour}`, d,
    animation: `onb-orbit ${duration} linear ${delay} infinite, onb-thin 6s ${SETTLE}s infinite alternate` });
const GATHER: Light = { left: 189, top: 196, size: 14, colour: "#fff7e6", glow: "0 0 30px 8px rgba(255,240,210,0.6)",
  animation: `onb-gather 6s ease-out ${SETTLE}s infinite alternate` };
const PASS: Light = { left: 150, top: 324, size: 12, colour: "#fff6e4", glow: "0 0 22px 4px rgba(255,240,210,0.7)",
  animation: `onb-pass 5s ease-in-out ${ARRIVED} infinite alternate both` };

/** Each prop's light in beats B, C and D; null is gone, into the creature. */
const LIGHTS: Array<[Light | null, Light | null, Light | null]> = [
  [rise(69, "60px", 0, "#f3ebd8"), orbit("92px", 10, "5s", "0s", "#f3ebd8"), null],
  [null, orbit("78px", 9, "4s", "-1.3s", "#efe3c8"), null],
  [rise(189, "0px", 0.8, "#f8f2e6"), orbit("104px", 8, "6s", "-3s", "#f8f2e6"), null],
  [null, GATHER, PASS],
  [rise(309, "-60px", 1.6, "#efe3c8"), orbit("86px", 9, "4.6s", "-2.2s", "#f3ebd8"), null],
];
/** Where a light that is gone goes, per beat: into that beat's creature. */
const INTO: Array<{ left: number; top: number }> = [
  { left: 195, top: 470 },
  { left: 195, top: 193 },
  { left: 195, top: 305 },
  { left: 116, top: 338 },
];

function prop(index: number, beat: number): CSSProperties {
  if (beat === 0) {
    const c = CARDS[index]!;
    return { left: c.left, top: c.top, width: c.w, height: c.h, borderRadius: 10, background: c.ground,
      ["--r" as string]: c.r, animation: `onb-sink ${c.sink} ease-in ${c.delay} infinite alternate`, opacity: 1 };
  }
  const light = LIGHTS[index]![beat - 1];
  if (!light) {
    const into = INTO[beat]!;
    return { left: into.left, top: into.top, width: 4, height: 4, borderRadius: "50%", background: "#f3ebd8", opacity: 0, animation: "none" };
  }
  return { left: light.left, top: light.top, width: light.size, height: light.size, borderRadius: "50%",
    background: light.colour, boxShadow: light.glow, opacity: 1, animation: light.animation,
    ["--dx" as string]: light.dx ?? "0px", ["--d" as string]: light.d ?? "0px" };
}

const TEXT: Array<{ top: number; title: MessageKey; body: MessageKey }> = [
  { top: 540, title: "onboardingPileTitle", body: "onboardingPileBody" },
  { top: 300, title: "onboardingTapTitle", body: "onboardingTapBody" },
  { top: 470, title: "onboardingReadTitle", body: "onboardingReadBody" },
  { top: 470, title: "onboardingPeopleTitle", body: "onboardingPeopleBody" },
];
const CARD_WORDS: MessageKey[] = ["onboardingPileNotes", "onboardingPileScreenshot", "onboardingPileReadLater", "onboardingPileVoiceMemo", "onboardingPileSavedPost"];

export function OnboardingIntro({ locale, onDone }: { locale: SupportedLocale; onDone: () => void }): JSX.Element {
  const say = (key: MessageKey) => t(locale, key);
  const [beat, setBeat] = useState(0);
  const [leaving, setLeaving] = useState(false);
  /* The other person stays a moment after D, so it fades rather than vanishes. */
  const [walker, setWalker] = useState(false);
  const { ref, fit } = useFit();
  const start = useRef<{ x: number; y: number } | null>(null);
  const last = beat === BEATS - 1;
  const forward = () => {
    if (leaving) return;
    if (!last) { setBeat((value) => Math.min(BEATS - 1, value + 1)); return; }
    setLeaving(true);
    window.setTimeout(onDone, INTRO_LEAVE_MS);
  };
  const back = () => { if (!leaving) setBeat((value) => Math.max(0, value - 1)); };

  useEffect(() => {
    if (beat === BEATS - 1) { setWalker(true); return undefined; }
    const timer = window.setTimeout(() => setWalker(false), 300);
    return () => window.clearTimeout(timer);
  }, [beat]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") setBeat((value) => Math.min(BEATS - 1, value + 1));
      if (event.key === "ArrowLeft") setBeat((value) => Math.max(0, value - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const down = (event: PointerEvent) => { start.current = { x: event.clientX, y: event.clientY }; };
  const up = (event: PointerEvent) => {
    const from = start.current; start.current = null;
    if (!from) return;
    const dx = event.clientX - from.x, dy = event.clientY - from.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0 && !last) forward();
    if (dx > 0) back();
  };

  const here = CREATURE[beat]!;
  return (
    <main className={`onb onb-intro${leaving ? " onb-intro--leaving" : ""}`} data-beat={beat}
      onPointerDown={down} onPointerUp={up} onPointerCancel={() => { start.current = null; }}>
      <span className="onb-intro-glow" aria-hidden="true" />
      <div className="onb-stage">
        <div className="onb-fit" ref={ref}>
          <div className="onb-plate" style={{ ["--onb-fit" as string]: fit }}>
            <div className="onb-props" aria-hidden="true">
              {CARDS.map((_, index) => (
                <div key={index} className="onb-bit" style={prop(index, beat)}>
                  <div className="onb-bit-face">
                    {index === 0 ? <><div className="onb-pile-line" style={{ width: "80%" }} /><div className="onb-pile-line" style={{ width: "60%", marginTop: 8 }} /></> : null}
                    {index === 1 ? <div className="onb-bit-shot" /> : null}
                    <p className={index < 2 ? "onb-pile-meta" : undefined}>{say(CARD_WORDS[index]!)}</p>
                    {index === 2 || index === 4 ? <div className="onb-pile-line" style={{ width: "70%", marginTop: 10 }} /> : null}
                    {index === 3 ? <div className="onb-bit-wave" /> : null}
                  </div>
                </div>
              ))}
            </div>
            <CreatureSlot size={here.size} eyes={here.eyes} motion={here.motion} place={beat}
              style={{ position: "absolute", left: here.left, top: here.top }} />
            {walker ? (
              <span className={`onb-walker${last && !leaving ? "" : " onb-walker--gone"}`}>
                <span className="onb-creature-real">
                  <WalkingCompanion size={88} being={OWNER_BEING} cool distance={150} delayMs={SET_OFF_MS} />
                </span>
              </span>
            ) : null}
            <div className="onb-glyphs" aria-hidden="true" data-on={beat === 1 ? "" : undefined}>
              <span className="onb-glyph"><Glyph kind="write" /><span>{say("onboardingTapThought")}</span></span>
              <span className="onb-glyph" style={{ animationDelay: "0.8s" }}><Glyph kind="photo" /><span>{say("onboardingTapScreenshot")}</span></span>
              <span className="onb-glyph" style={{ animationDelay: "1.6s" }}><Glyph kind="voice" /><span>{say("onboardingTapVoice")}</span></span>
            </div>
            {TEXT.map((words, index) => (
              <div key={index} className="onb-words onb-beat-words" data-on={index === beat ? "" : undefined}
                aria-hidden={index === beat ? undefined : true} style={{ top: words.top }}>
                {index === beat ? <h1 className="onb-title">{say(words.title)}</h1> : <p className="onb-title">{say(words.title)}</p>}
                <p className="onb-sub">{say(words.body)}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="onb-foot onb-intro-foot">
          <Dots count={BEATS} on={beat + 1} />
          <button type="button" className="onb-go" onClick={forward} disabled={leaving}>
            {last ? say("onboardingStart") : say("onboardingNext")}
          </button>
        </div>
      </div>
    </main>
  );
}
