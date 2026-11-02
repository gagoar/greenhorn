// Reads a Markdown text into the parts the checks need: prose lines, definitions, sentences and mentions of a term.

export interface Position {
  readonly line: number;
  readonly col: number;
}

export interface Definition extends Position {
  readonly term: string;
  readonly body: string;
}

export interface Sentence {
  readonly line: number;
  readonly text: string;
}

export interface FenceBlock {
  readonly line: number; // the line of the opening mark, counted from 1
  readonly body: string; // the text between the marks
}

export interface Doc {
  readonly lines: readonly string[];
  // The same lines with every closed fenced code block blanked, so line numbers stay true.
  // The lines after a fence that never closes stay in the prose: the checks read them.
  readonly prose: readonly string[];
  readonly blocks: readonly FenceBlock[]; // the closed fenced blocks
  readonly unclosed: number | undefined; // the line of a fence that never closes, counted from 1
}

// A paragraph, list item or table row: one or more prose lines joined with single spaces, so a soft-wrapped sentence is whole.
interface Unit {
  readonly text: string;
  readonly lines: readonly number[]; // the 0-based index of each joined line
  readonly starts: readonly number[]; // where each line starts inside text
}

const FIRST = 1; // lines and columns count from 1
const FIRST_GROUP = 1;
const SECOND_GROUP = 2;

// A line break. Splits "a\r\nb" and "a\nb" into two lines; leaves "a b" whole.
const NEWLINE = /\r?\n/;

// The line that opens or closes a fenced code block. Matches "```ts" → ("```", "ts") and "  ~~~~" → ("~~~~", ""); rejects "``x``".
const FENCE_LINE = /^\s*(`{3,}|~{3,})(.*)$/;

// A line that starts a new block, so it never joins the line before it. Matches "- item", "1. item", "## Title", "> quote" and "| a | b |"; rejects "plain text".
const BLOCK_START = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|\|)/;

// A definition in list or colon form. Matches "- **Stumble**: a spot where a reader stops" → ("Stumble", "a spot where a reader stops"); rejects "**Stumble** is a spot".
const BOLD_COLON = /^\s*(?:[-*+]\s+)?\*\*([^*]+?)(?::\*\*|\*\*:)\s*(.+)$/;

// A definition in sentence form. Matches "A **cache** is a store that keeps copies" → ("**cache**", "store that keeps copies"); rejects "The cache is slow".
const INLINE_DEFINITION = /(\*\*[^*]+\*\*|`[^`]+`|\b[A-Z][\w-]*(?: [A-Z][\w-]*)*)\s+(?:is|are)\s+an?\s+([^.!?]*?\bthat\b[^.!?]*)/g;

// A definition with a plain lowercase term, only at the start of a sentence. Matches "A cache is a store that keeps copies" → ("cache", "store that keeps copies"); rejects "We think a cache is a store that keeps copies".
const LOWER_DEFINITION = /(?<=^|[.!?]\s+)(?:(?:[Aa]n?|[Tt]he)\s+)?([a-z][\w-]*(?: [a-z][\w-]*)?)\s+(?:is|are)\s+an?\s+([^.!?]*?\bthat\b[^.!?]*)/g;

// The marks around a term. Removed from "**cache**" and "`cache`": both become "cache".
const TERM_MARKS = /\*\*|`/g;

// Space between words. Splits "a  b" into two words.
const WHITESPACE = /\s+/;

// The end of a sentence. Splits "One. Two" after the full stop; leaves "One, two" whole.
const SENTENCE_END = /(?<=[.!?])\s+/;

// Characters that have a meaning in a pattern. Each gets a backslash: "a.b" becomes "a\.b".
const PATTERN_SPECIAL = /[.*+?^${}()|[\]\\]/g;

// Words that start a sentence and are not terms. A sentence such as "It is a tool that" defines nothing.
const NOT_TERMS: ReadonlySet<string> = new Set(["it", "this", "that", "there", "here", "these", "those", "what", "which", "who", "he", "she", "they", "we", "you", "i"]);

// Bold labels that head a note or a section, not a definition: "**Note**: see below" and "**Review order**: 1. a" define nothing.
const LABELS: readonly string[] = [
  "note", "notes", "warning", "tip", "example", "examples", "before", "after", "caution", "important",
  "summary", "tldr", "tl;dr", "risk", "risks", "why", "what", "how", "size", "legend", "checked", "cause", "fix", "change", "changes",
  "testing", "test plan", "tests", "review order", "not covered", "screenshots", "context", "background", "motivation", "impact",
  "rollout", "rollback", "result", "results", "status", "scope", "out of scope", "goal", "goals", "problem", "solution", "decision",
  "usage", "output", "input", "limitations", "follow-up", "follow-ups", "related", "see also", "reviewers", "reviewer", "list format",
];
const LABEL_WORDS: ReadonlySet<string> = new Set(LABELS);

// An article that starts a definition body. Matches "a one-time string", "an agent" and "the store"; rejects "1. foo", "small" and "fix the cache".
const ARTICLE_BODY = /^(?:an?|the)\s/i;
// A copula that starts a definition body. Matches "is the store", "are the stores", "means a label" and "refers to a store"; rejects "island" and "see [link]".
const COPULA_BODY = /^(?:is|are|means|refers to)\s/i;

// A determiner that opens a noun phrase, accepted only when "that" or "which" follows soon. Matches "any string that", "each value which"; rejects "each value".
const DETERMINER_BODY = /^(?:any|each|every|one|some|all)\s/i;

// The relative word of a definition. Matches "a string that expires" and "a value which holds"; rejects "a string".
const RELATIVE_WORD = /\b(?:that|which)\b/i;

// A verb or negation that makes a sentence a statement. Matches "the cache was not cleared" and "the job did run"; rejects "a one-time string".
const STATEMENT_WORD = /\b(?:was|were|did|does|do|has|have|had|will|would|should|must|cannot|not)\b/i;

const RELATIVE_WINDOW_WORDS = 12; // "that" or "which" must come within this many words of the start of a determiner-led body

const SEPARATOR = " "; // joins the lines of a unit; one character, so a column maps back to its line
const MAX_JOINED_LINES = 12; // a unit never joins more lines than this, so a text with no blank line cannot make the definition regexes slow

const escapePattern = (text: string): string => text.replace(PATTERN_SPECIAL, "\\$&");

// Matches a term with no word character on either side. For "cache" it matches "the cache fills" and "cache."; it rejects "caches" and "cached".
const termPattern = (term: string): RegExp => new RegExp(`(?<!\\w)${escapePattern(term)}(?!\\w)`, "gi");

interface OpenFence {
  readonly mark: string; // "`" or "~"
  readonly size: number;
  readonly index: number; // the 0-based line of the opening mark
}

interface FenceScan {
  open: OpenFence | undefined;
  readonly hidden: boolean[]; // for each line, whether it sits in a fence (the marks included)
  readonly blocks: FenceBlock[];
}

// Whether a mark line opens a fence. A backtick fence cannot have a backtick in its info text: "``` a`b" is no fence.
const opensFence = (marks: string, info: string): boolean => marks !== "" && !(marks.startsWith("`") && info.includes("`"));

// Whether a mark line closes the open fence: the same mark, at least as long, and no info text (CommonMark).
const closesFence = (open: OpenFence, marks: string, info: string): boolean => marks.startsWith(open.mark) && marks.length >= open.size && info.trim() === "";

// One pass over the lines. The scan object lives inside this function and is the only mutable state.
function scanFences(lines: readonly string[]): FenceScan {
  const scan: FenceScan = { open: undefined, hidden: [], blocks: [] };
  lines.forEach((line, index) => {
    const found = FENCE_LINE.exec(line);
    const marks = found?.[FIRST_GROUP] ?? "";
    const info = found?.[SECOND_GROUP] ?? "";
    const open = scan.open;
    if (open === undefined) {
      const opens = opensFence(marks, info);
      if (opens) scan.open = { mark: marks.charAt(0), size: marks.length, index };
      scan.hidden.push(opens);
      return;
    }
    if (closesFence(open, marks, info)) {
      scan.blocks.push({ line: open.index + FIRST, body: lines.slice(open.index + FIRST, index).join("\n") });
      scan.open = undefined;
    }
    scan.hidden.push(true);
  });
  return scan;
}

export function parse(text: string): Doc {
  const lines = text.split(NEWLINE);
  const scan = scanFences(lines);
  const stray = scan.open?.index; // the lines after a fence that never closes stay visible
  const prose = lines.map((line, index) => (scan.hidden[index] && (stray === undefined || index <= stray) ? "" : line));
  return { lines, prose, blocks: scan.blocks, unclosed: stray === undefined ? undefined : stray + FIRST };
}

export const wordCount = (text: string): number => text.split(WHITESPACE).filter(Boolean).length;

const cleanTerm = (raw: string): string => raw.replace(TERM_MARKS, "").trim();

// Groups the prose lines into units. A blank line ends a unit, and so does a line that starts a block or a bold-colon definition.
function units(doc: Doc): readonly Unit[] {
  const groups: number[][] = [];
  doc.prose.forEach((line, index) => {
    if (!line.trim()) {
      groups.push([]);
      return;
    }
    const last = groups.at(-FIRST);
    const joins = last !== undefined && !!last.length && last.length < MAX_JOINED_LINES && !BLOCK_START.test(line) && !BOLD_COLON.test(line);
    if (joins) last.push(index);
    else groups.push([index]);
  });
  return groups
    .filter((group) => !!group.length)
    .map((group) => {
      const parts = group.map((index) => doc.prose[index] ?? "");
      const ends = parts.reduce<readonly number[]>((all, part) => [...all, (all.at(-FIRST) ?? -SEPARATOR.length) + SEPARATOR.length + part.length], []);
      return { text: parts.join(SEPARATOR), lines: group, starts: ends.map((end, at) => end - (parts[at] ?? "").length) };
    });
}

// The line and column, counted from 1, of an offset inside a unit.
function locate(unit: Unit, offset: number): Position {
  const at = Math.max(unit.starts.findLastIndex((start) => start <= offset), 0);
  return { line: (unit.lines[at] ?? 0) + FIRST, col: offset - (unit.starts[at] ?? 0) + FIRST };
}

const isLabel = (term: string): boolean => LABEL_WORDS.has(term.toLowerCase());

const firstWords = (text: string, count: number): string => text.split(WHITESPACE).slice(0, count).join(SEPARATOR);

// Whether a bold-colon body reads like a definition. The edge: an article-led body with a "was", "did", "has" or "not" before any "that" or "which" is a statement, as in "the cache was not cleared".
function readsAsDefinition(body: string): boolean {
  const text = body.trim();
  if (COPULA_BODY.test(text)) return true;
  if (DETERMINER_BODY.test(text)) return RELATIVE_WORD.test(firstWords(text, RELATIVE_WINDOW_WORDS));
  if (!ARTICLE_BODY.test(text)) return false;
  const before = text.split(RELATIVE_WORD)[0] ?? text;
  return !STATEMENT_WORD.test(before);
}

const firstWord = (term: string): string => term.toLowerCase().split(WHITESPACE).slice(0, FIRST).join("");

function colonDefinition(unit: Unit): Definition | undefined {
  const match = BOLD_COLON.exec(unit.text);
  if (!match) return undefined;
  const term = cleanTerm(match[FIRST_GROUP] ?? "");
  const body = match[SECOND_GROUP] ?? "";
  return isLabel(term) || !readsAsDefinition(body) ? undefined : { term, body, ...locate(unit, unit.text.indexOf("**")) };
}

function sentenceDefinitions(unit: Unit): readonly Definition[] {
  const read = (match: RegExpMatchArray): Definition => ({ term: cleanTerm(match[FIRST_GROUP] ?? ""), body: match[SECOND_GROUP] ?? "", ...locate(unit, match.index ?? 0) });
  const capital = [...unit.text.matchAll(INLINE_DEFINITION)].map(read).filter((definition) => !NOT_TERMS.has(definition.term.toLowerCase()) && !isLabel(definition.term));
  const lower = [...unit.text.matchAll(LOWER_DEFINITION)].map(read).filter((definition) => !NOT_TERMS.has(firstWord(definition.term)));
  return [...capital, ...lower].sort((a, b) => a.line - b.line || a.col - b.col);
}

// The definitions of a text in reading order. A term defined twice keeps its first definition.
export function definitions(doc: Doc): readonly Definition[] {
  const all = units(doc).flatMap((unit) => {
    const colon = colonDefinition(unit);
    return colon ? [colon] : sentenceDefinitions(unit);
  });
  const seen = new Set<string>();
  return all.filter((definition) => {
    const key = definition.term.toLowerCase();
    const fresh = !seen.has(key);
    seen.add(key);
    return fresh;
  });
}

export const before = (a: Position, b: Position): boolean => a.line < b.line || (a.line === b.line && a.col < b.col);

// Every place in the prose where a term appears as a whole word, ignoring case.
export function mentions(doc: Doc, term: string): readonly Position[] {
  return doc.prose.flatMap((line, index) => [...line.matchAll(termPattern(term))].map((match) => ({ line: index + FIRST, col: (match.index ?? 0) + FIRST })));
}

export const mentionedIn = (text: string, term: string): boolean => termPattern(term).test(text);

// The sentences of the prose in reading order. A sentence that wraps over two lines counts as two.
export const sentences = (doc: Doc): readonly Sentence[] =>
  doc.prose.flatMap((line, index) => line.split(SENTENCE_END).filter((part) => part.trim()).map((text) => ({ line: index + FIRST, text })));
