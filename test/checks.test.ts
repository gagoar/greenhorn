import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CHECK_IDS } from "../scripts/checks.ts";
import { definitions, parse } from "../scripts/document.ts";
import { configFile, json, read, ROOT } from "./helpers.ts";

// Fixture convention: testdata/rules/<id>.pass.md and <id>.fail.md run with no argument. A check that needs options may add
// <id>.args.json, an array of CLI arguments (an argument that names a file in testdata/rules, such as "<id>.original.md", is
// resolved to its full path), and files such as <id>.original.md. The args file applies to both the pass and the fail fixture.
const RULES_DIR = join("testdata", "rules");
const rule = (id: string, kind: "pass" | "fail"): string => join(RULES_DIR, `${id}.${kind}.md`);

// The CLI arguments of a check's fixtures: the content of <id>.args.json, with each file name resolved against the rules folder.
export function fixtureArgs(id: string, dir: string = join(ROOT, RULES_DIR)): readonly string[] {
  const path = join(dir, `${id}.args.json`);
  if (!existsSync(path)) return [];
  const args: readonly string[] = JSON.parse(readFileSync(path, "utf8"));
  return args.map((arg) => (existsSync(join(dir, arg)) ? join(dir, arg) : arg));
}

const CIRCULAR = "circular-definition";
const NO_EXAMPLE = "no-example";
const TOO_MANY = "too-many-terms";
const CONFIG = "--config";
const UNDEFINED_TERM = "undefined-repeated-term";
const ORIGINAL = "x.original.md";
const HARD_IDS = [CIRCULAR, NO_EXAMPLE];
const MIN_CHECKS = 8;
const TERM_LIMIT = 1;
const FILE_TERMS = 4;
const TWO_USES = 2;
const DEFAULT_MAX_TERMS = 5;
const DEFAULT_THRESHOLD = 3;
const DEFAULT_WORDS = 25;

const count = (id: string, text: string, args: readonly string[] = []): number => json(args, text).findings.filter((finding) => finding.check === id).length;

test("every check has a pass fixture and a fail fixture", () => {
  assert.ok(CHECK_IDS.length >= MIN_CHECKS);
  CHECK_IDS.forEach((id) => {
    assert.ok(existsSync(join(ROOT, rule(id, "pass"))), `testdata/rules/${id}.pass.md is missing`);
    assert.ok(existsSync(join(ROOT, rule(id, "fail"))), `testdata/rules/${id}.fail.md is missing`);
  });
});

test("a pass fixture gives no finding for its check, and a fail fixture gives at least one", () => {
  CHECK_IDS.forEach((id) => {
    const args = fixtureArgs(id);
    assert.equal(count(id, read(rule(id, "pass")), args), 0, `${id}.pass.md`);
    assert.ok(count(id, read(rule(id, "fail")), args) >= 1, `${id}.fail.md`);
  });
});

test("only the circular definition and the missing example are hard", () => {
  const hard = CHECK_IDS.filter((id) => json([], read(rule(id, "fail"))).findings.some((finding) => finding.check === id && finding.level === "hard"));
  assert.deepEqual(hard.sort(), [...HARD_IDS].sort());
});

test("a definition that uses its own term is circular", () => {
  assert.equal(count(CIRCULAR, "A **loop** is a thing that makes a loop.\n"), 1);
});

test("a definition may use a term that an earlier line defines", () => {
  assert.equal(count(CIRCULAR, "A **cache** is a store that holds data.\nA **TTL** is a limit that tells a cache when to stop.\n"), 0);
});

const EXAMPLES: readonly (readonly [name: string, text: string])[] = [
  ["a code block", "A tag is a label.\n\n```\ngit tag v1\n```\n"],
  ["a line that starts with e.g.", "A tag is a label.\n- e.g. v1.2.0\n"],
  ["an Example line", "A tag is a label.\n**Example**: v1.2.0\n"],
  ["a Before and After pair", "Before\nold text\nAfter\nnew text\n"],
  ["a Before and After table header", "| Before | After |\n|---|---|\n| a | b |\n"],
];

test("each kind of example satisfies no-example", () => {
  EXAMPLES.forEach(([name, text]) => assert.equal(count(NO_EXAMPLE, text), 0, name));
});

test("After with no Before is not a pair, and a word that starts with Example is not a marker", () => {
  assert.equal(count(NO_EXAMPLE, "After the build, the tag is set.\n"), 1);
  assert.equal(count(NO_EXAMPLE, "Examples are hard to write.\n"), 1);
});

test("a code block inside a fence hides its text from the prose checks", () => {
  const text = "```\nA **loop** is a thing that makes a loop.\n```\n";
  assert.equal(count(CIRCULAR, text), 0);
});

test("a config limit changes the result", () => {
  const terms = read(rule(TOO_MANY, "pass"));
  const strict = configFile({ limits: { maxTerms: TERM_LIMIT } });
  assert.equal(count(TOO_MANY, terms), 0);
  assert.equal(count(TOO_MANY, terms, [CONFIG, strict]), TERM_LIMIT);
  const lenient = configFile({ limits: { requireExample: false } });
  assert.equal(count(NO_EXAMPLE, read(rule(NO_EXAMPLE, "fail")), [CONFIG, lenient]), 0);
  const threshold = configFile({ limits: { glossaryThreshold: TWO_USES } });
  assert.equal(count(UNDEFINED_TERM, "Use `retry_limit` twice: `retry_limit`.\n", [CONFIG, threshold]), 1);
  assert.equal(count(UNDEFINED_TERM, "Use `retry_limit` twice: `retry_limit`.\n"), 0);
});

test("a profile's limits win over the file's limits", () => {
  const path = configFile({
    profile: "tight",
    limits: { maxTerms: FILE_TERMS },
    profiles: { tight: { description: "a test profile", limits: { maxTerms: TERM_LIMIT } }, loose: { description: "another" } },
  });
  const report = json([CONFIG, path], "x\n");
  assert.equal(report.profile, "tight");
  assert.equal(report.limits["maxTerms"], TERM_LIMIT);
});

test("the example config is valid and every profile has a description", () => {
  const report = json([CONFIG, join(ROOT, "greenhorn.config.example.json")], read(rule(NO_EXAMPLE, "pass")));
  assert.equal(report.profile, "adjacent-engineer");
  assert.equal(report.limits["maxTerms"], DEFAULT_MAX_TERMS);
  assert.equal(report.limits["glossaryThreshold"], DEFAULT_THRESHOLD);
  assert.equal(report.limits["maxDefinitionWords"], DEFAULT_WORDS);
});

const UNCLOSED = "unclosed-fence";
const ANALOGY = "analogy-without-limit";
const ONE = 1;
const BIG_LINES = 200_000; // 400k characters of "x\n"
const TIME_LIMIT_MS = 3000; // generous: the fix runs in well under a second, the old code took minutes

const terms = (text: string): readonly string[] => definitions(parse(text)).map((definition) => definition.term);

test("no-example: a bare Example heading, prose that starts with Before and After, an empty or an unclosed fence are not examples", () => {
  const FALSE_PASSES: readonly (readonly [name: string, text: string])[] = [
    ["a heading Example alone", "A tag is a label.\n\n## Example\n"],
    ["Before and After as prose", "Before the change it broke.\nAfter a while it worked.\n"],
    ["an unclosed fence", "A tag is a label.\n\n```\ngit tag v1\n"],
    ["an empty fence", "A tag is a label.\n\n```\n```\n"],
    ["a fence with blank lines only", "A tag is a label.\n\n```\n\n  \n```\n"],
    ["a bold Example with nothing after it", "A tag is a label.\n\n**Example**\n"],
  ];
  FALSE_PASSES.forEach(([name, text]) => assert.equal(count(NO_EXAMPLE, text), ONE, name));
});

test("no-example: labels, a content line after Example, and a closed fence still count", () => {
  const TRUE_PASSES: readonly (readonly [name: string, text: string])[] = [
    ["Before: and After: labels", "Before: old text\nAfter: new text\n"],
    ["bold labels", "**Before**\nold text\n**After**\nnew text\n"],
    ["heading labels", "## Before\nold\n## After\nnew\n"],
    ["Example: with content on the same line", "A tag is a label.\nExample: v1.2.0\n"],
    ["Example heading with content on the next line", "A tag is a label.\n\n## Example\nThe tag v1.2.0 marks a release.\n"],
    ["For example", "A tag is a label.\nFor example, v1.2.0 marks a release.\n"],
    ["a closed tilde fence", "A tag is a label.\n\n~~~\ngit tag v1\n~~~\n"],
  ];
  TRUE_PASSES.forEach(([name, text]) => assert.equal(count(NO_EXAMPLE, text), 0, name));
});

test("unclosed-fence warns, and the text after the opener is still checked", () => {
  const text = "```\nA **loop** is a thing that makes a loop.\n";
  const found = json([], text).findings;
  assert.equal(found.filter((finding) => finding.check === UNCLOSED && finding.level === "warn").length, ONE);
  assert.equal(found.find((finding) => finding.check === UNCLOSED)?.line, ONE);
  assert.equal(count(CIRCULAR, text), ONE, "the unclosed fence hid the rest of the text from the checks");
});

test("a fence closes only on the same mark with at least the same length", () => {
  assert.equal(count(CIRCULAR, "~~~\n```\nA **loop** is a thing that makes a loop.\n```\n~~~\n"), 0);
  assert.equal(count(CIRCULAR, "````\n```\nA **loop** is a thing that makes a loop.\n```\n````\n"), 0);
  assert.equal(count(UNCLOSED, "~~~\n```\nx\n```\n~~~\n"), 0);
});

test("a definition may wrap over two lines", () => {
  assert.deepEqual(terms("A **cache** is a store\nthat keeps copies.\n"), ["cache"]);
  assert.equal(count(CIRCULAR, "A **loop** is a thing\nthat makes a loop.\n"), ONE);
  assert.deepEqual(terms("- **Tag**: a label\n  that marks a commit.\n- **Release**: a build.\n"), ["Tag", "Release"]);
});

test("a lowercase term counts only in the form X is a Y that, at the start of a sentence", () => {
  assert.deepEqual(terms("A cache is a store that keeps copies.\n"), ["cache"]);
  assert.deepEqual(terms("It works. The retry limit is a number that caps retries.\n"), ["retry limit"]);
  assert.equal(count(CIRCULAR, "A loop is a thing that makes a loop.\n"), ONE);
  assert.deepEqual(terms("It is a tool that helps.\n"), []);
  assert.deepEqual(terms("We think a cache is a store that keeps copies.\n"), []);
  assert.deepEqual(terms("A cache is a store.\n"), []);
});

test("bold labels such as Note and Warning are not terms", () => {
  assert.deepEqual(terms("**Note**: see below.\n**Warning**: be careful.\n- **Tip**: rest.\n**Tag**: a label.\n"), ["Tag"]);
  assert.equal(count(TOO_MANY, "**Note**: a.\n**Warning**: b.\n", [CONFIG, configFile({ limits: { maxTerms: ONE } })]), 0);
});

test("analogy: not like is not a stated limit, but unlike and but ... not are", () => {
  assert.equal(count(ANALOGY, "A queue is like a line, but this is not like a bus.\n"), ONE);
  assert.equal(count(ANALOGY, "A queue is like a line. It is not a bus.\n"), ONE);
  assert.equal(count(ANALOGY, "A queue is like a line. Unlike a line, it holds jobs for days.\n"), 0);
  assert.equal(count(ANALOGY, "A queue is like a line. The analogy breaks down for priorities.\n"), 0);
  assert.equal(count(ANALOGY, "A queue is like a line. The difference is that a queue keeps jobs for days.\n"), 0);
  assert.equal(count(ANALOGY, "A queue is like a line. It differs from a line in one way.\n"), 0);
  assert.equal(count(ANALOGY, "A queue is like a line, but it is not first come first served.\n"), 0);
});

test("parse is linear: 400k characters run in a few seconds", () => {
  const started = Date.now();
  const report = json([], "x\n".repeat(BIG_LINES));
  assert.ok(Date.now() - started < TIME_LIMIT_MS, `took ${Date.now() - started} ms`);
  assert.ok(report.count >= ONE);
});

test("fixtureArgs reads <id>.args.json and resolves a named file against the rules folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "greenhorn-rules-"));
  writeFileSync(join(dir, ORIGINAL), "old\n");
  writeFileSync(join(dir, "x.args.json"), JSON.stringify(["--original", ORIGINAL]));
  assert.deepEqual(fixtureArgs("x", dir), ["--original", join(dir, ORIGINAL)]);
  assert.deepEqual(fixtureArgs("y", dir), []);
  assert.deepEqual(fixtureArgs("circular-definition"), []);
});

test("a bold-colon entry is a definition only when its body reads like one", () => {
  const REAL: readonly (readonly [name: string, text: string])[] = [
    ["an article", "**Invite code**: a one-time string that lets a person join.\n"],
    ["a copula", "**Cache**: is the store that keeps copies.\n"],
    ["a list bullet", "- **Cache**: the store that keeps copies.\n"],
    ["a determiner with that", "**Token**: any string that proves who you are.\n"],
    ["a short noun phrase", "**Tag**: a label\n"],
  ];
  REAL.forEach(([name, text]) => assert.equal(terms(text).length, ONE, name));
  const NOT_REAL: readonly (readonly [name: string, text: string])[] = [
    ["a label word with a number", "**Review order**: 1. foo\n"],
    ["a label word with a word", "**Size**: small\n"],
    ["a label word with a statement", "**Cause**: the cache was not cleared.\n"],
    ["a non-label with a statement", "**Reason**: the cache was not cleared.\n"],
    ["a list marker", "**Steps**: - one\n"],
    ["a link", "**Docs**: [the guide](a.md)\n"],
    ["a code span", "**Entry**: `src/a.ts` holds it\n"],
    ["an imperative", "**Start**: open the file\n"],
    ["a path", "**Where**: docs/a.md\n"],
    ["a number", "**Count**: 14 files\n"],
    ["a determiner without that", "**Token**: any string\n"],
  ];
  NOT_REAL.forEach(([name, text]) => assert.deepEqual(terms(text), [], name));
});

test("the label list covers the common section labels, and a label never gives long-definition", () => {
  const labels = ["Summary", "Risk", "Why", "Legend", "Checked", "Fix", "Testing", "Review order", "Not covered", "Screenshots", "Rollback"];
  labels.forEach((label) => assert.deepEqual(terms(`**${label}**: a long body that has more than five words in it.\n`), [], label));
  const long = "**Review order**: the first file, then the second file, then the third file, then the fourth file, then the fifth file, then a sixth.\n";
  assert.equal(count("long-definition", long), 0);
});

test("undefined-repeated-term flags a code-font name and an unknown acronym, and skips paths, snippets, flags and universal words", () => {
  const repeat = (name: string): string => `Use ${name}, then ${name}, then ${name}.\n`;
  const FLAGGED = ["`retry_limit`", "`StumbleReader`", "STE", "QPS"];
  FLAGGED.forEach((name) => assert.equal(count(UNDEFINED_TERM, repeat(name)), ONE, name));
  const SKIPPED = ["`docs/assets/icon.svg`", "`plugin.json`", "`bindScripts()`", "`written=false`", "`--json`", "`main`", "PR", "README", "GitHub", "SHA", "PNG", "JPEG", "DevOps", "SubJunk", "SKILL.md"];
  SKIPPED.forEach((name) => assert.equal(count(UNDEFINED_TERM, repeat(name)), 0, name));
});

test("an acronym that the text defines is not flagged", () => {
  assert.equal(count(UNDEFINED_TERM, "An **STE** is a style that limits words.\nSTE, STE, STE.\n"), 0);
});
