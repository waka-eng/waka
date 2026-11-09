/**
 * /onboarding — the one thing WAKA needs before it can address you.
 *
 * WHAT A CRAFT PASS FOUND HERE, because this page had never had one.
 *
 * NO WAY OUT (Law 2, `docs/six-laws.md`). This route sits behind `RequireAuth`
 * and behind NOTHING ELSE — there is no check anywhere that the person has not
 * already finished onboarding. So a signed-in person who types `/onboarding`,
 * or follows an old link, lands on a form with one field, one submit, and no
 * control of any kind that leaves. Founder: "after I click on it, I feel like
 * I'm lost how to go back to the previous screen." This is that, in its purest
 * form, on the one surface where it is reached by accident rather than on
 * purpose.
 *
 * ═══ AND SINCE 2026-11 IT IS THE FIRST OF FIVE STEPS ════════════════════
 *
 * The name and language, then four intro frames, then three questions whose
 * answers are ordinary saves, then the first read across them, then home.
 * Mandatory, resumable (`lib/onboarding-progress.ts`), and stamped complete
 * only after the third save. The flow lives in `components/onboarding/`.
 *
 * The exit says two different true things depending on who is standing here,
 * and that is the whole reason it is not one button:
 *
 *   ALREADY SET UP — `account.onboardingCompletedAt` is written. Nothing is
 *   being asked of this person; they are here by address. The way out is the
 *   world, which is where they were.
 *
 *   NOT SET UP YET — there is no world to go back to, because they have not
 *   finished arriving. The only honest exit is to leave the account, and
 *   saying so beats a control that pretends there is somewhere else to be.
 *   Law 1: a control names exactly what it does.
 *
 * THE LANGUAGE FIELD IS BACK, and its absence was Law 3 rather than a choice.
 * The comment that stood here cited the founder's 2026-08-22 ruling that the
 * product speaks English only — which was REVERSED on 2026-08-31, and the
 * reversal landed on `Login`'s signup form with its own note: "the choice
 * drives what language the memory itself is written in — signals, the top of
 * mind, principles — so it belongs at the door, before the first keep."
 *
 * It landed on ONE door. This is the other one, and it is the only door a
 * person who signs in with Google ever passes through — they never see the
 * signup form, so until now they could not choose the language their memory
 * is written in at all, and the first thing WAKA wrote for them was written in
 * a guess. The plumbing was already here: `preferredLocale` was held in state
 * and sent to `updateProfile` with nothing on screen able to change it. The
 * page's own subtitle has been promising this field the whole time — "Choose
 * the name and language WAKA should use with you."
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { createConversation } from "../lib/api/conversations";
import { ApiError, fetchInspirationPage, fetchInspirationSnapshot, type ApiInspiration } from "../lib/api";
import { Companion } from "../components/Companion";
import { CreatureStage } from "../components/onboarding/CreatureStage";
import { OnboardingIntro } from "../components/onboarding/OnboardingIntro";
import { OnboardingQuestion } from "../components/onboarding/OnboardingQuestion";
import { OnboardingReading, OnboardingReveal } from "../components/onboarding/OnboardingRead";
import { attachmentLabel } from "../lib/attachment-label";
import { useAuth } from "../lib/auth-context";
import { requestFirstRead, withinBudget } from "../lib/first-read";
import {
  normalizeSupportedLocale,
  readStoredLocale,
  supportedLocales,
  t,
  writeStoredLocale,
} from "../lib/locales";
import type { SupportedLocale } from "../lib/locales";
import {
  clearOnboardingMarker,
  clearOnboardingExit,
  leaveOnboardingFor,
  ONBOARDING_QUESTIONS,
  onboardingStep,
  readOnboardingMarker,
  writeOnboardingMarker,
  type OnboardingStep,
} from "../lib/onboarding-progress";
import { onboardingPreviewRequested } from "../lib/onboarding-preview";
import { safeInAppPath } from '../lib/sign-in-destination';
import "../styles/onboarding.css";

function safeRedirect(from: unknown): string {
  return safeInAppPath(from) ?? '/';
}

/** How long the reading screen waits before letting the person in anyway. */
export const FIRST_READ_PATIENCE_MS = 20_000;
/** The fade from the last onboarding screen into home. */
const LEAVE_FADE_MS = 250;

/** One line per answer, for "Why?": its words, else what it is. */
function lineOf(locale: SupportedLocale, words: string, attachment?: "image" | "audio" | "file" | "link" | null): string {
  const first = words.trim().split("\n")[0]?.trim() ?? "";
  if (first) return first.length > 140 ? `${first.slice(0, 139)}…` : first;
  return attachment ? attachmentLabel(locale, attachment) : "";
}

type Phase =
  | { kind: "loading" }
  | { kind: "unreachable" }
  | OnboardingStep
  | { kind: "reveal"; reading: string };

export default function OnboardingPage(): JSX.Element {
  const { account, profile, updateProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: unknown } | null;
  const locale = normalizeSupportedLocale(profile?.preferredLocale ?? readStoredLocale());
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [calling, setCalling] = useState(true);
  const [answers, setAnswers] = useState<Array<{ id: string; line: string }>>([]);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const accountId = account?.id ?? null;
  const profileId = profile?.id ?? null;
  /* DEV ONLY: `?preview=1` walks the flow without saving or stamping anything. */
  const preview = onboardingPreviewRequested(location.search);

  /* WHERE THIS PERSON IS — the server's count of their saves, and the two
     marks this browser keeps. See `lib/onboarding-progress.ts`. */
  useEffect(() => {
    if (!profileId || !accountId) return;
    if (preview) { setPhase({ kind: "intro" }); return; }
    const controller = new AbortController();
    setPhase({ kind: "loading" });
    fetchInspirationSnapshot(profileId, controller.signal).then((snapshot) => {
      if (controller.signal.aborted) return;
      setPhase(onboardingStep({ saved: snapshot.total, marker: readOnboardingMarker(accountId), hasName: Boolean(profile?.name.trim()) }));
    }, () => { if (!controller.signal.aborted) setPhase({ kind: "unreachable" }); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, accountId, attempt]);

  /* LEAVING, and the one place onboarding is stamped done. The stamp and the
     move happen together, so the route guard never sees a finished account
     standing on /onboarding. */
  /* INTO HOME, A FADE. Home's creature is drawn by the world at a place this
     page cannot know in advance, so the creature does not try to hop there;
     the whole scene fades and home is simply under it. */
  const [fading, setFading] = useState(false);
  const fadeOut = () => new Promise<void>((resolve) => {
    setFading(true);
    window.setTimeout(resolve, LEAVE_FADE_MS);
  });

  /* Where onboarding was going is forgotten once onboarding is gone. */
  useEffect(() => () => clearOnboardingExit(), []);

  const finish = useCallback(async (destination: string) => {
    if (!profile) return;
    /* A preview stamps nothing: it returns home exactly as it found the account. */
    if (preview) { await fadeOut(); navigate("/", { replace: true }); return; }
    setLeaving(true); setLeaveError("");
    /* The fade comes FIRST: the moment onboarding is stamped, the route guard
       sends a finished account away from /onboarding, so the stamp and the
       move have to land together. A stamp that fails brings the scene back. */
    await fadeOut();
    leaveOnboardingFor(destination);
    try {
      await updateProfile({ name: profile.name, preferredLocale: normalizeSupportedLocale(profile.preferredLocale), completeOnboarding: true });
      clearOnboardingMarker(accountId);
      navigate(destination, { replace: true });
    } catch (reason) {
      clearOnboardingExit();
      setFading(false);
      setLeaveError(reason instanceof ApiError ? reason.message : say("profileSaveError"));
      setLeaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, accountId, navigate, updateProfile, locale, preview]);

  /* THE READ. Asked once the three are in, raced against the screen's
     patience; past it, the person goes in and home shows the read when it
     lands (founder decision, onboarding canvas question 2). */
  useEffect(() => {
    if (phase.kind !== "reading" || !profileId) return;
    let live = true;
    if (preview) {
      const timer = window.setTimeout(() => { if (live) setPhase({ kind: "reveal", reading: say("onboardingPreviewRead") }); }, 2500);
      return () => { live = false; window.clearTimeout(timer); };
    }
    void (async () => {
      let known = answers;
      if (known.length < ONBOARDING_QUESTIONS) {
        try {
          const page = await fetchInspirationPage({ profile: profileId, limit: ONBOARDING_QUESTIONS });
          known = page.inspirations.slice(0, ONBOARDING_QUESTIONS).reverse().map((row) => ({
            id: row.id, line: lineOf(locale, row.textPreview, row.attachmentSummary?.[0]?.type ?? null),
          }));
          if (live) setAnswers(known);
        } catch { known = []; }
      }
      const reading = await withinBudget(requestFirstRead(profileId, known.map((row) => row.id)), FIRST_READ_PATIENCE_MS);
      if (!live) return;
      if (reading) setPhase({ kind: "reveal", reading });
      else void finish(safeRedirect(state?.from));
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind, profileId]);

  const saved = (index: number) => (inspiration: ApiInspiration) => {
    const attachment = inspiration.attachments?.[0]?.type
      ?? (inspiration.kind === "image" || inspiration.kind === "audio" ? inspiration.kind : null);
    setAnswers((rows) => [...rows.filter((row) => row.id !== inspiration.id), { id: inspiration.id, line: lineOf(locale, inspiration.text, attachment) }]);
    setPhase(index + 1 >= ONBOARDING_QUESTIONS ? { kind: "reading" } : { kind: "question", index: index + 1 });
  };

  /* ONE CONVERSATION, HOWEVER MANY PRESSES. The conversation is opened before
     onboarding is stamped done; if the stamp fails and the person presses
     again, the same conversation (same ids) is reused rather than a second
     one opened with a second generated reply. */
  const talking = useRef<{ id: string; messageId: string; opened: boolean } | null>(null);
  const talk = async (reading: string) => {
    if (!profileId) return;
    if (preview) { await fadeOut(); navigate("/", { replace: true }); return; }
    setLeaving(true); setLeaveError("");
    const conversation = talking.current ?? (talking.current = { id: crypto.randomUUID(), messageId: crypto.randomUUID(), opened: false });
    if (!conversation.opened) {
      try {
        await createConversation(profileId, conversation.id, undefined, undefined, { id: conversation.messageId, content: reading, requestReply: true });
        conversation.opened = true;
      } catch {
        setLeaveError(say("worldTalkFailed")); setLeaving(false); return;
      }
    }
    await finish(`/chat/${encodeURIComponent(conversation.id)}`);
  };

  const marker = preview ? <p className="onb-preview-mark" aria-label={say("onboardingPreviewMarkLabel")}>{say("onboardingPreviewMark")}</p> : null;
  /* ONE CREATURE FOR EVERY STEP (`CreatureStage`): the stage stays mounted
     while the steps under it change, so the creature hops from one to the
     next instead of each step drawing its own. */
  return <CreatureStage fading={fading}>{renderStep()}{marker}</CreatureStage>;

  function renderStep(): JSX.Element {
  if (phase.kind === "name") {
    /* FROM WHAT JUST HAPPENED, NOT FROM STORAGE. The marker is only a hint for
       coming back; a browser that keeps nothing (private mode, blocked site
       data) would read "not named" straight back and ask the name forever —
       and onboarding is mandatory, so that is a person stuck at the door. */
    return <NameStep onNamed={() => setPhase(onboardingStep({ saved: 0, marker: { ...readOnboardingMarker(accountId), named: true }, hasName: true }))} />;
  }
  if (phase.kind === "intro") {
    return <OnboardingIntro locale={locale} onDone={() => { if (!preview) writeOnboardingMarker(accountId, { introSeen: true }); setPhase({ kind: "question", index: 0 }); }} />;
  }
  if (phase.kind === "question" && profileId) {
    return <OnboardingQuestion locale={locale} index={phase.index} profileId={profileId}
      calling={calling} onTouched={() => setCalling(false)} onSaved={saved(phase.index)} simulate={preview} />;
  }
  if (phase.kind === "reading") {
    return <OnboardingReading locale={locale} error={leaveError} busy={leaving}
      onContinue={() => { void finish(safeRedirect(state?.from)); }} />;
  }
  if (phase.kind === "reveal") {
    return <OnboardingReveal locale={locale} reading={phase.reading} behind={answers.map((row) => row.line).filter(Boolean)}
      busy={leaving} error={leaveError} onTalk={() => { void talk(phase.reading); }}
      onContinue={() => { void finish(safeRedirect(state?.from)); }} />;
  }
  return (
    <main className="onb">
      <div className="onb-stage onb-wait">
        <Companion size={88} />
        {phase.kind === "unreachable" ? (
          <>
            <p className="onb-hint" role="alert">{say("onboardingLoadFailed")}</p>
            <button type="button" className="onb-go" onClick={() => setAttempt((value) => value + 1)}>{say("worldRetry")}</button>
          </>
        ) : null}
      </div>
    </main>
  );
  }
}

function NameStep({ onNamed }: { onNamed: () => void }): JSX.Element {
  const { account, profile, logout, updateProfile } = useAuth();
  const [name, setName] = useState(profile?.name ?? "");
  const [preferredLocale, setPreferredLocale] = useState<SupportedLocale>(() =>
    normalizeSupportedLocale(profile?.preferredLocale ?? readStoredLocale()),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const locale = preferredLocale;
  /* Written already, so this person is not being asked anything — see the
     note at the top of the file on which exit they are owed. */
  const alreadySetUp = Boolean(account?.onboardingCompletedAt);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const displayName = name.trim();
    if (!displayName) {
      setError(t(locale, "profileNicknameRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      /* NOT `completeOnboarding` any more: the three answers are still to
         come, and onboarding is stamped only once they exist. */
      await updateProfile({ name: displayName, preferredLocale });
      writeStoredLocale(preferredLocale);
      writeOnboardingMarker(account?.id, { named: true });
      onNamed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t(locale, "profileSaveError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="onboarding-title">
        {/* THE SAME COMPANION THE DOOR HAS. These two screens are one
            sequence — you sign up and land here — and the creature
            appearing on the first and not the second would read as the
            product losing interest the moment you are through. See the
            long note at the same line in `Login.tsx`. */}
        <Companion size={88} />
        <p className="login-eyebrow">{t(locale, "onboardingEyebrow")}</p>
        <h1 id="onboarding-title" className="login-title">
          {t(locale, "onboardingTitle")}
        </h1>
        <p className="login-subtitle">{t(locale, "onboardingSubtitle")}</p>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span className="field-label">{t(locale, "profileNickname")}</span>
            <input
              className="field-input"
              type="text"
              name="name"
              autoComplete="name"
              value={name}
              disabled={submitting}
              required
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          {/* The language the memory itself gets written in — see the note at
              the top of the file for why it is here and why it was not.
              It changes the page under the hand that changed it: `locale` IS
              this value, so the labels, the subtitle and the submit all speak
              the choice immediately. A language control that leaves the screen
              it is on in the old language is a control you have to trust
              rather than see. */}
          <label className="field">
            <span className="field-label">{t(locale, "profileLanguageLabel")}</span>
            <select
              className="field-input"
              name="preferredLocale"
              value={preferredLocale}
              disabled={submitting}
              onChange={(event) =>
                setPreferredLocale(event.currentTarget.value as SupportedLocale)
              }
            >
              {supportedLocales.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.nativeLabel}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-primary btn-doorway" type="submit" disabled={submitting}>
            {submitting ? t(locale, "profileSaving") : t(locale, "onboardingContinue")}
          </button>
        </form>
        {/* THE WAY OUT, one press, named for what it actually does. */}
        <p className="login-footer">
          {alreadySetUp ? (
            <Link className="login-link" to="/">
              {t(locale, "profileBackHome")}
            </Link>
          ) : (
            <button
              type="button"
              className="login-link"
              disabled={submitting}
              onClick={() => {
                void logout();
              }}
            >
              {t(locale, "signOut")}
            </button>
          )}
        </p>
      </section>
    </main>
  );
}
