import { t, type SupportedLocale } from "../lib/locales";

export const legalPaths = {
  terms: "/legal/terms",
  privacy: "/legal/privacy",
} as const;

export function LegalLinks({ current, locale }: { current?: keyof typeof legalPaths; locale: SupportedLocale }) {
  return (
    <nav className="waka-legal-links" aria-label={t(locale, "legalNavigationLabel")} lang={locale}>
      <a href={legalPaths.terms} aria-current={current === "terms" ? "page" : undefined}>{t(locale, "legalTermsLink")}</a>
      <a href={legalPaths.privacy} aria-current={current === "privacy" ? "page" : undefined}>{t(locale, "legalPrivacyLink")}</a>
    </nav>
  );
}
