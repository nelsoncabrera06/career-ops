// tests/extension-bundle-sync.test.mjs — two properties of extension/ that a
// reviewer cannot see in a diff.
//
// 1. The content script's copy of the page-side extractor must match
//    web/src/lib/apply/extract-dom.mjs. The extension cannot import from outside
//    its own directory, so the file is copied; without this guard the copy
//    quietly ages and the panel starts reading forms differently than the
//    dashboard's apply flow does. Same "one definition" rule as
//    tests/web-test-layout.test.mjs, applied to a generated file.
//
// 2. Nothing that ships in the extension may submit a form. "Fills in and
//    previews; a human presses send" is a hard rule of this project, and the
//    extension is the one surface that runs inside the page where the button
//    lives — so the refusal is asserted over the source, not trusted.
import { pass, fail, ROOT } from "./helpers.mjs";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { toClassicScript } from "../extension/scripts/build.mjs";

console.log("\nextension/ bundle sync + no-submit guarantee");

/** Comments are stripped so a note explaining WHY we never submit is not a finding. */
function codeOnly(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SOURCE = join(ROOT, "web", "src", "lib", "apply", "extract-dom.mjs");
const TARGET = join(ROOT, "extension", "content", "extract-dom.js");

if (!existsSync(TARGET)) {
  fail("extension/content/extract-dom.js is missing — run: node extension/scripts/build.mjs");
} else {
  const expected = toClassicScript(readFileSync(SOURCE, "utf8"));
  const actual = readFileSync(TARGET, "utf8");
  actual === expected
    ? pass("the extension's generated extractor matches web/src/lib/apply/extract-dom.mjs")
    : fail("extension/content/extract-dom.js is STALE — run: node extension/scripts/build.mjs");

  // A content script is a classic script: a stray `export` is a SyntaxError that
  // shows up as "the panel does nothing", not as a build error.
  /^\s*export\s/m.test(actual)
    ? fail("the generated content script still contains ESM `export` syntax")
    : pass("the generated content script is classic-script only (no export statements)");
}

// The runtime files — everything that executes inside the browser.
const RUNTIME = ["background.js", "content/content.js", "sidepanel.js"];
// The three ways to send an application from script. None may appear.
const FORBIDDEN = [
  { re: /\.requestSubmit\s*\(/, why: "requestSubmit()" },
  { re: /\.submit\s*\(\s*\)/, why: ".submit()" },
  { re: /type\s*=\s*["']submit["']/, why: "a created submit button" },
];

for (const rel of RUNTIME) {
  const path = join(ROOT, "extension", rel);
  if (!existsSync(path)) {
    fail(`extension/${rel} is missing — the extension is incomplete`);
    continue;
  }
  const code = codeOnly(readFileSync(path, "utf8"));
  const hits = FORBIDDEN.filter((f) => f.re.test(code)).map((f) => f.why);
  hits.length === 0
    ? pass(`extension/${rel} cannot submit the form (no submit call)`)
    : fail(`extension/${rel} contains a submit path: ${hits.join(", ")}`);
}

// The content script must not talk to the network: everything it needs arrives
// in the message. A fetch here would be the extension's own model call, which
// would put answers outside the local app's fences.
{
  const code = codeOnly(readFileSync(join(ROOT, "extension", "content", "content.js"), "utf8"));
  /\bfetch\s*\(|XMLHttpRequest/.test(code)
    ? fail("extension/content/content.js makes network requests — it must only relay messages")
    : pass("the page-side script is offline (no fetch / XMLHttpRequest)");
}
