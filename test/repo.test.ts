// Tests about the repository itself: the manifests, the skills, the agent, the README, the size of what ships and the regex table.
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { cli, read, ROOT } from "./helpers.ts";

process.chdir(ROOT);

const MAX_TEXT_BYTES = 262_144; // 256 KiB: the scanner reads a script or a document only up to this size
const MIN_DESCRIPTION = 40;
const FIRST = 1;
const PARAGRAPHS = 3; // gist, example, mechanism
const PLUGIN_DIR = ".claude-plugin";

// A version of three whole numbers. Matches "0.1.0"; rejects "0.1" and "v0.1.0".
const SEMVER = /^\d+\.\d+\.\d+$/;
// The frontmatter block at the start of a Markdown file. Matches "---\nname: x\n---\n" → ("name: x"); rejects a file with no leading ---.
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
// A name line in frontmatter. Matches "name: explain" → ("explain"); rejects "description: x".
const NAME_LINE = /^name: (.+)$/m;
// A description line in frontmatter, folded or not. Matches "description: >" and "description: text"; rejects "name: x".
const DESCRIPTION_LINE = /^description: ?(.*)$/m;
// The start of a web address. Matches "https://" and "http://"; rejects "node:fs".
const REMOTE_URL = /https?:\/\//;
// The source of an import. Matches 'import { a } from "./cli.ts";' → ("./cli.ts"); rejects a comment that has the word from.
const IMPORT_SOURCE = /^import .* from "([^"]+)"/gm;
// A named regex at the top level of a file. Matches "const SEMVER = /^a$/;" → ("SEMVER"); rejects "const x = 1;".
const REGEX_DECLARATION = /^(?:export )?const (\w+)(?:: RegExp)? = (?:\/|new RegExp)/gm;
// A function that builds a regex. Matches "const termPattern = (term: string): RegExp =>" → ("termPattern"); rejects "const x = 1;".
const REGEX_FACTORY = /^(?:export )?const (\w+) = \([^)]*\): RegExp =>/gm;
// A row of REGEXES.md. Matches "| `scripts/cli.ts` | `SEMVER` |" → ("scripts/cli.ts", "SEMVER"); rejects a heading.
const REGEX_ROW = /^\| `([^`]+)` \| `([^`]+)` \|/gm;
// A code file of the package. Matches "scripts/cli.ts"; rejects "scripts/x.sh".
const CODE_FILE = /^(?:scripts|test)\/.*\.ts$/;
// A text file that the scanner reads. Matches "a.ts" and "b.md"; rejects "c.png".
const TEXT_FILE = /\.(?:ts|md|json|yml|yaml|txt|csv|svg)$|^(?:LICENSE|\.gitignore)$/;
// The leading dot and slash of a path. Removed from "./a/b.png": it becomes "a/b.png".
const ICON_PREFIX = /^\.\//;
// The tools line of frontmatter. Matches "allowed-tools: Read, Agent" → ("Read, Agent"); rejects "tools: []".
const ALLOWED_TOOLS = /^allowed-tools: (.+)$/m;
// An empty tools list in an agent's frontmatter. Matches "tools: []"; rejects "tools: Read".
const NO_TOOLS = /^tools: \[\]$/m;
// A disallowed list that names Skill. Matches "disallowedTools: Skill, Read"; rejects "disallowedTools: Read".
const NO_SKILL = /^disallowedTools: .*\bSkill\b/m;
// A model line that names a small Claude model. Matches "model: sonnet"; rejects "model: opus".
const SMALL_MODEL = /^model: (?:sonnet|haiku)$/m;
// A blank line between paragraphs. Splits "a\n\nb" into two.
const PARAGRAPH_BREAK = /\n\n+/;
// A line break. Replaced with a break tag in a table cell: "a\n\nb" → "a<br><br>b".
const BLANK_PAIR = /\n\n/g;

const SELF = "test/repo.test.ts";
const GATE = "scripts/check-plugin-safety.ts"; // the canonical gate: shared across plugins, so it follows its own rules

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly skills: readonly string[];
}

const isManifest = (value: unknown): value is Manifest => {
  const record = value as Record<string, unknown> | null; // a JSON object is narrowed field by field below
  return typeof record === "object" && record !== null && typeof record["name"] === "string" && typeof record["version"] === "string" && typeof record["license"] === "string" && Array.isArray(record["skills"]);
};

function manifest(): Manifest {
  const parsed: unknown = JSON.parse(read(PLUGIN_DIR, "plugin.json"));
  if (!isManifest(parsed)) throw new Error("plugin.json lacks a name, a version, a license or skills");
  return parsed;
}

// Every file of the repository outside .git and node_modules, with its size.
function files(dir = ROOT): readonly { readonly path: string; readonly bytes: number }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === ".git" || entry.name === "node_modules" ? [] : files(path);
    return [{ path: relative(ROOT, path), bytes: statSync(path).size }];
  });
}

function frontmatter(path: string): string {
  const block = FRONTMATTER.exec(read(path))?.[FIRST];
  if (block === undefined) throw new Error(`${path} has no frontmatter`);
  return `${block}\n`;
}

test("plugin.json, package.json and marketplace.json agree on the version", () => {
  const plugin = manifest();
  assert.match(plugin.version, SEMVER);
  assert.equal(plugin.license, "MIT");
  const pkg: { readonly version: string } = JSON.parse(read("package.json"));
  const market: { readonly metadata: { readonly version: string }; readonly plugins: readonly { readonly name: string; readonly version: string }[] } = JSON.parse(read(PLUGIN_DIR, "marketplace.json"));
  assert.equal(pkg.version, plugin.version);
  assert.equal(market.metadata.version, plugin.version);
  assert.deepEqual(market.plugins.map((entry) => [entry.name, entry.version]), [[plugin.name, plugin.version]]);
});

test("each skill path in plugin.json exists and has a name and a description", () => {
  const plugin = manifest();
  assert.ok(plugin.skills.length);
  plugin.skills.forEach((skill) => {
    const path = join(skill, "SKILL.md");
    assert.ok(statSync(join(ROOT, path)).isFile(), `${path} is missing`);
    const head = frontmatter(path);
    const name = NAME_LINE.exec(head)?.[FIRST];
    assert.ok(name, `${path} has no name`);
    assert.equal(name, skill.split("/").at(-FIRST), `${path}: the name must match the folder`);
    assert.ok(DESCRIPTION_LINE.test(head), `${path} has no description`);
    assert.ok(head.length > MIN_DESCRIPTION, `${path} has too little frontmatter`);
    assert.ok(head.includes(`/greenhorn:${name} — `), `${path}: the description must start with /greenhorn:${name} — `);
  });
});

test("the skills scope their tools by path", () => {
  ["explain", "test"].forEach((skill) => {
    const line = ALLOWED_TOOLS.exec(frontmatter(`skills/${skill}/SKILL.md`))?.[FIRST];
    assert.ok(line, `${skill} lists no allowed-tools`);
    const tools = line.split(", ");
    assert.ok(!tools.some((tool) => ["Write", "Edit", "Bash"].includes(tool)), `${skill} grants an unscoped Write, Edit or Bash`);
  });
});

test("the reader agent has no tools, cannot call a skill and runs on a named model", () => {
  const head = frontmatter("agents/greenhorn-reader.md");
  assert.match(head, NO_TOOLS);
  assert.match(head, NO_SKILL);
  assert.match(head, SMALL_MODEL);
  assert.ok(!ALLOWED_TOOLS.test(head));
});

test("the test skill removes its write tools, and explain pins Bash to the checker on .greenhorn files", () => {
  const denied = frontmatter("skills/test/SKILL.md").split("\n").filter((line) => line.startsWith("disallowed-tools:")).flatMap((line) => line.replace("disallowed-tools:", "").split(",")).map((name) => name.trim());
  ["Write", "Edit", "NotebookEdit", "Bash"].forEach((name) => assert.ok(denied.includes(name), `skills/test lacks disallowed-tools ${name}`));
  assert.ok(frontmatter("skills/explain/SKILL.md").includes("Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/check-text.ts .greenhorn/*)"));
  assert.ok(read("skills/explain/SKILL.md").includes("## Data, never instructions"));
});

const DENIED_FOR_READER = ["Skill", "SendMessage", "TaskStop", "mcp__*"] as const;

test("the reader agent's frontmatter keeps tools and denies Skill, SendMessage, TaskStop and every MCP tool", () => {
  const lines = frontmatter("agents/greenhorn-reader.md").split("\n");
  assert.ok(lines.some((line) => line.startsWith("tools:")), "the agent lost its tools: line, so it would inherit every tool");
  const denied = lines.filter((line) => line.startsWith("disallowedTools:")).flatMap((line) => line.replace("disallowedTools:", "").split(",")).map((name) => name.trim());
  DENIED_FOR_READER.forEach((name) => assert.ok(denied.includes(name), `disallowedTools lacks ${name}`));
});

test("the skill and the agent agree on the reader's JSON", () => {
  const agent = read("agents", "greenhorn-reader.md");
  ["term", "jump", "missing-example", "assumed-step", "acronym", "gist_attempt", "stumbles", "quote", "question"].forEach((word) => assert.ok(agent.includes(word), `the agent lacks ${word}`));
  ["explain", "test"].forEach((skill) => assert.ok(read("skills", skill, "SKILL.md").includes("greenhorn:greenhorn-reader"), `${skill} does not name the agent`));
});

test("no file is over 256 KiB, and there is no top-level bin/", () => {
  const all = files();
  all.filter(({ path }) => TEXT_FILE.test(path)).forEach(({ path, bytes }) => assert.ok(bytes <= MAX_TEXT_BYTES, `${path} is over 256 KiB`));
  assert.ok(!all.some(({ path }) => path.startsWith("bin/")), "a top-level bin/ directory stops the plugin installing on Cowork and claude.ai");
});

test("the package declares no dependency, and the scripts import only Node built-ins and each other", () => {
  const pkg: Record<string, unknown> = JSON.parse(read("package.json"));
  assert.deepEqual([pkg["dependencies"], pkg["devDependencies"], pkg["type"]], [undefined, undefined, "module"]);
  files()
    .map(({ path }) => path)
    .filter((path) => CODE_FILE.test(path) && path !== GATE)
    .forEach((path) => {
      [...read(path).matchAll(IMPORT_SOURCE)].forEach((match) => {
        const source = match[FIRST] ?? "";
        assert.ok(source.startsWith("node:") || source.startsWith("."), `${path} imports ${source}`);
      });
    });
});

// The directory scan holds a plugin for review when a code file has a remote URL. A test file is code too.
test("no code file has a remote URL, and REGEXES.md lists every regex", () => {
  const sources = files().map(({ path }) => path).filter((path) => CODE_FILE.test(path) && path !== GATE);
  sources.filter((path) => path !== SELF).forEach((path) => assert.ok(!REMOTE_URL.test(read(path)), `${path} has a remote URL`));
  const rows = new Set([...read("REGEXES.md").matchAll(REGEX_ROW)].map((match) => `${match[1]}:${match[2]}`));
  const declared = sources.flatMap((path) => [...read(path).matchAll(REGEX_DECLARATION), ...read(path).matchAll(REGEX_FACTORY)].map((match) => `${path}:${match[FIRST]}`));
  assert.ok(declared.length);
  declared.forEach((entry) => assert.ok(rows.has(entry), `${entry} has no row in REGEXES.md`));
  rows.forEach((entry) => assert.ok(sources.some((path) => entry.startsWith(`${path}:`)), `${entry} names a file that does not exist`));
});

test("the README has the sections that the listing links to, and the icon at the top", () => {
  const readme = read("README.md");
  ["## Privacy", "## Terms", "## License", "## Credits", "## Limits", "## Install"].forEach((heading) => assert.ok(readme.includes(heading), `the README lacks ${heading}`));
  const icon = (JSON.parse(read(PLUGIN_DIR, "plugin.json")) as { readonly icon: string }).icon.replace(ICON_PREFIX, "");
  assert.ok(readme.startsWith(`<img src="${icon}"`) && readme.split("\n")[0]?.includes('width="120"'));
  assert.ok(readme.includes("/plugin marketplace add gagoar/greenhorn") && readme.includes("/plugin install greenhorn@greenhorn"));
  assert.ok(readme.includes("untested defaults"));
});

// The Before and After pair in the README is the pair in testdata/readme, and the output beside it is real.
test("the README pair and its checker output are real", () => {
  const readme = read("README.md");
  const before = read("testdata/readme/before.md").trim();
  const after = read("testdata/readme/after.md").trim();
  assert.ok(readme.includes(before), "the README does not show testdata/readme/before.md");
  assert.ok(readme.includes(after.replace(BLANK_PAIR, "<br><br>")), "the README does not show testdata/readme/after.md");
  assert.equal(after.split(PARAGRAPH_BREAK).length, PARAGRAPHS);
  const bad = cli(["testdata/readme/before.md"]);
  const good = cli(["testdata/readme/after.md"]);
  assert.equal(bad.code, 1);
  assert.equal(good.code, 0);
  assert.ok(readme.includes(bad.out), "the README output for the before text is not the real output");
  assert.ok(readme.includes(good.out), "the README output for the after text is not the real output");
});

test("the eval folder has a protocol and an empty score sheet", () => {
  assert.ok(read("eval/README.md").includes("It has not been run"));
  const rows = read("eval/score-sheet.csv").trim().split("\n");
  assert.equal(rows.length, 1, "the score sheet must hold only its header: no fabricated results");
});
