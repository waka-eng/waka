/**
 * ═══ ONE QUESTION, ANSWERED IN THE BAR ═══════════════════════════════════
 *
 * The creature asks in its bubble; the answer happens in the bar under it.
 * The bar starts as Write · Photo · Say it. Each opens the same answer in a
 * different hand:
 *
 *   WRITE — the words get the whole width of the bar; mic and Save sit in a
 *   slim row under them (frame 1a).
 *   PHOTO — the image is the hero; a note is optional (frame 1b).
 *   SAY IT — tap to start, tap Done to stop (the frame drew hold-to-talk; an
 *   audit changed it to tap). Where the browser can turn speech into text it
 *   does, live, into the note; where it cannot, the clip is kept as a voice
 *   note and the server writes it out, as the composer already does.
 *
 * EVERY ANSWER IS AN ORDINARY INSPIRATION — `createInspiration`, with a
 * request id held for the whole answer so a retried Save is the same save,
 * and photos/clips uploaded through `uploadInspirationMedia` like the
 * composer's. Nothing here invents a second kind of thing.
 *
 * Bar buttons never fill: dim is disabled, white is pressable.
 */
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { createInspiration, type ApiInspiration, type CreateInspirationRequest } from "../../lib/api";
import { DraftProblem, draftProblem } from "../../lib/draft-problem";
import type { InspirationDraftMedia } from "../../lib/inspiration-draft-store";
import { uploadInspirationMedia } from "../../lib/inspiration-media-upload";
import { inspectInspirationPhoto, PHOTO_ACCEPT } from "../../lib/inspiration-photo";
import { t, type SupportedLocale } from "../../lib/locales";
import type { MessageKey } from "../../lib/i18n";
import { useAudioRecording } from "../../lib/use-audio-recording";
import { dictationAvailable, useDictation } from "../../lib/use-dictation";
import { whyOf } from "../../lib/why-failed";
import { ONBOARDING_QUESTIONS } from "../../lib/onboarding-progress";
import { Dots, Glyph } from "./Creature";
import { CreatureSlot, useCreatureStage } from "./CreatureStage";
import { SayBubble } from "./SayBubble";
import { prefersStillness } from "../../lib/motion";

const QUESTIONS: Array<{ ask: MessageKey; hint: MessageKey }> = [
  { ask: "onboardingAskStuck", hint: "onboardingAskStuckHint" },
  { ask: "onboardingAskConversation", hint: "onboardingAskConversationHint" },
  { ask: "onboardingAskMore", hint: "onboardingAskMoreHint" },
];

type Mode = "choose" | "write" | "photo" | "voice";

/** The handoff's beats (see `receive`). */
const RECEIVE_MS = 500;
/* "Kept": the bubble shrinks to the word (`SayBubble`), then holds while the
   creature's light carries the confirmation. */
const KEPT_MS = 900;
/* Under reduced motion there is no shrink to wait for: the word, then on. */
const STILL_KEPT_MS = 700;
const ASK_MS = 300;
/** How long a screen's staged arrival takes, end to end (see `.onb-arrive`). */
const ARRIVE_MS = 1200;


/** The answer, as it looks on screen, shrinks into the creature and is gone. */
function flyInto(from: HTMLElement | null, to: { x: number; y: number }): void {
  if (!from || typeof from.animate !== "function") return;
  const box = from.getBoundingClientRect();
  if (!box.width) return;
  const ghost = from.cloneNode(true) as HTMLElement;
  ghost.setAttribute("aria-hidden", "true");
  ghost.classList.add("onb-ghost");
  Object.assign(ghost.style, { position: "fixed", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, margin: "0" });
  (from.closest(".onb") ?? document.body).appendChild(ghost);
  const dx = to.x - (box.left + box.width / 2), dy = to.y - (box.top + box.height / 2);
  const flight = ghost.animate([
    { transform: "translate(0, 0) scale(1)", opacity: 1 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.08)`, opacity: 0 },
  ], { duration: RECEIVE_MS, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards" });
  flight.onfinish = () => ghost.remove();
  flight.oncancel = () => ghost.remove();
}

const WAVE = [10, 18, 26, 14, 22, 30, 16, 24, 12, 20, 28, 14, 10];

export function OnboardingQuestion({ locale, index, profileId, calling, onTouched, onSaved, simulate = false }: {
  locale: SupportedLocale;
  /** Dev preview: nothing is uploaded or saved; the answer is handed back as
      though it had been (`lib/onboarding-preview.ts`). */
  simulate?: boolean;
  index: number;
  profileId: string;
  /** The bar glows until the person first touches it. */
  calling: boolean;
  onTouched: () => void;
  onSaved: (saved: ApiInspiration) => void;
}): JSX.Element {
  const say = (key: MessageKey) => t(locale, key);
  const question = QUESTIONS[index] ?? QUESTIONS[0]!;
  const [mode, setMode] = useState<Mode>("choose");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const textRef = useRef(text); textRef.current = text;
  const fileInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  /* One identity per answer: a retried Save is the same save to the server. */
  const requestId = useRef<string>(crypto.randomUUID());
  /* Upload receipts survive a failed save, so a retry does not upload twice. */
  /* KEYED BY THE FILE ITSELF, not by "photo"/"audio": a photo replaced after
     a failed save is a different file and must upload itself, never inherit
     the receipt — and the stored object — of the one it replaced. */
  const uploaded = useRef(new WeakMap<Blob, NonNullable<InspirationDraftMedia["uploaded"]>>());

  /* ═══ THE HANDOFF, after a Save lands (founder: "should have confirmation
     visually somehow the agent received ur input and is asking the next
     question"). Three beats, about a second and a half:
       receive  the answer flies into the creature, which hops and flares —
                the keep it gets at home (`acknowledge`)
       kept     the bubble says "Saved" and the next dot fills
       ask      the bubble cross-fades to the next question, the bar returns
     Nothing can be pressed while it plays. A save that fails never starts
     it: the error is said and the answer stays. Under reduced motion there
     is no flight and no hop — "Saved" for a moment, then the next question. */
  const [handoff, setHandoff] = useState<"receive" | "kept" | "ask" | null>(null);
  const stage = useCreatureStage();
  const bar = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);
  const later = (ms: number, then: () => void) => { timers.current.push(window.setTimeout(then, ms)); };
  /* A new question is a new answer: fresh words, fresh identity. */
  const asked = useRef(index);
  useEffect(() => {
    if (asked.current === index) return;
    asked.current = index;
    setMode("choose"); setText(""); setPhoto(null); setAudio(null); setVoiceOn(false); setError("");
    requestId.current = crypto.randomUUID();
    uploaded.current = new WeakMap();
  }, [index]);

  /* The first time this screen is shown it arrives in stages (the creature
     lands, the bubble grows from its tail, the dots and bar rise last);
     after that, questions follow each other inside it. */
  const [arrived, setArrived] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setArrived(true), ARRIVE_MS); return () => window.clearTimeout(timer); }, []);

  const canDictate = dictationAvailable();
  const dictation = useDictation(() => textRef.current, (words) => setText(words), locale);
  const recording = useAudioRecording((file) => { setAudio(file); });
  const listening = canDictate ? dictation.listening : recording.phase === "recording" || recording.phase === "requesting";
  const finishing = recording.phase === "finishing";

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  useEffect(() => { if (mode === "write") area.current?.focus(); }, [mode]);
  /* THE FIELD GROWS WITH THE WORDS, up to its cap (`max-height` in the sheet),
     so the first line never scrolls out of sight while the second is typed.
     Re-measured on every change of the words it holds. */
  useEffect(() => {
    const node = area.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [text, mode]);
  /* The engine can end on its own after a long silence; the bar follows it. */
  useEffect(() => { if (!listening && mode === "photo") setVoiceOn(false); }, [listening, mode]);

  const touch = () => { onTouched(); setError(""); };
  const startVoice = () => {
    if (canDictate) dictation.start(); else void recording.start();
  };
  const stopVoice = () => {
    if (canDictate) dictation.stop(); else void recording.stop();
  };
  const choose = (next: Mode) => {
    touch();
    if (next === "photo") { fileInput.current?.click(); return; }
    setMode(next);
    if (next === "voice") startVoice();
  };
  const backToChoice = () => {
    if (listening) stopVoice();
    setMode("choose"); setVoiceOn(false); setAudio(null); setError("");
    if (photo) { setPhoto(null); }
  };

  const pickPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const checked = await inspectInspirationPhoto(file);
      setPhoto({ file: checked, url: URL.createObjectURL(checked) });
      setMode("photo");
    } catch (reason) {
      setError(whyOf(reason, locale));
    }
  };

  const hasAnswer = Boolean(text.trim() || photo || audio);
  const canSave = hasAnswer && !saving && !listening && !finishing && !handoff;

  /** The answer has landed: hand it to the creature, then ask the next. */
  const receive = (saved: ApiInspiration) => {
    const still = prefersStillness();
    const target = stage?.center() ?? null;
    if (!still && target) flyInto(photoRef.current ?? bar.current, target);
    setHandoff("receive");
    setMode("choose"); setVoiceOn(false);
    later(still ? 0 : RECEIVE_MS, () => {
      if (!still) stage?.acknowledge();
      setHandoff("kept");
      later(still ? STILL_KEPT_MS : KEPT_MS, () => {
        const more = index + 1 < ONBOARDING_QUESTIONS;
        setHandoff(more ? "ask" : null);
        onSaved(saved);
        if (more) later(ASK_MS, () => setHandoff(null));
      });
    });
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true); setError("");
    const controller = new AbortController();
    if (simulate) {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      const words = text.trim();
      const kind = photo ? (words ? "mixed" : "image") : audio ? (words ? "mixed" : "audio") : "note";
      setSaving(false);
      receive({ id: `preview-${index}`, profileId, text: words, kind, source: "app" } as ApiInspiration);
      return;
    }
    try {
      const media: InspirationDraftMedia[] = [];
      const files = new Map<string, Blob>();
      if (photo) { files.set("photo", photo.file); media.push({ id: "photo", type: "image", ...(photo.file.name ? { name: photo.file.name.slice(0, 255) } : {}), blob: photo.file, uploaded: uploaded.current.get(photo.file) }); }
      if (audio) { files.set("audio", audio); media.push({ id: "audio", type: "audio", name: audio.name, blob: audio, uploaded: uploaded.current.get(audio) }); }
      const sent = await uploadInspirationMedia({
        media, profileId, signal: controller.signal, assertCurrent: () => {}, uploading: () => {},
        persist: async (id, update) => { const file = files.get(id); if (file && update.uploaded) uploaded.current.set(file, update.uploaded); },
      });
      const attachments: NonNullable<CreateInspirationRequest["attachments"]> = sent.map((item) => {
        if (!item.uploaded || item.type === "link" || item.type === "file") throw new DraftProblem("worldComposerNotUploaded");
        return { type: item.type, ...item.uploaded, ...(item.name ? { name: item.name } : {}) };
      });
      const words = text.trim();
      const kind = !attachments.length ? "note" : attachments.length === 1 && !words ? attachments[0]!.type as "image" | "audio" : "mixed";
      const saved = await createInspiration(
        { text: words, kind, source: "app", ...(attachments.length ? { attachments } : {}) },
        { profile: profileId, requestId: requestId.current },
      );
      setSaving(false);
      receive(saved);
    } catch (reason) {
      setError(say(draftProblem(reason, "worldComposerSaveFailed")));
      setSaving(false);
    }
  };

  const voiceProblem = canDictate
    ? dictation.error === "dictation-denied" ? say("worldComposerDictateDenied") : dictation.error === "dictation-failed" ? say("worldComposerDictateFailed") : ""
    : recording.error ? say(recording.error) : "";
  const hint = error || voiceProblem
    || (listening ? (canDictate && dictation.firstTime ? say("worldComposerDictateCloud") : say("onboardingVoiceHintListening")) : "");

  const fileField = (
    <input ref={fileInput} type="file" accept={PHOTO_ACCEPT} hidden onChange={(event) => { void pickPhoto(event); }}
      data-testid="onboarding-photo-input" />
  );

  const listenBar = (
    <div className="onb-pill onb-listen" role="group" aria-label={say(question.ask)}>
      {!listening && !hasAnswer ? (
        <button type="button" className="onb-icon-btn" aria-label={say("onboardingChooseAnother")} onClick={backToChoice}>
          <Glyph kind="close" size={18} />
        </button>
      ) : null}
      <div className={`onb-wave${listening ? " onb-wave--on" : ""}`} role="img" aria-label={listening ? say("onboardingListening") : undefined}
        aria-hidden={listening ? undefined : true}>
        {WAVE.map((height, at) => <span key={at} style={{ height, animationDelay: `${(at % 10) / 10}s` }} />)}
      </div>
      <button type="button" className={`onb-mic${listening ? " onb-mic--on" : ""}`} disabled={finishing}
        aria-label={listening ? undefined : say("onboardingVoiceStart")}
        onClick={() => { touch(); if (listening) { stopVoice(); } else { startVoice(); } }}>
        {listening ? say("onboardingVoiceDone") : <Glyph kind="voice" size={22} />}
      </button>
      <button type="button" className="onb-word-btn" disabled={!canSave} onClick={() => { void save(); }}>{say("onboardingSave")}</button>
    </div>
  );

  const said = text.trim() || listening ? (
    <div className="onb-said">
      <p className="onb-said-label">{say("onboardingYourNote")}</p>
      <p className="onb-said-words">{text}{listening ? <span className="onb-caret" aria-hidden="true" /> : null}</p>
    </div>
  ) : audio ? (
    <div className="onb-said">
      <p className="onb-said-label">{say("onboardingYourVoiceNote")}</p>
      <p className="onb-said-words">{say("onboardingVoiceRecorded")}</p>
    </div>
  ) : null;

  if (mode === "photo" && photo) {
    return (
      <main className="onb">
        <div className="onb-stage onb-ask">
          <div className="onb-ask-dots onb-ask-dots--tight"><Dots count={ONBOARDING_QUESTIONS} on={index + 1} className="onb-dots--center" /></div>
          <div className="onb-photo-head">
            <CreatureSlot size="tiny" glasses />
            <SayBubble say="photo" className="onb-chip"><p>{say("onboardingPhotoAsk")}</p></SayBubble>
          </div>
          <div ref={photoRef} className="onb-photo">
            <img src={photo.url} alt="" />
            <button type="button" className="onb-icon-btn" aria-label={say("onboardingPhotoRemove")} disabled={saving} onClick={backToChoice}>
              <Glyph kind="close" size={18} />
            </button>
          </div>
          {voiceOn || audio ? said : null}
          <div className="onb-grow" />
          {voiceOn ? (
            <>
              {hint ? <p className={error || voiceProblem ? "onb-error" : "onb-hint"} role="status">{hint}</p> : null}
              {listenBar}
            </>
          ) : (
            <>
              <p className={error || voiceProblem ? "onb-error" : "onb-hint"} role="status">{error || voiceProblem || say("onboardingNoteHint")}</p>
              <form className="onb-note" onSubmit={(event) => { event.preventDefault(); void save(); }}>
                <textarea ref={area} rows={1} value={text} placeholder={say("onboardingNotePlaceholder")} aria-label={say("onboardingNotePlaceholder")}
                  disabled={saving} onChange={(event) => setText(event.currentTarget.value)} />
                <div className="onb-note-row">
                  <button type="button" className="onb-icon-btn" aria-label={say("onboardingSayInstead")} disabled={saving}
                    onClick={() => { touch(); setVoiceOn(true); startVoice(); }}>
                    <Glyph kind="voice" />
                  </button>
                  <button type="submit" className="onb-word-btn" disabled={!canSave}>{say("onboardingSave")}</button>
                </div>
              </form>
            </>
          )}
        </div>
        {fileField}
      </main>
    );
  }

  const dotsOn = index + (handoff === "kept" ? 2 : 1);
  const locked = Boolean(handoff);
  return (
    <main className={`onb onb--lift${arrived ? "" : " onb-arrive"}`}>
      <div className="onb-stage onb-ask">
        <div className="onb-ask-dots"><Dots count={ONBOARDING_QUESTIONS} on={dotsOn} className="onb-dots--center" /></div>
        {/* THE ASK SITS AT THE OPTICAL CENTRE of whatever room is left between
            the dots and the bar — centred, then nudged up — so it holds on a
            short phone, a tall one and a desktop window alike. */}
        <div className="onb-center">
          <div className="onb-group">
            {/* THE BUBBLE IS ANCHORED AT ITS TAIL. It sits in a room of its own
                above the creature, held to the room's floor, so when it shrinks
                to "Kept" and grows into the next question it changes size
                upward and outward from the tail — and the creature, whose
                place does not depend on it, never moves. */}
            <div className="onb-ask-room">
              <SayBubble say={handoff === "kept" ? "kept" : `ask-${index}`} className="onb-ask-bubble">
                {handoff === "kept" ? (
                  <p role="status">{say("worldBubbleKept")}</p>
                ) : (
                  <>
                    <h1>{say(question.ask)}</h1>
                    <p className="onb-say-soft">{say(question.hint)}</p>
                  </>
                )}
              </SayBubble>
            </div>
            <div className="onb-tail-gap" />
            <CreatureSlot size="large" glasses={handoff !== "kept"} />
          </div>
        </div>
        {mode === "voice" ? said : null}
        <div ref={bar} className="onb-bar-zone">
        {mode === "choose" ? (
          <>
            {error ? <p className="onb-error" role="alert">{error}</p> : (
              <span className={`onb-share-cue${locked ? " onb-share-cue--quiet" : ""}`}>
                <p className="onb-share-here">{say("onboardingShareHere")}</p>
                <span className="onb-nudge"><Glyph kind="down" size={16} /></span>
              </span>
            )}
            <nav className={`onb-pill onb-choose${calling && !locked ? " onb-choose--call" : ""}`} aria-label={say(question.ask)}>
              {/* THE HOME BAR'S PILL, so the bar you learn here is the bar
                  you meet at home: "Keep a thought…", then a picture and a mic. */}
              <button type="button" className="onb-choice onb-choice--field" disabled={locked} aria-label={say("worldBarKeepThought")} onClick={() => choose("write")}><span>{say("worldBarThoughtPrompt")}</span></button>
              <button type="button" className="onb-choice onb-choice--glyph" disabled={locked} aria-label={say("worldBarKeepScreenshot")} title={say("worldBarKeepScreenshot")} onClick={() => choose("photo")}><Glyph kind="photo" /></button>
              <button type="button" className="onb-choice onb-choice--glyph" disabled={locked} aria-label={say("worldBarKeepVoice")} title={say("worldBarKeepVoice")} onClick={() => choose("voice")}><Glyph kind="voice" /></button>
            </nav>
          </>
        ) : mode === "write" ? (
          <>
            {error ? <p className="onb-error" role="alert">{error}</p> : null}
            <form className="onb-note" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <textarea ref={area} rows={2} value={text} placeholder={say("onboardingWritePlaceholder")} aria-label={say(question.ask)}
                disabled={saving} onChange={(event) => setText(event.currentTarget.value)} />
              <div className="onb-note-row">
                <span className="onb-note-tools">
                  {!text.trim() ? (
                    <button type="button" className="onb-icon-btn" aria-label={say("onboardingChooseAnother")} onClick={backToChoice}>
                      <Glyph kind="close" size={18} />
                    </button>
                  ) : null}
                  <button type="button" className="onb-icon-btn" aria-label={say("onboardingSayInstead")} disabled={saving}
                    onClick={() => { touch(); setMode("voice"); startVoice(); }}>
                    <Glyph kind="voice" />
                  </button>
                </span>
                <button type="submit" className="onb-word-btn" disabled={!canSave}>{say("onboardingSave")}</button>
              </div>
            </form>
          </>
        ) : (
          <>
            {hint || !hasAnswer ? (
              <p className={error || voiceProblem ? "onb-error" : "onb-hint"} role="status">
                {hint || say("onboardingVoiceHintIdle")}
              </p>
            ) : null}
            {listenBar}
          </>
        )}
        </div>
      </div>
      {fileField}
    </main>
  );
}
