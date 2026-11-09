import { t, type SupportedLocale } from "../lib/locales";
import { SurfaceHeader } from "./SurfaceHeader";

// Explain the actions in the order a new user encounters them.
const STEPS = [
  { title: "worldHowSaveTitle", body: "worldHowSaveBody" },
  { title: "worldHowNoticeTitle", body: "worldHowNoticeBody" },
  { title: "worldHowRefineTitle", body: "worldHowRefineBody" },
] as const;

export function HowItWorksPanel({ locale, onClose }: { locale: SupportedLocale; onClose: () => void }): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  return (
    <div className="waka-about" role="group" aria-label={say("worldHowItWorksTitle")}>
      <SurfaceHeader locale={locale} back={{ kind: "close", onBack: onClose }} title={say("worldHowItWorksTitle")} />
      <div className="waka-about-content">
      <p className="waka-about-lead">{say("worldHowItWorksLead")}</p>
      <ol className="waka-about-steps">
        {STEPS.map(step => <li key={step.title}>
          <h3>{say(step.title)}</h3>
          <p>{say(step.body)}</p>
        </li>)}
      </ol>
      <dl className="waka-about-details">
        <div><dt>{say("worldHowPrinciplesTitle")}</dt><dd>{say("worldHowPrinciplesBody")}</dd></div>
        <div><dt>{say("worldHowProfilesTitle")}</dt><dd>{say("worldHowProfilesBody")}</dd></div>
      </dl>
      </div>
    </div>
  );
}
