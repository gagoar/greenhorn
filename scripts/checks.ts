// The checks. Two are hard failures: a circular definition and a missing example. The rest only warn,
// because a word count cannot tell a real stumble from a false alarm.
import type { Limits } from "./config.ts";
import { before, definitions, mentionedIn, mentions, parse, sentences, wordCount, type Definition, type Doc } from "./document.ts";

export const Level = { Hard: "hard", Warn: "warn" } as const;
export type LevelName = (typeof Level)[keyof typeof Level];

export interface Finding {
  readonly check: string;
  readonly level: LevelName;
  readonly line: number;
  readonly col: number;
  readonly match: string;
  readonly message: string;
}

export interface Context {
  readonly doc: Doc;
  readonly defs: readonly Definition[];
  readonly limits: Limits;
}

export interface Check {
  readonly id: string;
  readonly level: LevelName;
  readonly run: (context: Context) => readonly Omit<Finding, "check" | "level">[];
}

const FIRST = 1; // lines and columns count from 1
const NEXT_SENTENCES = 2; // an analogy gets its limit in the same sentence or in the two after it
const BUT_NOT_SENTENCES = 2; // a "but ... not" clause counts in the analogy sentence or the one after it

// A line that starts an example, and what follows on that line. Matches "For example, run x" → (", run x") and "- e.g. a tag" and "**Example**:" → ("**:"); rejects "Examples are hard" and "An example".
const EXAMPLE_MARKER = /^[\s>*_#-]*(?:for example|example|e\.g\.)(?![A-Za-z])(.*)$/i;

// Marks and spaces between an example word and its content. Removed from ", run x" and from "**:": the first leaves "runx", the second leaves nothing.
const MARKER_FILLER = /[\s:,.*_#>-]/g;

// A line that is a Before label. Matches "Before:", "**Before**", "## Before" and "Before: old text"; rejects the prose "Before the change it broke." and "Beforehand".
const BEFORE_LABEL = /^[\s>*_#-]*before(?:[*_]*\s*:|[\s*_]*$)/i;

// A line that is an After label. Matches "After:", "**After**" and "## After"; rejects the prose "After a while it worked." and "Afterwards".
const AFTER_LABEL = /^[\s>*_#-]*after(?:[*_]*\s*:|[\s*_]*$)/i;

// A table header with a Before cell then an After cell. Matches "| Before | After |" and "|**Before**|**After**|"; rejects "| Old | New |".
const BEFORE_AFTER_HEADER = /^\|?\s*\**before\**\s*\|\s*\**after\**\s*\|?\s*$/im;

// An analogy cue. Matches "A queue is like a line" and "Think of a cache as a shelf"; rejects "unlike a line".
const ANALOGY = /\blike an?\b|\b(?:is|are) like\b|\bthink of\b[^.!?]*\bas\b/i;

// A sentence that says where an analogy stops. Matches "Unlike a line, it can hold items", "it differs from a line", "this breaks down" and "The difference is that"; rejects "it is not like a bus".
const ANALOGY_LIMIT = /\b(?:unlike|differs? from|breaks? down|the difference is)\b/i;

// A "but ... not" clause that says where an analogy stops. Matches "like a line, but it is not first come first served"; rejects "like a line, but this is not like a bus".
const ANALOGY_BUT_NOT = /\bbut\b[^.!?]*\bnot\b(?!\s+like\b)/i;

// A name worth defining: code font with no space, or an all-capitals word that is not part of a path or a name. Matches "`retry_limit`" and "STE"; rejects "`a b`", "Stumble", "SKILL.md" and "A_B".
const NAME_CANDIDATE = /`([^`\s]+)`|(?<![\w./-])([A-Z]{2,})(?![\w-]|[./]\w)/g;

// The end of a file name. Matches "plugin.json" and "icon.svg"; rejects "retry_limit" and "bindScripts".
const FILE_EXTENSION = /\.[A-Za-z0-9]{1,5}$/;

// Words and acronyms that every developer knows: no text needs to define them.
const UNIVERSAL_TERMS: ReadonlySet<string> = new Set([
  "pr", "api", "url", "uri", "ci", "cd", "sha", "png", "jpeg", "jpg", "gif", "svg", "html", "css", "json", "yaml", "yml", "xml", "toml", "http", "https",
  "ssh", "sql", "cli", "sdk", "readme", "todo", "id", "os", "ui", "ux", "faq", "csv", "pdf", "md", "ts", "js", "dns", "tcp", "ip", "cpu", "gpu", "ram",
  "ok", "tl", "dr", "fyi", "eta", "wip", "lts", "mit", "oidc", "jwt", "git", "npm", "main", "master", "true", "false", "null", "undefined",
  "not", "error", "breaking", "note", "warning",
]);

// Whether a candidate is a path, a flag, a call or an assignment, not a name. For "docs/a.md", "x()", "a=b" and "--flag" it is true; for "retry_limit" it is false.
const isSnippet = (name: string): boolean => name.includes("/") || FILE_EXTENSION.test(name) || name.endsWith("()") || name.includes("=") || name.startsWith("-");

const worthDefining = (name: string): boolean => !isSnippet(name) && !UNIVERSAL_TERMS.has(name.toLowerCase());

// A backtick. Removed from "`x`": it becomes "x".
const BACKTICK = /`/g;

const at = (line: number, col: number, match: string, message: string): Omit<Finding, "check" | "level"> => ({ line, col, match, message });

const circularDefinition: Check = {
  id: "circular-definition",
  level: Level.Hard,
  run: ({ defs }) =>
    defs.flatMap((definition) =>
      defs
        .filter((other) => mentionedIn(definition.body, other.term))
        .filter((other) => other === definition || before(definition, other))
        .map((other) => at(definition.line, definition.col, definition.term, other === definition ? `the definition of "${definition.term}" uses "${other.term}" itself` : `the definition of "${definition.term}" uses "${other.term}", which line ${other.line} defines later`)),
    ),
};

// Whether an example marker has content: on its own line after the marker, or on the next prose line.
function markerHasContent(doc: Doc, index: number): boolean {
  const match = EXAMPLE_MARKER.exec(doc.prose[index] ?? "");
  if (!match) return false;
  return Boolean((match[FIRST] ?? "").replace(MARKER_FILLER, "")) || Boolean((doc.prose[index + FIRST] ?? "").trim());
}

// A Before label, later an After label, with at least one other line between or after them.
function labelledPair(doc: Doc): boolean {
  const open = doc.prose.findIndex((line) => BEFORE_LABEL.test(line));
  return open >= 0 && doc.prose.slice(open + FIRST).some((line) => AFTER_LABEL.test(line));
}

const noExample: Check = {
  id: "no-example",
  level: Level.Hard,
  run: ({ doc, limits }) => {
    if (!limits.requireExample) return [];
    if (doc.blocks.some((block) => block.body.trim())) return [];
    if (doc.prose.some((_line, index) => markerHasContent(doc, index))) return [];
    if (labelledPair(doc) || doc.prose.some((line) => BEFORE_AFTER_HEADER.test(line))) return [];
    return [at(1, 1, "", "the text has no example: add a closed code block, a line that starts with \"Example\" or \"For example\" and has content, or a Before and After pair of labels")];
  },
};

const unclosedFence: Check = {
  id: "unclosed-fence",
  level: Level.Warn,
  run: ({ doc }) => (doc.unclosed === undefined ? [] : [at(doc.unclosed, FIRST, "", "this code fence never closes: the text after it is checked as prose, and the fence is not an example")]),
};

const termBeforeDefinition: Check = {
  id: "term-before-definition",
  level: Level.Warn,
  run: ({ doc, defs }) =>
    defs.flatMap((definition) =>
      mentions(doc, definition.term)
        .filter((place) => before(place, definition))
        .slice(0, FIRST)
        .map((place) => at(place.line, place.col, definition.term, `"${definition.term}" is used here and defined on line ${definition.line}`)),
    ),
};

const undefinedRepeatedTerm: Check = {
  id: "undefined-repeated-term",
  level: Level.Warn,
  run: ({ doc, defs, limits }) => {
    const found = doc.prose
      .flatMap((line, index) => [...line.matchAll(NAME_CANDIDATE)].map((match) => ({ name: match[0].replace(BACKTICK, ""), line: index + FIRST, col: (match.index ?? 0) + FIRST })))
      .filter((item) => worthDefining(item.name));
    const names = [...new Set(found.map((item) => item.name))];
    return names
      .filter((name) => !defs.some((definition) => definition.term.toLowerCase() === name.toLowerCase()))
      .filter((name) => found.filter((item) => item.name === name).length >= limits.glossaryThreshold)
      .flatMap((name) => found.filter((item) => item.name === name).slice(0, FIRST).map((item) => at(item.line, item.col, name, `"${name}" appears ${found.filter((other) => other.name === name).length} times and is never defined`)));
  },
};

const tooManyTerms: Check = {
  id: "too-many-terms",
  level: Level.Warn,
  run: ({ defs, limits }) =>
    defs.slice(limits.maxTerms, limits.maxTerms + FIRST).map((definition) => at(definition.line, definition.col, definition.term, `the text defines ${defs.length} terms and the limit is ${limits.maxTerms}`)),
};

const longDefinition: Check = {
  id: "long-definition",
  level: Level.Warn,
  run: ({ defs, limits }) =>
    defs.filter((definition) => wordCount(definition.body) > limits.maxDefinitionWords).map((definition) => at(definition.line, definition.col, definition.term, `the definition of "${definition.term}" has ${wordCount(definition.body)} words and the limit is ${limits.maxDefinitionWords}`)),
};

const analogyWithoutLimit: Check = {
  id: "analogy-without-limit",
  level: Level.Warn,
  run: ({ doc, limits }) => {
    if (!limits.analogyNeedsLimit) return [];
    const all = sentences(doc);
    const hasLimit = (index: number): boolean =>
      all.slice(index, index + NEXT_SENTENCES + FIRST).some((candidate) => ANALOGY_LIMIT.test(candidate.text)) || all.slice(index, index + BUT_NOT_SENTENCES).some((candidate) => ANALOGY_BUT_NOT.test(candidate.text));
    return all
      .map((sentence, index) => ({ sentence, index }))
      .filter(({ sentence }) => ANALOGY.test(sentence.text))
      .filter(({ index }) => !hasLimit(index))
      .map(({ sentence }) => at(sentence.line, FIRST, ANALOGY.exec(sentence.text)?.[0] ?? "", "an analogy has no stated limit: say where it breaks down in the next two sentences"));
  },
};

export const CHECKS: readonly Check[] = [circularDefinition, noExample, unclosedFence, termBeforeDefinition, undefinedRepeatedTerm, tooManyTerms, longDefinition, analogyWithoutLimit];

export const CHECK_IDS: readonly string[] = CHECKS.map((check) => check.id);

export function runChecks(text: string, limits: Limits, disabled: readonly string[]): readonly Finding[] {
  const doc = parse(text);
  const context: Context = { doc, defs: definitions(doc), limits };
  return CHECKS.filter((check) => !disabled.includes(check.id)).flatMap((check) => check.run(context).map((item) => ({ ...item, check: check.id, level: check.level })));
}
