import { useId } from "react";
import { t, type SupportedLocale } from "../lib/locales";

// Explain the actions in the order a new user encounters them.
const STEPS = [
  { title: "worldHowSaveTitle", body: "worldHowSaveBody" },
  { title: "worldHowNoticeTitle", body: "worldHowNoticeBody" },
  { title: "worldHowRefineTitle", body: "worldHowRefineBody" },
] as const;

export function HowItWorksPanel({ locale }: { locale: SupportedLocale }): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const titleId = useId();
  return (
    <div className="waka-about" role="group" aria-labelledby={titleId}>
      <h2 className="waka-about-title" id={titleId}>{say("worldHowItWorksTitle")}</h2>
      <div className="waka-about-content">
      <p className="waka-about-lead">{say("worldHowItWorksLead")}</p>
      <ol className="waka-about-steps">
        {STEPS.map(step => <li key={step.title}>
          <h3>{say(step.title)}</h3>
          <p>{say(step.body)}</p>
        </li>)}
      </ol>
      <dl className="waka-about-details">
        <div><dt>{say("worldHowReviewTitle")}</dt><dd>{say("worldHowReviewBody")}</dd></div>
        <div><dt>{say("worldHowPrinciplesTitle")}</dt><dd>{say("worldHowPrinciplesBody")}</dd></div>
        <div><dt>{say("worldHowProfilesTitle")}</dt><dd>{say("worldHowProfilesBody")}</dd></div>
      </dl>
      </div>
    </div>
  );
}
