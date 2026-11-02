// The verify pass: it checks the JSON of a second, fresh reader and compares it with the first reader's JSON.
// It decides nothing about clarity. It checks the shape, checks that each quote is in the draft, and counts which
// stumbles of the first reading come back. The match is approximate, and the report says so.

export const KINDS = ["term", "acronym", "jump", "assumed-step", "missing-example"] as const;
export type Kind = (typeof KINDS)[number];

export interface Stumble {
  readonly quote: string;
  readonly kind: Kind;
  readonly question: string;
}

export interface Reading {
  readonly stumbles: readonly Stumble[];
  readonly gist: string;
}

export type Parsed = { readonly ok: true; readonly reading: Reading } | { readonly ok: false; readonly problems: readonly string[] };

export interface Comparison {
  readonly beforeCount: number;
  readonly afterCount: number;
  readonly didNotRecur: readonly string[];
  readonly recurred: readonly string[];
  readonly fresh: readonly string[];
}

// The reader agent is told to quote at most 12 words, and in the first run it quoted up to 17. The validator allows more than the
// agent is told, so that a long quote does not throw away a good reading. The substring test is what rejects an invented quote.
const MAX_QUOTE_WORDS = 25;
const MAX_STUMBLES = 50;
const MAX_QUESTION_CHARS = 400;
const MAX_GIST_CHARS = 800;
const SAME_STUMBLE_JACCARD = 0.5;
const TERM_KINDS: readonly Kind[] = ["term", "acronym"];
const STUMBLE_KEYS = ["quote", "kind", "question"];
const READING_KEYS = ["stumbles", "gist_attempt"];

// A run of white space. Collapses "a \n b" into "a b" so that a quote matches across a line break.
const WHITESPACE = /\s+/g;

// A word of a quote. Matches "stop_hook_active" whole and "edit-hook" as "edit" and "hook"; rejects punctuation.
const WORD = /[\p{L}\p{N}_]+/gu;

// Words that carry no meaning for a match. A token in this set never counts as a key word.
const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "by", "for", "with", "from", "is", "are", "was", "were", "be", "it", "its",
  "this", "that", "these", "those", "as", "not", "no", "so", "if", "then", "than", "which", "who", "what", "when", "how", "do", "does",
]);

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const isKind = (value: unknown): value is Kind => typeof value === "string" && (KINDS as readonly string[]).includes(value);
const squash = (text: string): string => text.trim().replace(WHITESPACE, " ");
const wordCount = (text: string): number => squash(text).split(" ").filter(Boolean).length;
const onlyKeys = (value: Json, allowed: readonly string[]): boolean => Object.keys(value).every((key) => allowed.includes(key));
const isText = (value: unknown, max: number): value is string => typeof value === "string" && squash(value) !== "" && value.length <= max;

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// The problems of one stumble. Without a draft, only the shape is checked. The text of a bad entry is never echoed.
function stumbleProblems(entry: unknown, index: number, draft: string | undefined): readonly string[] {
  const at = `stumbles[${index}]`;
  if (!isObject(entry)) return [`${at} must be an object`];
  const quote = entry["quote"];
  const quoteOk = isText(quote, draft === undefined ? Number.MAX_SAFE_INTEGER : draft.length) && wordCount(quote) <= MAX_QUOTE_WORDS;
  const checks: readonly (readonly [boolean, string])[] = [
    [onlyKeys(entry, STUMBLE_KEYS), `${at} allows only ${STUMBLE_KEYS.join(", ")}`],
    [quoteOk, `${at}.quote must be text of at most ${MAX_QUOTE_WORDS} words`],
    [!quoteOk || draft === undefined || squash(draft).toLowerCase().includes(squash(String(quote)).toLowerCase()), `${at}.quote is not in the draft`],
    [isKind(entry["kind"]), `${at}.kind must be one of ${KINDS.join(", ")}`],
    [isText(entry["question"], MAX_QUESTION_CHARS), `${at}.question must be text of at most ${MAX_QUESTION_CHARS} characters`],
  ];
  return checks.filter(([ok]) => !ok).map(([, message]) => message);
}

// Reads the JSON of one reader. With a draft, every quote must be a substring of it, ignoring case and white space: this also
// rejects an invented quote. A reader that changes a capital letter in a quote is not inventing.
export function parseReading(raw: string, draft?: string): Parsed {
  const value = parseJson(raw);
  if (!isObject(value)) return { ok: false, problems: ["the reader output must be one JSON object"] };
  const list = value["stumbles"];
  const top: readonly (readonly [boolean, string])[] = [
    [onlyKeys(value, READING_KEYS), `the reader output allows only ${READING_KEYS.join(", ")}`],
    [Array.isArray(list) && list.length <= MAX_STUMBLES, `stumbles must be a list of at most ${MAX_STUMBLES} entries`],
    [isText(value["gist_attempt"], MAX_GIST_CHARS), `gist_attempt must be text of at most ${MAX_GIST_CHARS} characters`],
  ];
  const problems = [
    ...top.filter(([ok]) => !ok).map(([, message]) => message),
    ...(Array.isArray(list) ? list.slice(0, MAX_STUMBLES).flatMap((entry, index) => stumbleProblems(entry, index, draft)) : []),
  ];
  if (problems.length) return { ok: false, problems };
  const stumbles = (list as readonly Json[]).map((entry): Stumble => ({ quote: String(entry["quote"]), kind: entry["kind"] as Kind, question: String(entry["question"]) })); // stumbleProblems has checked each field
  return { ok: true, reading: { stumbles, gist: String(value["gist_attempt"]) } };
}

const tokens = (text: string): readonly string[] => (text.toLowerCase().match(WORD) ?? []).filter((word) => !STOPWORDS.has(word));

// The longest meaningful word of a quote: the best guess of the term that the quote names.
const keyToken = (quote: string): string | undefined =>
  tokens(quote).reduce<string | undefined>((best, word) => (best === undefined || word.length > best.length ? word : best), undefined);

function jaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const shared = [...a].filter((word) => b.has(word)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : shared / union;
}

// A term or acronym stumble matches when its key word shows in the other quote or question. Other kinds match on the
// same kind and a word overlap of at least 0.5. The test is approximate: wording changes between two runs.
function sameStumble(old: Stumble, other: Stumble): boolean {
  if (TERM_KINDS.includes(old.kind)) {
    const key = keyToken(old.quote);
    return key !== undefined && tokens(`${other.quote} ${other.question}`).includes(key);
  }
  return old.kind === other.kind && jaccard(tokens(old.quote), tokens(other.quote)) >= SAME_STUMBLE_JACCARD;
}

// Which stumbles of the first reading come back in the second, and which stumbles of the second are new.
export function compareReadings(before: Reading, after: Reading): Comparison {
  const recurs = (old: Stumble): boolean => after.stumbles.some((other) => sameStumble(old, other));
  const isNew = (other: Stumble): boolean => !before.stumbles.some((old) => sameStumble(old, other));
  return {
    beforeCount: before.stumbles.length,
    afterCount: after.stumbles.length,
    didNotRecur: before.stumbles.filter((old) => !recurs(old)).map((old) => old.quote),
    recurred: before.stumbles.filter(recurs).map((old) => old.quote),
    fresh: after.stumbles.filter(isNew).map((other) => other.quote),
  };
}
