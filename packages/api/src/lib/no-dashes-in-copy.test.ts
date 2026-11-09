/**
 * No dashes in the words a person reads.
 *
 * Founder rule (2026-11-08): "never use - in any description texts we have."
 * An em dash, an en dash, or a spaced hyphen standing in for punctuation is
 * rewritten as a period, comma or colon. Hyphenated words are fine.
 *
 * What this pins on the API side:
 *   1. The reading (`the-reading.ts`), both the registered sentences and the
 *      rendered markdown, in both languages.
 *   2. The weather (`the-weather.ts`): every string literal in the file, so
 *      the sentence templates are covered, plus the rendered preamble.
 *   3. Every `error:` / `message:` string literal in an object literal under
 *      `src/routes` and `src/lib` (non-test files). Those are what `c.json`
 *      hands back to the client and what the web app prints as the reason.
 *
 * Model prompts are deliberately out of scope: they are read by the model,
 * never by a person.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { READING_LINES, renderTheReading } from "./the-reading.js";
import { renderTheWeather } from "./the-weather.js";

const DASH = /[—–]| - /;
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("${}");
  }
  return null;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (name.endsWith(".ts") && !/\.(test|spec|smoke)\.ts$/.test(name)) out.push(path);
  }
  return out;
}

describe("no dashes in user-facing API copy", () => {
  it("the reading's sentences carry no dash, in either language", () => {
    for (const line of READING_LINES) {
      expect(line.sentence, line.sentence).not.toMatch(DASH);
      expect(line.sentenceKo, line.sentenceKo).not.toMatch(DASH);
    }
  });

  it("the rendered reading carries no dash outside its list markers", () => {
    for (const locale of ["en-US", "ko-KR"] as const) {
      const prose = renderTheReading(locale)
        .split("\n")
        .map((line) => line.replace(/^- /, ""));
      for (const line of prose) expect(line, line).not.toMatch(DASH);
    }
  });

  it("the weather's rendered preamble carries no dash", () => {
    for (const locale of ["en-US", "ko-KR"] as const) {
      const md = renderTheWeather({ told: null, days: [], antechamber: [] }, locale);
      for (const line of md.split("\n")) expect(line, line).not.toMatch(DASH);
    }
  });

  it("every string literal in the weather carries no dash", () => {
    const sf = parse(join(SRC, "lib/the-weather.ts"));
    const hits: string[] = [];
    const visit = (node: ts.Node): void => {
      const text = literalText(node);
      if (text !== null && DASH.test(text)) hits.push(text);
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(hits).toEqual([]);
  });

  it("every error or message string returned to a client carries no dash", () => {
    const hits: string[] = [];
    let seen = 0;
    for (const file of [...sourceFiles(join(SRC, "routes")), ...sourceFiles(join(SRC, "lib"))]) {
      const sf = parse(file);
      const visit = (node: ts.Node): void => {
        if (
          ts.isPropertyAssignment(node) &&
          (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
          (node.name.text === "error" || node.name.text === "message")
        ) {
          const text = literalText(node.initializer);
          if (text !== null) {
            seen += 1;
            if (DASH.test(text)) hits.push(`${relative(SRC, file)}: ${text}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(seen, "the scan found the error strings it is meant to guard").toBeGreaterThan(20);
    expect(hits).toEqual([]);
  });
});
