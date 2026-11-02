import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cli, configFile, json, read, ROOT } from "./helpers.ts";

const EXIT = { ok: 0, hard: 1, usage: 2 } as const;
const CIRCULAR_FAIL = "testdata/rules/circular-definition.fail.md";
const DISABLE = "--disable";
const CONFIG = "--config";
const GOOD = read("testdata/rules/no-example.pass.md");
const WARN_ONLY = `${read("testdata/rules/analogy-without-limit.fail.md")}\n\`\`\`\nx\n\`\`\`\n`;

test("exit codes: 0 for clean text, 0 for warnings only, 1 for a hard failure", () => {
  assert.equal(cli([], GOOD).code, EXIT.ok);
  assert.equal(cli([], WARN_ONLY).code, EXIT.ok);
  assert.ok(json([], WARN_ONLY).warn_count >= 1);
  assert.equal(cli([], read(CIRCULAR_FAIL)).code, EXIT.hard);
});

test("--json has the documented shape", () => {
  const report = json([], read(CIRCULAR_FAIL));
  assert.deepEqual(Object.keys(report).sort(), ["count", "findings", "hard_count", "limits", "profile", "warn_count"]);
  assert.equal(report.count, report.findings.length);
  assert.equal(report.hard_count + report.warn_count, report.count);
  const [first] = report.findings;
  assert.deepEqual(Object.keys(first ?? {}).sort(), ["check", "col", "file", "level", "line", "match", "message"]);
  assert.equal(first?.file, "<stdin>");
});

test("--disable turns a check off", () => {
  const text = read(CIRCULAR_FAIL);
  assert.equal(cli([DISABLE, "circular-definition,no-example"], text).code, EXIT.ok);
  assert.ok(!json([DISABLE, "term-before-definition"], text).findings.some((finding) => finding.check === "term-before-definition"));
});

test("files are read and named in the report", () => {
  const dir = mkdtempSync(join(tmpdir(), "greenhorn-"));
  const [a, b] = [join(dir, "a.md"), join(dir, "b.md")] as const;
  writeFileSync(a, "No example here.\n");
  writeFileSync(b, GOOD);
  const result = cli([a, b]);
  assert.equal(result.code, EXIT.hard);
  assert.ok(result.out.includes(`${a}:1:1: hard no-example`), result.out);
  assert.ok(!result.out.includes(b), result.out);
});

const BAD_ARGUMENTS: readonly (readonly string[])[] = [["--nope"], [CONFIG], [DISABLE], [DISABLE, "nope"], [CONFIG, "/no/such/file.json"], ["/no/such/file.md"]];

test("usage errors exit 2 with a message", () => {
  BAD_ARGUMENTS.forEach((args) => {
    const result = cli(args);
    assert.equal(result.code, EXIT.usage, args.join(" "));
    assert.ok(result.err, args.join(" "));
  });
});

const BAD_CONFIGS: readonly (readonly [unknown, string])[] = [
  [[], "must be a JSON object"],
  [{ limits: { maxTerms: 0 } }, "limits.maxTerms must be a positive whole number"],
  [{ limits: { requireExample: "yes" } }, "limits.requireExample must be true or false"],
  [{ limits: { surprise: 1 } }, "limits.surprise is not a limit"],
  [{ profile: "missing", profiles: { a: { description: "x" } } }, "is not defined"],
  [{ profiles: { a: {} } }, "profiles.a.description must be a string"],
  [{ verify: [] }, "verify must be an object"],
  [{ verify: { enabled: "yes" } }, "verify.enabled must be true or false"],
  [{ verify: { maxRounds: 0 } }, "verify.maxRounds must be a positive whole number"],
  [{ verify: { rounds: 1 } }, "verify.rounds is not a verify setting"],
];

test("a bad config exits 2 and says which field is wrong", () => {
  BAD_CONFIGS.forEach(([content, piece]) => {
    const result = cli([CONFIG, configFile(content)], GOOD);
    assert.equal(result.code, EXIT.usage, piece);
    assert.ok(result.err.includes(piece), result.err);
  });
});

test("the entry point runs through a symlinked path", () => {
  const link = join(mkdtempSync(join(tmpdir(), "greenhorn-link-")), "scripts");
  symlinkSync(join(ROOT, "scripts"), link);
  const result = spawnSync("node", [join(link, "check-text.ts"), "--json"], { input: "No example here.\n", encoding: "utf8", cwd: tmpdir() });
  assert.equal(result.status, EXIT.hard, result.stderr);
  assert.ok(result.stdout.includes('"no-example"'), result.stdout);
});

const EQ = "=";
const PROFILE = "--profile";
const NEW_HIRE = "new-hire";
const NO_EXAMPLE = "no-example";
const CIRCULAR = "circular-definition";
const PROFILES = { fast: { description: "a fast reader" }, slow: { description: "a slow reader", limits: { maxTerms: 1 } } };

test("--disable accumulates over several flags and trims each id", () => {
  const text = read(CIRCULAR_FAIL);
  assert.equal(cli([DISABLE, CIRCULAR, DISABLE, NO_EXAMPLE], text).code, EXIT.ok);
  assert.equal(cli([DISABLE, ` ${CIRCULAR} , ${NO_EXAMPLE} `], text).code, EXIT.ok);
});

test("--disable and --config accept the --name=value form", () => {
  const text = read(CIRCULAR_FAIL);
  assert.equal(cli([`${DISABLE}${EQ}${CIRCULAR},${NO_EXAMPLE}`], text).code, EXIT.ok);
  const result = cli(["--json", `${CONFIG}${EQ}${configFile({ profile: "fast", profiles: PROFILES })}`], GOOD);
  assert.equal(result.code, EXIT.ok);
  assert.equal(JSON.parse(result.out).profile, "fast");
});

test("-- ends the flags, so a file may be named like a flag", () => {
  const result = cli(["--", "--json"]);
  assert.equal(result.code, EXIT.usage);
  assert.ok(result.err.includes("--json"), result.err);
  assert.ok(!result.err.includes("unknown flag"), result.err);
});

test("--disable with no id is a usage error", () => {
  [[DISABLE, ""], [`${DISABLE}${EQ}`], [DISABLE, " , "]].forEach((args) => {
    const result = cli(args, GOOD);
    assert.equal(result.code, EXIT.usage, args.join(" "));
    assert.ok(result.err.includes("at least one check id"), result.err);
  });
});

test("a directory argument is a clear usage error, not a raw EISDIR", () => {
  const result = cli([mkdtempSync(join(tmpdir(), "greenhorn-dir-"))]);
  assert.equal(result.code, EXIT.usage);
  assert.ok(result.err.includes("is a directory"), result.err);
  assert.ok(!result.err.includes("EISDIR"), result.err);
});

test("--profile picks a profile of the config, and its limits apply", () => {
  const path = configFile({ profiles: PROFILES });
  const report = JSON.parse(cli(["--json", CONFIG, path, PROFILE, "slow"], GOOD).out);
  assert.equal(report.profile, "slow");
  assert.equal(report.limits.maxTerms, 1);
  assert.equal(JSON.parse(cli(["--json", CONFIG, path, `${PROFILE}${EQ}fast`], GOOD).out).profile, "fast");
});

test("--profile with a name that no profiles table defines is a usage error", () => {
  const withTable = cli([CONFIG, configFile({ profiles: PROFILES }), PROFILE, "nope"], GOOD);
  assert.equal(withTable.code, EXIT.usage);
  assert.ok(withTable.err.includes('profile "nope"'), withTable.err);
  const noTable = cli([PROFILE, NEW_HIRE], GOOD);
  assert.equal(noTable.code, EXIT.usage);
  assert.ok(noTable.err.includes(`profile "${NEW_HIRE}"`), noTable.err);
});

test("the profile of the example config loads by name", () => {
  const report = JSON.parse(cli(["--json", CONFIG, join(ROOT, "greenhorn.config.example.json"), PROFILE, NEW_HIRE], GOOD).out);
  assert.equal(report.profile, NEW_HIRE);
});

test("a config with an unknown profile and no profiles table, or an unknown top-level key, exits 2", () => {
  const unknownProfile = cli([CONFIG, configFile({ profile: "ghost" })], GOOD);
  assert.equal(unknownProfile.code, EXIT.usage);
  assert.ok(unknownProfile.err.includes('profile "ghost"'), unknownProfile.err);
  const unknownKey = cli([CONFIG, configFile({ limitz: {} })], GOOD);
  assert.equal(unknownKey.code, EXIT.usage);
  assert.ok(unknownKey.err.includes("limitz is not a config key"), unknownKey.err);
  assert.equal(cli([CONFIG, configFile({ $schema: "./schema/greenhorn.schema.json" })], GOOD).code, EXIT.ok);
});

test("a valid verify block is accepted", () => {
  assert.equal(cli([CONFIG, configFile({ verify: { enabled: false, maxRounds: 2 } })], GOOD).code, EXIT.ok);
});
