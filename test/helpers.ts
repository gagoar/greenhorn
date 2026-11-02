import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../scripts/cli.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface CliResult {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

export interface JsonFinding {
  readonly file: string;
  readonly check: string;
  readonly level: string;
  readonly line: number;
  readonly col: number;
  readonly match: string;
  readonly message: string;
}

export interface JsonReport {
  readonly findings: readonly JsonFinding[];
  readonly count: number;
  readonly hard_count: number;
  readonly warn_count: number;
  readonly profile: string;
  readonly limits: Readonly<Record<string, number | boolean>>;
}

// Runs the CLI in process. Returns the exit code and what it printed.
export function cli(args: readonly string[], stdin = ""): CliResult {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(args, { stdin: () => stdin, out: (text) => out.push(text), err: (text) => err.push(text) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

export const json = (args: readonly string[], stdin: string): JsonReport => JSON.parse(cli(["--json", ...args], stdin).out);

export const read = (...parts: readonly string[]): string => readFileSync(join(ROOT, ...parts), "utf8");

// Writes a config file into a fresh temporary directory and returns its path.
export function configFile(content: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "greenhorn-")), "greenhorn.config.json");
  writeFileSync(path, JSON.stringify(content));
  return path;
}
