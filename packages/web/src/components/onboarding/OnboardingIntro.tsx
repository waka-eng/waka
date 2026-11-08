/**
 * ═══ WHY WAKA — the creature shows it before it asks ═════════════════════
 *
 * Four frames (A–D on the canvas): the pile you never reopen, saving is one
 * tap, I read what you keep, I find your people. Next advances, a swipe
 * advances or goes back, arrow keys do the same. The last frame's control is
 * Start, which is where the questions begin.
 *
 * EACH FRAME IS DRAWN ON ITS OWN 390-WIDE PLATE, in the frame's coordinates,
 * and the plate is scaled down to fit a smaller phone. The scale is OBSERVED
 * (`ResizeObserver`), never read once — Law 6.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

import { t, type SupportedLocale } from "../../lib/locales";
import { Creature, Dots, Glyph } from "./Creature";

const PLATE_W = 390;
const PLATE_H = 752;
const FRAMES = 4;

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

const at = (left: number, top: number, extra: CSSProperties = {}): CSSProperties => ({ left, top, ...extra });

function Pile({ say }: { say: (key: Parameters<typeof t>[1]) => string }) {
  const card = (style: CSSProperties) => ({ ...style, position: "absolute" as const });
  return (
    <>
      <div className="onb-pile-card" style={card({ ["--r" as string]: "-8deg", left: 34, top: 120, width: 120, height: 80, background: "#2a2c33" })}>
        <div className="onb-pile-line" style={{ width: "80%" }} />
        <div className="onb-pile-line" style={{ width: "60%", marginTop: 8 }} />
        <p className="onb-pile-meta" style={{ marginTop: 10 }}>{say("onboardingPileNotes")}</p>
      </div>
      <div className="onb-pile-card" style={card({ ["--r" as string]: "6deg", left: 210, top: 96, width: 132, height: 96, padding: 10, background: "#26303c", animationDuration: "7s", animationDelay: "1s" })}>
        <div style={{ height: 50, borderRadius: 6, background: "#34404e" }} />
        <p className="onb-pile-meta" style={{ marginTop: 8 }}>{say("onboardingPileScreenshot")}</p>
      </div>
      <div className="onb-pile-card" style={card({ ["--r" as string]: "3deg", left: 120, top: 232, width: 150, height: 64, background: "#2b2a30", animationDuration: "5.5s", animationDelay: "0.5s" })}>
        <p>{say("onboardingPileReadLater")}</p>
        <div className="onb-pile-line" style={{ width: "70%", marginTop: 10 }} />
      </div>
      <div className="onb-pile-card" style={card({ ["--r" as string]: "-4deg", left: 22, top: 300, width: 110, height: 60, background: "#2c2a2f", animationDuration: "6.5s", animationDelay: "2s" })}>
        <p>{say("onboardingPileVoiceMemo")}</p>
        <div style={{ height: 14, marginTop: 8, background: "repeating-linear-gradient(90deg,#4a4c53 0 2px,transparent 2px 5px)" }} />
      </div>
      <div className="onb-pile-card" style={card({ ["--r" as string]: "9deg", left: 256, top: 268, width: 104, height: 70, background: "#292d33", animationDuration: "7.5s", animationDelay: "1.5s" })}>
        <p>{say("onboardingPileSavedPost")}</p>
        <div className="onb-pile-line" style={{ width: "70%", marginTop: 10 }} />
      </div>
      <Creature size="small" style={at(157, 430, { position: "absolute" })} />
      <div className="onb-words" style={{ top: 540 }}>
        <h1 className="onb-title">{say("onboardingPileTitle")}</h1>
        <p className="onb-sub">{say("onboardingPileBody")}</p>
      </div>
    </>
  );
}

function OneTap({ say }: { say: (key: Parameters<typeof t>[1]) => string }) {
  const lights: Array<[number, string, string, string]> = [
    [69, "60px", "#f3ebd8", "0s"], [189, "0px", "#f8f2e6", "0.8s"], [309, "-60px", "#efe3c8", "1.6s"],
  ];
  return (
    <>
      <Creature size="large"
        style={at(137, 150, { position: "absolute", transformOrigin: "50% 100%", animation: "onb-catch 2.4s ease-in-out infinite" })} />
      <div className="onb-words" style={{ top: 300 }}>
        <h1 className="onb-title">{say("onboardingTapTitle")}</h1>
        <p className="onb-sub">{say("onboardingTapBody")}</p>
      </div>
      {lights.map(([left, dx, colour, delay]) => (
        <span key={left} className="onb-dot-light" style={{
          left, top: 696, width: 12, height: 12, background: colour, boxShadow: `0 0 18px ${colour}`,
          ["--dx" as string]: dx, animation: `onb-rise 2.4s ease-out ${delay} infinite`,
        }} />
      ))}
      <div className="onb-glyphs" aria-hidden="true">
        <span className="onb-glyph"><Glyph kind="write" /><span>{say("onboardingTapThought")}</span></span>
        <span className="onb-glyph" style={{ animationDelay: "0.8s" }}><Glyph kind="photo" /><span>{say("onboardingTapScreenshot")}</span></span>
        <span className="onb-glyph" style={{ animationDelay: "1.6s" }}><Glyph kind="voice" /><span>{say("onboardingTapVoice")}</span></span>
      </div>
    </>
  );
}

function Reads({ say }: { say: (key: Parameters<typeof t>[1]) => string }) {
  const orbit: Array<[string, number, string, string, string]> = [
    ["92px", 10, "#f3ebd8", "5s", "0s"], ["78px", 9, "#efe3c8", "4s", "-1.3s"],
    ["104px", 8, "#f8f2e6", "6s", "-3s"], ["86px", 9, "#f3ebd8", "4.6s", "-2.2s"],
  ];
  return (
    <>
      <span className="onb-dot-light" style={{ left: 189, top: 196, width: 14, height: 14, background: "#fff7e6",
        boxShadow: "0 0 30px 8px rgba(255,240,210,0.6)", animation: "onb-gather 6s ease-out infinite alternate" }} />
      <div style={{ position: "absolute", left: 190, top: 300, animation: "onb-thin 6s infinite alternate" }}>
        {orbit.map(([d, size, colour, duration, delay]) => (
          <span key={delay} className="onb-dot-light" style={{ width: size, height: size, background: colour, boxShadow: `0 0 14px ${colour}`,
            ["--d" as string]: d, animation: `onb-orbit ${duration} linear ${delay} infinite` }} />
        ))}
      </div>
      <Creature size="large" eyes="closed"
        style={at(137, 262, { position: "absolute", animation: "onb-lift 3s ease-in-out infinite" })} />
      <div className="onb-words" style={{ top: 470 }}>
        <h1 className="onb-title">{say("onboardingReadTitle")}</h1>
        <p className="onb-sub">{say("onboardingReadBody")}</p>
      </div>
    </>
  );
}

function People({ say }: { say: (key: Parameters<typeof t>[1]) => string }) {
  return (
    <>
      <span style={at(66, 300, { position: "absolute", transformOrigin: "50% 100%", animation: "onb-lean 5s ease-in-out infinite alternate" })}>
        <Creature size="medium" bodyClassName="onb-body-glow" />
      </span>
      <span style={at(224, 300, { position: "absolute", animation: "onb-arrive 5s ease-out infinite alternate" })}>
        <span style={{ display: "block", transformOrigin: "50% 100%", animation: "onb-lean-back 5s ease-in-out infinite alternate" }}>
          <Creature size="medium" other bodyClassName="onb-body-glow" />
        </span>
      </span>
      <span className="onb-dot-light" style={{ left: 150, top: 324, width: 12, height: 12, background: "#fff6e4",
        boxShadow: "0 0 22px 4px rgba(255,240,210,0.7)", animation: "onb-pass 5s ease-in-out infinite alternate" }} />
      <div className="onb-words" style={{ top: 470 }}>
        <h1 className="onb-title">{say("onboardingPeopleTitle")}</h1>
        <p className="onb-sub">{say("onboardingPeopleBody")}</p>
      </div>
    </>
  );
}

export function OnboardingIntro({ locale, onDone }: { locale: SupportedLocale; onDone: () => void }): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const [frame, setFrame] = useState(0);
  const { ref, fit } = useFit();
  const start = useRef<{ x: number; y: number } | null>(null);
  const last = frame === FRAMES - 1;
  const next = () => (last ? onDone() : setFrame((value) => Math.min(FRAMES - 1, value + 1)));
  const back = () => setFrame((value) => Math.max(0, value - 1));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") setFrame((value) => Math.min(FRAMES - 1, value + 1));
      if (event.key === "ArrowLeft") setFrame((value) => Math.max(0, value - 1));
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
    if (dx < 0 && !last) next();
    if (dx > 0) back();
  };

  const Frame = [Pile, OneTap, Reads, People][frame]!;
  return (
    <main className={`onb onb-intro ${frame === 0 ? "" : "onb--deep"}`.trim()} onPointerDown={down} onPointerUp={up}
      onPointerCancel={() => { start.current = null; }}>
      <div className="onb-stage">
        <div className="onb-fit" ref={ref}>
          <div key={frame} className="onb-plate onb-plate-enter" style={{ ["--onb-fit" as string]: fit }}>
            <Frame say={say} />
          </div>
        </div>
        <div className="onb-foot">
          <Dots count={FRAMES} on={frame + 1} />
          <button type="button" className="onb-pill-word" onClick={next}>
            {last ? say("onboardingStart") : say("onboardingNext")}
          </button>
        </div>
      </div>
    </main>
  );
}
