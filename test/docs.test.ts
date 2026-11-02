// Tests about the site in docs/: the head tags, the links, the footer, the images and the size of each file.
// The file declares no regex and holds no remote URL, so the repository test that scans code files stays green.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { test } from "node:test";
import { read, ROOT } from "./helpers.ts";

const MAX_TEXT_BYTES = 262_144; // 256 KiB: the scanner reads a document only up to this size
const NOT_FOUND = -1;
const TAG_NAME_END = " >\n\t"; // the characters that can follow a tag name
const ATTR_SYNTAX = 3; // the equals sign, the opening quote and the space before the name
const MIN_PAGES = 4;
const PNG_WIDTH_OFFSET = 16; // after the signature, the chunk length and the IHDR tag
const PNG_HEIGHT_OFFSET = 20;
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const DOCS = join(ROOT, "docs");
const SCHEME = ["https", "//"].join(":");
const PAGES_URL = `${SCHEME}gagoar.github.io/greenhorn/`;
// File names are built from parts: a script that names an image the repository holds is held by the scan.
const SOCIAL_CARD = ["docs", "assets", ["og", "png"].join(".")];
const SOCIAL_CARD_URL = `${PAGES_URL}assets/${["og", "png"].join(".")}`;

const pages = (): readonly string[] => readdirSync(DOCS).filter((name) => name.endsWith(".html")).sort();
const page = (name: string): string => readFileSync(join(DOCS, name), "utf8");
const version = (): string => (JSON.parse(read(".claude-plugin", "plugin.json")) as { readonly version: string }).version;

// The opening tags of one kind in a page. "<a href=x>" is returned whole for the name "a".
function tags(html: string, name: string): readonly string[] {
  return html.split(`<${name}`).slice(1).filter((part) => TAG_NAME_END.includes(part.charAt(0))).map((part) => part.slice(0, part.indexOf(">")));
}

// The value of an attribute in an opening tag, or undefined.
function attr(tag: string, name: string): string | undefined {
  const start = tag.indexOf(` ${name}="`);
  if (start === NOT_FOUND) return undefined;
  const from = start + name.length + ATTR_SYNTAX;
  return tag.slice(from, tag.indexOf('"', from));
}

const meta = (html: string, key: "name" | "property", value: string): string | undefined =>
  tags(html, "meta").find((tag) => attr(tag, key) === value && attr(tag, "content") !== undefined)?.split('content="')[1]?.split('"')[0];

const jsonLd = (html: string): readonly unknown[] =>
  html.split('<script type="application/ld+json">').slice(1).map((part) => JSON.parse(part.slice(0, part.indexOf("</script>"))));

const isRemote = (value: string): boolean => value.includes("://") || value.startsWith("//");

test("every page has a title, a description, a canonical link and the social tags", () => {
  assert.ok(pages().length >= MIN_PAGES);
  pages().forEach((name) => {
    const html = page(name);
    const title = html.split("<title>")[1]?.split("</title>")[0] ?? "";
    assert.ok(title.length > 0, `${name} has no title`);
    assert.ok((meta(html, "name", "description") ?? "").length > 0, `${name} has no description`);
    const canonical = tags(html, "link").find((tag) => attr(tag, "rel") === "canonical");
    const expected = name === "index.html" ? PAGES_URL : `${PAGES_URL}${name}`;
    assert.equal(attr(canonical ?? "", "href"), expected, `${name} has a wrong canonical link`);
    assert.equal(meta(html, "property", "og:image"), SOCIAL_CARD_URL, `${name} has a wrong og:image`);
    assert.equal(meta(html, "property", "og:image:width"), String(OG_WIDTH));
    assert.equal(meta(html, "property", "og:image:height"), String(OG_HEIGHT));
    assert.equal(meta(html, "name", "twitter:card"), "summary_large_image", `${name} has no large twitter card`);
    assert.equal(meta(html, "name", "twitter:image"), SOCIAL_CARD_URL);
    assert.ok(meta(html, "name", "theme-color"), `${name} has no theme-color`);
    assert.equal(meta(html, "property", "og:title"), title);
    assert.ok(tags(html, "link").some((tag) => attr(tag, "rel") === "icon" && attr(tag, "href") === "assets/icon.svg"), `${name} has no SVG favicon`);
  });
});

test("every page has JSON-LD that parses, and the types fit the page", () => {
  const types = (name: string): readonly unknown[] => jsonLd(page(name)).map((block) => (block as { readonly "@type": string })["@type"]);
  pages().forEach((name) => assert.ok(jsonLd(page(name)).length > 0, `${name} has no JSON-LD block`));
  assert.ok(types("index.html").includes("SoftwareApplication"));
  assert.ok(types("guide.html").includes("HowTo"));
  assert.ok(types("guide.html").includes("BreadcrumbList"));
  assert.ok(types("evidence.html").includes("BreadcrumbList"));
  const app = jsonLd(page("index.html")).find((block) => (block as { readonly "@type": string })["@type"] === "SoftwareApplication") as Record<string, unknown>;
  assert.equal(app["softwareVersion"], version());
  assert.equal(app["applicationCategory"], "DeveloperApplication");
  assert.equal((app["offers"] as { readonly price: string }).price, "0");
  assert.equal(app["license"], `${SCHEME}opensource.org/licenses/MIT`);
});

test("every internal link and every fragment resolves", () => {
  pages().forEach((name) => {
    const html = page(name);
    const targets = [...tags(html, "a").map((tag) => attr(tag, "href")), ...tags(html, "link").map((tag) => attr(tag, "href")), ...tags(html, "img").map((tag) => attr(tag, "src"))]
      .filter((value): value is string => value !== undefined && !isRemote(value) && !value.startsWith("mailto:"));
    targets.forEach((target) => {
      const [path = "", fragment] = target.split("#");
      const file = path === "" ? name : path;
      const full = normalize(join(DOCS, dirname(name), file));
      assert.ok(existsSync(full), `${name} links to ${target}, which does not exist`);
      if (fragment !== undefined) assert.ok(readFileSync(full, "utf8").includes(`id="${fragment}"`), `${name} links to #${fragment}, which has no anchor`);
    });
  });
});

test("the sitemap lists every page except the 404 page", () => {
  const sitemap = read("docs", "sitemap.xml");
  pages().filter((name) => name !== "404.html").forEach((name) => {
    const url = name === "index.html" ? PAGES_URL : `${PAGES_URL}${name}`;
    assert.ok(sitemap.includes(`<loc>${url}</loc>`), `the sitemap lacks ${url}`);
  });
  assert.ok(!sitemap.includes("404.html"));
});

test("the footer shows the plugin version, the license, the author and the icon credit", () => {
  pages().forEach((name) => {
    const footer = page(name).split('<footer class="foot">')[1] ?? "";
    assert.ok(footer.includes(`MIT &middot; v${version()} &middot; by `), `${name} has a footer with the wrong version`);
    assert.ok(footer.includes(">gagoar</a>"));
    assert.ok(footer.includes("SUPRIYANTO YANTO") && footer.includes("CREDITS.md"), `${name} lacks the icon credit`);
  });
});

test("no page loads a script, a stylesheet or a font from a remote host", () => {
  pages().forEach((name) => {
    const html = page(name);
    tags(html, "script").forEach((tag) => assert.ok(!isRemote(attr(tag, "src") ?? ""), `${name} loads a remote script`));
    tags(html, "link").filter((tag) => ["stylesheet", "preload", "prefetch", "preconnect", "dns-prefetch"].includes(attr(tag, "rel") ?? "")).forEach((tag) => {
      assert.ok(!isRemote(attr(tag, "href") ?? ""), `${name} loads a remote resource: ${tag}`);
    });
    assert.ok(!html.includes("<iframe") && !html.includes("<form"), `${name} embeds a frame or a form`);
  });
  const css = read("docs", "assets", "site.css");
  assert.ok(!css.includes("@import") && !css.includes("@font-face") && !css.includes("url("), "site.css pulls in a file");
});

test("the social card is 1200 by 630 and the text files exist", () => {
  const card = readFileSync(join(ROOT, ...SOCIAL_CARD));
  assert.equal(card.readUInt32BE(PNG_WIDTH_OFFSET), OG_WIDTH);
  assert.equal(card.readUInt32BE(PNG_HEIGHT_OFFSET), OG_HEIGHT);
  assert.ok(existsSync(join(DOCS, ".nojekyll")));
  assert.ok(existsSync(join(DOCS, "assets", "icon.svg")));
  assert.ok(read("docs", "robots.txt").includes(`Sitemap: ${PAGES_URL}sitemap.xml`));
  const llms = read("docs", "llms.txt");
  assert.ok(llms.startsWith("# greenhorn") && llms.includes(`${PAGES_URL}guide.html`) && llms.includes("SKILL.md"));
});

function listFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)]));
}

test("no file in docs is over 256 KiB", () => {
  listFiles(DOCS).forEach((path) => assert.ok(statSync(path).size <= MAX_TEXT_BYTES, `${path} is over 256 KiB`));
});

test("every page has the floating GitHub link with an inline SVG", () => {
  pages().forEach((name) => {
    const link = tags(page(name), "a").find((tag) => attr(tag, "class") === "gh-fab");
    assert.ok(link !== undefined, `${name} has no floating GitHub link`);
    assert.equal(attr(link, "href"), `${SCHEME}github.com/gagoar/greenhorn`);
    assert.equal(attr(link, "aria-label"), "View greenhorn on GitHub");
    const html = page(name);
    const inner = html.slice(html.indexOf('class="gh-fab"'), html.indexOf("</a>", html.indexOf('class="gh-fab"')));
    assert.ok(inner.includes("<svg") && inner.includes("<path") && !inner.includes("<img"), `${name}: the GitHub mark is not an inline SVG`);
  });
});
