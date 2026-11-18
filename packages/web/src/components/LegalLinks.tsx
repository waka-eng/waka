export const legalPaths = {
  terms: "/legal/terms",
  privacy: "/legal/privacy",
} as const;

export function LegalLinks({ current }: { current?: keyof typeof legalPaths }) {
  return (
    <nav className="waka-legal-links" aria-label="Legal" lang="en">
      <a href={legalPaths.terms} aria-current={current === "terms" ? "page" : undefined}>Terms of Service</a>
      <a href={legalPaths.privacy} aria-current={current === "privacy" ? "page" : undefined}>Privacy Policy</a>
    </nav>
  );
}
