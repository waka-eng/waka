import { readFileSync, writeFileSync } from "node:fs";
const [, , file, from, to] = process.argv;
const src = readFileSync(file, "utf8");
// mask comments and strings so only CODE tokens are considered
const mask = Array.from(src);
const blank = (a, b) => { for (let i = a; i < b && i < mask.length; i++) if (mask[i] !== "\n") mask[i] = " "; };
let i = 0;
while (i < src.length) {
  const two = src.slice(i, i + 2);
  if (two === "//") { const e = src.indexOf("\n", i); blank(i, e === -1 ? src.length : e); i = e === -1 ? src.length : e; continue; }
  if (two === "/*") { const e = src.indexOf("*/", i + 2); blank(i, e === -1 ? src.length : e + 2); i = e === -1 ? src.length : e + 2; continue; }
  const c = src[i];
  if (c === '"' || c === "'" || c === "`") {
    let j = i + 1;
    while (j < src.length) { if (src[j] === "\\") { j += 2; continue; } if (src[j] === c) break; j++; }
    blank(i + 1, j); i = j + 1; continue;
  }
  i++;
}
const masked = mask.join("");
const re = new RegExp(`(?<![A-Za-z0-9_$.])${from}(?![A-Za-z0-9_$])`, "g");
let out = src, delta = 0, n = 0;
for (const m of masked.matchAll(re)) {
  const at = m.index + delta;
  out = out.slice(0, at) + to + out.slice(at + from.length);
  delta += to.length - from.length; n++;
}
writeFileSync(file, out);
console.log(`${file}: ${n} code occurrence(s) of ${from} -> ${to}`);
