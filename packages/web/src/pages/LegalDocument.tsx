import { Fragment, useEffect, type ReactNode } from "react";
import { LegalLinks, legalPaths } from "../components/LegalLinks";
import terms from "./legal/terms-of-service.md?raw";
import privacy from "./legal/privacy-policy.md?raw";

const drafts = { terms, privacy };

function renderText(text: string): ReactNode {
  const pieces: ReactNode[] = [];
  let start = 0;
  for (const link of text.matchAll(/\[([^\]\n]+)\]\(([^\s()]+)\)/g)) {
    const [literal, label, href] = link;
    const safe = href === legalPaths.terms || href === legalPaths.privacy || /^(https:\/\/|mailto:)/.test(href);
    pieces.push(text.slice(start, link.index), safe ? <a key={link.index} href={href}>{label}</a> : literal);
    start = link.index + literal.length;
  }
  return <>{pieces}{text.slice(start)}</>;
}

// These bundled drafts use headings, paragraphs and flat lists. All document
// text stays in React text nodes instead of being interpreted as HTML.
function renderBlock(block: string) {
  if (block.startsWith("## ")) return <h2>{renderText(block.slice(3))}</h2>;
  if (block.startsWith("### ")) return <h3>{renderText(block.slice(4))}</h3>;
  const lines = block.split("\n");
  if (lines.every(line => line.startsWith("- "))) {
    return <ul>{lines.map((line, index) => <li key={index}>{renderText(line.slice(2))}</li>)}</ul>;
  }
  return <p>{renderText(lines.join(" "))}</p>;
}

export default function LegalDocument({ document: kind }: { document: keyof typeof legalPaths }) {
  const [titleLine, ...blocks] = drafts[kind].trim().replace(/\r\n/g, "\n").split(/\n[ \t]*\n/);
  const title = titleLine.replace(/^# /, "");
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · WAKA`;
    return () => { document.title = previous; };
  }, [title]);

  return (
    <main className="waka-legal-page" lang="en">
      <div className="waka-legal-column">
        <a href="/" className="waka-legal-home">WAKA</a>
        <article aria-labelledby="legal-title">
          <p className="waka-legal-status">Draft for review</p>
          <h1 id="legal-title">{title}</h1>
          {blocks.map((block, index) => <Fragment key={index}>{renderBlock(block)}</Fragment>)}
        </article>
        <LegalLinks current={kind} />
      </div>
    </main>
  );
}
