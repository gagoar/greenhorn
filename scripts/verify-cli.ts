// The command line of verify-reader: files in, a JSON report out. scripts/verify-reader.ts is the entry point.
import { readFileSync, statSync } from "node:fs";
import { compareReadings, parseReading, type Reading } from "./verify.ts";

const EXIT_OK = 0;
const EXIT_INVALID = 1;
const EXIT_USAGE = 2;
const BYTES_PER_KIB = 1024;
const MAX_BYTES = 256 * BYTES_PER_KIB;
const FLAGS = ["--reader", "--draft", "--before"] as const;
type Flag = (typeof FLAGS)[number];

const USAGE = `usage: verify-reader --reader FILE --draft FILE [--before FILE]

--reader: the JSON of the fresh reader. --draft: the final text that it read. --before: the JSON of the first reader.
Prints one JSON report. Exit 0 when the reader JSON is valid, 1 when it is not, 2 for a usage error.
The report counts which first-pass stumbles come back. It does not measure clarity for a person.`;

class UsageError extends Error {}

function readSmall(path: string): string {
  const info = statSync(path);
  if (!info.isFile() || info.size > MAX_BYTES) throw new UsageError(`${path} must be a regular file of at most ${MAX_BYTES / BYTES_PER_KIB} KiB`);
  return readFileSync(path, "utf8");
}

function readFlags(args: readonly string[]): Partial<Record<Flag, string>> {
  const pairs = args.flatMap((arg, index) => (index % 2 === 0 ? [[arg, args[index + 1]] as const] : []));
  const unknown = pairs.find(([name]) => !(FLAGS as readonly string[]).includes(name));
  if (unknown !== undefined || args.length % 2 !== 0) throw new UsageError("unknown or incomplete flag");
  if (new Set(pairs.map(([name]) => name)).size !== pairs.length) throw new UsageError("a flag was given twice");
  return Object.fromEntries(pairs);
}

function firstReading(path: string): Reading {
  const parsed = parseReading(readSmall(path));
  if (!parsed.ok) throw new UsageError(`--before is not valid reader JSON: ${parsed.problems.join("; ")}`);
  return parsed.reading;
}

export function run(args: readonly string[]): number {
  try {
    const flags = readFlags(args);
    const { "--reader": reader, "--draft": draft, "--before": before } = flags;
    if (reader === undefined || draft === undefined) throw new UsageError("--reader and --draft are required");
    const parsed = parseReading(readSmall(reader), readSmall(draft));
    if (!parsed.ok) {
      console.log(JSON.stringify({ valid: false, problems: parsed.problems }, null, 2));
      return EXIT_INVALID;
    }
    const comparison = before === undefined ? undefined : compareReadings(firstReading(before), parsed.reading);
    console.log(JSON.stringify({ valid: true, afterCount: parsed.reading.stumbles.length, gist: parsed.reading.gist, comparison }, null, 2));
    return EXIT_OK;
  } catch (error) {
    if (!(error instanceof UsageError) && !(error instanceof Error && "code" in error)) throw error;
    console.error(`${error.message}\n\n${USAGE}`);
    return EXIT_USAGE;
  }
}
