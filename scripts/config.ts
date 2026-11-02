// Settings of the checker: the limits, the reader profiles and the rules that read a config file.
// Every number here is a default that nobody has tested. The eval in eval/README.md is how they get tuned.

export interface Limits {
  readonly maxTerms: number;
  readonly glossaryThreshold: number;
  readonly maxDefinitionWords: number;
  readonly requireExample: boolean;
  readonly analogyNeedsLimit: boolean;
}

export interface Profile {
  readonly description: string;
  readonly knows: readonly string[];
  readonly doesNotKnow: readonly string[];
  readonly limits: Partial<Limits>;
}

// The verify pass: a second, fresh reader reads the final text. maxRounds is how many fix rounds it may start.
export interface Verify {
  readonly enabled: boolean;
  readonly maxRounds: number;
}

export interface Config {
  readonly profile: string;
  readonly verify: Verify;
  readonly limits: Limits;
  readonly profiles: Readonly<Record<string, Profile>>;
}

export class ConfigError extends Error {}

const DEFAULT_MAX_TERMS = 5;
const DEFAULT_GLOSSARY_THRESHOLD = 3;
const DEFAULT_MAX_DEFINITION_WORDS = 25;

export const DEFAULT_PROFILE = "adjacent-engineer";

export const DEFAULT_LIMITS: Limits = {
  maxTerms: DEFAULT_MAX_TERMS,
  glossaryThreshold: DEFAULT_GLOSSARY_THRESHOLD,
  maxDefinitionWords: DEFAULT_MAX_DEFINITION_WORDS,
  requireExample: true,
  analogyNeedsLimit: true,
};

export const DEFAULT_VERIFY: Verify = { enabled: true, maxRounds: 1 };

export const DEFAULT_CONFIG: Config = { profile: DEFAULT_PROFILE, verify: DEFAULT_VERIFY, limits: DEFAULT_LIMITS, profiles: {} };

type Kind = "count" | "flag";

// What each limit must be: a positive whole number, or a true/false flag.
const LIMIT_KINDS = {
  maxTerms: "count",
  glossaryThreshold: "count",
  maxDefinitionWords: "count",
  requireExample: "flag",
  analogyNeedsLimit: "flag",
} as const satisfies Readonly<Record<keyof Limits, Kind>>;

const KIND_TESTS = {
  count: (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0,
  flag: (value: unknown) => typeof value === "boolean",
} as const satisfies Readonly<Record<Kind, (value: unknown) => boolean>>;

const KIND_WORDS = { count: "a positive whole number", flag: "true or false" } as const satisfies Readonly<Record<Kind, string>>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const isLimitName = (name: string): name is keyof Limits => Object.hasOwn(LIMIT_KINDS, name);

// Checks one limit entry and returns it as a pair, or throws a message that names the path.
function limitEntry(path: string, name: string, value: unknown): readonly [keyof Limits, number | boolean] {
  if (!isLimitName(name)) throw new ConfigError(`${path}.${name} is not a limit`);
  const kind = LIMIT_KINDS[name];
  if (!KIND_TESTS[kind](value)) throw new ConfigError(`${path}.${name} must be ${KIND_WORDS[kind]}`);
  return [name, value as number | boolean]; // KIND_TESTS has just checked the type that the kind names
}

function readLimits(path: string, raw: unknown): Partial<Limits> {
  if (raw === undefined) return {};
  if (!isRecord(raw)) throw new ConfigError(`${path} must be an object`);
  return Object.fromEntries(Object.entries(raw).map(([name, value]) => limitEntry(path, name, value)));
}

function readStrings(path: string, raw: unknown): readonly string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) throw new ConfigError(`${path} must be a list of strings`);
  return raw;
}

function readProfile(name: string, raw: unknown): Profile {
  const path = `profiles.${name}`;
  if (!isRecord(raw)) throw new ConfigError(`${path} must be an object`);
  const description = raw["description"];
  if (typeof description !== "string") throw new ConfigError(`${path}.description must be a string`);
  return {
    description,
    knows: readStrings(`${path}.knows`, raw["knows"]),
    doesNotKnow: readStrings(`${path}.doesNotKnow`, raw["doesNotKnow"]),
    limits: readLimits(`${path}.limits`, raw["limits"]),
  };
}

function readProfiles(raw: unknown): Readonly<Record<string, Profile>> {
  if (raw === undefined) return {};
  if (!isRecord(raw)) throw new ConfigError("profiles must be an object");
  return Object.fromEntries(Object.entries(raw).map(([name, value]) => [name, readProfile(name, value)]));
}

// The keys that a config file may have. The schema says the same, with additionalProperties false.
const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(["$schema", "profile", "verify", "limits", "profiles"]);

const VERIFY_KEYS: ReadonlySet<string> = new Set(["enabled", "maxRounds"]);

function readVerify(raw: unknown): Verify {
  if (raw === undefined) return DEFAULT_VERIFY;
  if (!isRecord(raw)) throw new ConfigError("verify must be an object");
  const stray = Object.keys(raw).find((key) => !VERIFY_KEYS.has(key));
  if (stray !== undefined) throw new ConfigError(`verify.${stray} is not a verify setting (allowed: ${[...VERIFY_KEYS].join(", ")})`);
  const enabled = raw["enabled"] ?? DEFAULT_VERIFY.enabled;
  const rounds = raw["maxRounds"] ?? DEFAULT_VERIFY.maxRounds;
  if (typeof enabled !== "boolean") throw new ConfigError("verify.enabled must be true or false");
  if (!KIND_TESTS.count(rounds)) throw new ConfigError("verify.maxRounds must be a positive whole number");
  return { enabled, maxRounds: rounds as number }; // KIND_TESTS.count has just checked the type
}

// Turns parsed JSON into a config. Limits layer in this order: the built-in defaults, the file's limits, the chosen profile's limits.
// A profile name from the command line (`chosenName`) wins over the file's own `profile`.
// A profile must be a key of `profiles`. With no profiles table, only the default profile is known.
export function resolveConfig(raw: unknown, chosenName?: string): Config {
  if (!isRecord(raw)) throw new ConfigError("the config must be a JSON object");
  const stray = Object.keys(raw).find((key) => !TOP_LEVEL_KEYS.has(key));
  if (stray !== undefined) throw new ConfigError(`${stray} is not a config key (allowed: ${[...TOP_LEVEL_KEYS].join(", ")})`);
  const profiles = readProfiles(raw["profiles"]);
  const chosen = chosenName ?? raw["profile"] ?? DEFAULT_PROFILE;
  if (typeof chosen !== "string") throw new ConfigError("profile must be a string");
  const known = Object.keys(profiles);
  const isKnown = known.length ? known.includes(chosen) : chosen === DEFAULT_PROFILE;
  if (!isKnown) throw new ConfigError(`profile "${chosen}" is not defined: profiles holds ${known.length ? known.join(", ") : "nothing"}`);
  const own = profiles[chosen]?.limits ?? {};
  return { profile: chosen, profiles, verify: readVerify(raw["verify"]), limits: { ...DEFAULT_LIMITS, ...readLimits("limits", raw["limits"]), ...own } };
}
