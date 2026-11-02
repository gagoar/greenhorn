// The command line of check-text: arguments in, a report and an exit code out. scripts/check-text.ts is the entry point.
import { existsSync, readFileSync, statSync } from "node:fs";
import { CHECK_IDS, runChecks } from "./checks.ts";
import { ConfigError, DEFAULT_CONFIG, resolveConfig, type Config } from "./config.ts";
import { failed, summarize, toJSON, toText, type Report } from "./report.ts";

const EXIT_OK = 0;
const EXIT_HARD = 1;
const EXIT_USAGE = 2;
const STDIN = 0;
const STDIN_NAME = "<stdin>";
const LOCAL_CONFIG = "greenhorn.config.json";

const USAGE = `usage: check-text [--json] [--config PATH] [--profile NAME] [--disable id,id] [--] [FILE...]

A flag that takes a value also accepts the form --flag=value. --disable may repeat: the ids add up. An empty --disable is a usage error.
-- ends the flags, so that a file may have a name that starts with a dash.
--profile NAME picks a profile of the config file. A name that the config does not define is a usage error.
Reads FILE arguments, or stdin when there are none. Exit 0 when no hard check fails, 1 when one does, 2 for a usage error.
Without --config the checker reads ${LOCAL_CONFIG} in the current directory, if it exists, and else uses the defaults.

Checks (hard fails first): ${CHECK_IDS.join(", ")}`;

class UsageError extends Error {}

interface Options {
  readonly json: boolean;
  readonly help: boolean;
  readonly config: string | undefined;
  readonly profile: string | undefined;
  readonly disable: readonly string[];
  readonly paths: readonly string[];
}

const DEFAULTS: Options = { json: false, help: false, config: undefined, profile: undefined, disable: [], paths: [] };

type ValueFlag = (value: string, options: Options) => Options;

function disableFlag(value: string, options: Options): Options {
  const ids = value.split(",").map((id) => id.trim()).filter(Boolean);
  if (!ids.length) throw new UsageError("--disable needs at least one check id");
  const unknown = ids.filter((id) => !CHECK_IDS.includes(id));
  if (unknown.length) throw new UsageError(`unknown check ${unknown.join(", ")}`);
  return { ...options, disable: [...options.disable, ...ids] };
}

type Switch = (options: Options) => Options;

const VALUE_FLAGS = {
  "--config": (value: string, options: Options): Options => ({ ...options, config: value }),
  "--profile": (value: string, options: Options): Options => ({ ...options, profile: value }),
  "--disable": disableFlag,
} as const satisfies Readonly<Record<string, ValueFlag>>;

const SWITCHES = {
  "--json": (options: Options): Options => ({ ...options, json: true }),
  "-h": (options: Options): Options => ({ ...options, help: true }),
  "--help": (options: Options): Options => ({ ...options, help: true }),
} as const satisfies Readonly<Record<string, Switch>>;

// Looks a name up in a table of flags and ignores inherited names such as "constructor".
const lookup = <T>(table: Readonly<Record<string, T>>, name: string): T | undefined => (Object.hasOwn(table, name) ? table[name] : undefined);

const NOT_FOUND = -1; // what indexOf returns for a missing character
const END_OF_FLAGS = "--";

// Splits "--disable=a,b" into its name and its value. A text with no "=" has no value.
function splitFlag(arg: string): { readonly name: string; readonly inline: string | undefined } {
  const at = arg.startsWith("--") ? arg.indexOf("=") : NOT_FOUND;
  return at === NOT_FOUND ? { name: arg, inline: undefined } : { name: arg.slice(0, at), inline: arg.slice(at + "=".length) };
}

function parse(argv: readonly string[], options: Options = DEFAULTS, flagsEnded = false): Options {
  const [arg, ...rest] = argv;
  if (arg === undefined) return options;
  if (flagsEnded) return parse(rest, { ...options, paths: [...options.paths, arg] }, true);
  if (arg === END_OF_FLAGS) return parse(rest, options, true);
  const { name, inline } = splitFlag(arg);
  const valueFlag = lookup<ValueFlag>(VALUE_FLAGS, name);
  if (valueFlag) {
    const [next, ...after] = rest;
    const value = inline ?? next;
    if (value === undefined) throw new UsageError(`${name} needs a value`);
    return parse(inline === undefined ? after : rest, valueFlag(value, options));
  }
  const toggle = lookup<Switch>(SWITCHES, name);
  if (toggle) {
    if (inline !== undefined) throw new UsageError(`${name} takes no value`);
    return parse(rest, toggle(options));
  }
  if (arg.startsWith("--")) throw new UsageError(`unknown flag ${name}`);
  return parse(rest, { ...options, paths: [...options.paths, arg] });
}

export interface Io {
  readonly stdin: () => string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const SYSTEM_IO: Io = {
  stdin: () => readFileSync(STDIN, "utf8"),
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};

function loadConfig(path: string | undefined, profile: string | undefined): Config {
  const target = path ?? (existsSync(LOCAL_CONFIG) ? LOCAL_CONFIG : undefined);
  if (target === undefined) return profile === undefined ? DEFAULT_CONFIG : resolveConfig({}, profile);
  try {
    return resolveConfig(JSON.parse(readFileSync(target, "utf8")), profile);
  } catch (error) {
    if (error instanceof SyntaxError) throw new ConfigError(`${target} is not valid JSON`);
    throw error;
  }
}

// Reads one file. A directory gets its own message: readFileSync would say EISDIR.
function readText(path: string): string {
  if (existsSync(path) && statSync(path).isDirectory()) throw new Error(`${path} is a directory: give a file`);
  return readFileSync(path, "utf8");
}

function report(options: Options, io: Io): Report {
  const config = loadConfig(options.config, options.profile);
  const inputs = options.paths.length ? options.paths.map((path) => ({ name: path, text: readText(path) })) : [{ name: STDIN_NAME, text: io.stdin() }];
  const findings = inputs.flatMap((input) => runChecks(input.text, config.limits, options.disable).map((finding) => ({ ...finding, file: input.name })));
  return summarize(findings, config.profile, config.limits);
}

export function run(argv: readonly string[], io: Io = SYSTEM_IO): number {
  try {
    const options = parse(argv);
    if (options.help) {
      io.out(USAGE);
      return EXIT_OK;
    }
    const result = report(options, io);
    io.out(options.json ? toJSON(result) : toText(result));
    return failed(result) ? EXIT_HARD : EXIT_OK;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.err(error instanceof UsageError ? `check-text: ${message}\n${USAGE}` : `check-text: ${message}`);
    return EXIT_USAGE;
  }
}
