# Regular expressions

Every regular expression in the code has a comment with an example. This page has one row for each of them.
A test checks that each regex has a row here. There is no tester link: the directory scan holds a plugin for review when a code file has a remote URL.

| File | Name | What it matches |
|---|---|---|
| `scripts/document.ts` | `NEWLINE` | A line break: `"a\r\nb"` splits into two lines |
| `scripts/document.ts` | `FENCE_LINE` | A fence line: "```ts" and "~~~~" match with their mark and info text, "``x``" does not |
| `scripts/document.ts` | `BLOCK_START` | A line that starts a block (list item, heading, quote, table row), so it does not join the line before |
| `scripts/document.ts` | `BOLD_COLON` | `- **Stumble**: a spot where a reader stops` gives the term and the body |
| `scripts/document.ts` | `INLINE_DEFINITION` | `A **cache** is a store that keeps copies` gives the term and the body |
| `scripts/document.ts` | `LOWER_DEFINITION` | `A cache is a store that keeps copies` with a lowercase term, only at the start of a sentence |
| `scripts/document.ts` | `TERM_MARKS` | The bold and code marks around a term |
| `scripts/document.ts` | `WHITESPACE` | Space between words |
| `scripts/document.ts` | `SENTENCE_END` | The gap after a full stop, a question mark or an exclamation mark |
| `scripts/document.ts` | `PATTERN_SPECIAL` | Characters with a meaning in a pattern, so that a term can be escaped |
| `scripts/document.ts` | `termPattern` | A term as a whole word: "cache" matches "the cache fills", not "cached" |
| `scripts/checks.ts` | `EXAMPLE_MARKER` | A line that starts with "Example", "For example" or "e.g.", and the text after the marker |
| `scripts/checks.ts` | `MARKER_FILLER` | Marks and spaces between an example word and its content |
| `scripts/checks.ts` | `BEFORE_LABEL` | A line that is a Before label: "Before:", "**Before**" or "## Before", not the prose "Before the change" |
| `scripts/checks.ts` | `AFTER_LABEL` | A line that is an After label: "After:", "**After**" or "## After", not the prose "After a while" |
| `scripts/checks.ts` | `BEFORE_AFTER_HEADER` | A table header row `\| Before \| After \|` |
| `scripts/checks.ts` | `ANALOGY` | "like a", "is like", "think of ... as" |
| `scripts/checks.ts` | `ANALOGY_LIMIT` | "unlike", "differs from", "breaks down", "the difference is" |
| `scripts/checks.ts` | `ANALOGY_BUT_NOT` | "but ... not" in the analogy sentence or the next one, unless "not" is followed by "like" |
| `scripts/checks.ts` | `NAME_CANDIDATE` | A code-font name, a CamelCase name or an all-capitals word |
| `scripts/checks.ts` | `BACKTICK` | A backtick |
| `test/repo.test.ts` | `SEMVER` | A version of three whole numbers |
| `test/repo.test.ts` | `FRONTMATTER` | The frontmatter block at the start of a Markdown file |
| `test/repo.test.ts` | `NAME_LINE` | The `name:` line of frontmatter |
| `test/repo.test.ts` | `DESCRIPTION_LINE` | The `description:` line of frontmatter |
| `test/repo.test.ts` | `REMOTE_URL` | The start of a web address |
| `test/repo.test.ts` | `IMPORT_SOURCE` | The source of an import line |
| `test/repo.test.ts` | `REGEX_DECLARATION` | A named regex at the top level of a file |
| `test/repo.test.ts` | `REGEX_FACTORY` | A function that returns a regex |
| `test/repo.test.ts` | `REGEX_ROW` | A row of this table |
| `test/repo.test.ts` | `CODE_FILE` | A `.ts` file under `scripts/` or `test/` |
| `test/repo.test.ts` | `TEXT_FILE` | A file that the scanner reads as text |
| `test/repo.test.ts` | `ICON_PREFIX` | The leading `./` of a path |
| `test/repo.test.ts` | `PARAGRAPH_BREAK` | A blank line between paragraphs |
| `test/repo.test.ts` | `BLANK_PAIR` | Two line breaks in a row |
| `test/repo.test.ts` | `ALLOWED_TOOLS` | The `allowed-tools:` line of frontmatter |
| `test/repo.test.ts` | `NO_TOOLS` | An empty `tools: []` line |
| `test/repo.test.ts` | `NO_SKILL` | A `disallowedTools:` line that names Skill |
| `test/repo.test.ts` | `SMALL_MODEL` | A `model:` line with sonnet or haiku |
