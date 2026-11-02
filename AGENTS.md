# AGENTS.md

greenhorn is a Claude Code plugin. It packages the `explain` and `test` skills and a TypeScript checker. The scripts are TypeScript with no dependency. Node runs them as they are (22.18 or later): there is no build step and there is no binary.

Rules an agent cannot infer from the code:

- Write TypeScript with the `typescript-patterns-enforcer` skill, and run its hook on every file you touch. No `any`, no `switch`, no raw loop, no magic number, no nested ternary. Every regex has a comment with an example, and a row in `REGEXES.md`. Put no tester link in a code file: the directory scan holds the plugin for review when a code file has a remote URL.
- Node must run the files as they are, so use only syntax that Node can strip: no `enum`, no `namespace`, no parameter properties. Import with the `.ts` extension, and use `import type` for types.
- `scripts/check-plugin-safety.ts` is the shared, canonical gate. It is exempt from the style rules above (it has a raw loop, for one). Do not edit it here. The repository tests that scan code files skip it.
- The reader agent (`agents/greenhorn-reader.md`) relies on undocumented behavior: the docs say an omitted `tools` inherits every tool, and say nothing about `tools: []`. In Claude Code 2.1.316, `tools: []` leaves the agent only its hand-back tool. `disallowedTools` adds every tool that we know of, with the documented `mcp__*` wildcard for MCP tools. Keep both lines (a test checks them), and say so in the README when you touch them. A skill's `allowed-tools` only pre-approves: use `disallowed-tools` to remove a tool from a skill.
- Ship no binary and no bundle. A native file, or a file over 1 MiB, holds the plugin for review in the directory scan. A script or a document over 256 KiB is not read in full. Keep no top-level `bin/` directory.
- Add no dependency. CI installs `typescript` and `@types/node` for `tsc` only, and does not save them.
- A model reader is not a human newcomer. Never write in a doc that the stumble test "proves" a text is clear. Say it finds likely stumbles.
- Never invent a definition. A term the code, the linked issue or the docs do not support goes to the `unsure` list.
- A cap (term count, words per definition) is a default in `greenhorn.config.json`, never a hard-coded number. State in docs that the defaults are untested guesses until the eval says otherwise.
- Cite a study only after you read the primary paper. `docs/evidence.html` (the "How we got here" page) is the one place that lists sources, each with its read status (read in full, or abstract only). Never write "proven", "evidence-based", "research shows" or "studies show" without a named study and its population.
- The checker (`scripts/check-text.ts`) fails on a circular definition and on a missing example. Every other finding is a warning.
- Every check has `testdata/rules/<id>.pass.md` and `<id>.fail.md`. A test fails if one is missing. A check that needs options may add `<id>.args.json` (an array of CLI arguments; a name that matches a file in `testdata/rules`, such as `<id>.original.md`, becomes its full path) for both fixtures.
- Prose goes through `asd-ste100` (STE-flavored mode) and then `iceberg:edit`. Write Markdown first, convert to HTML after, and add no prose in the conversion.
- The footer of every page in `docs/` shows the version in `.claude-plugin/plugin.json`. A test checks it.
- After a change to `docs/assets/*.html` or `docs/assets/icon.svg`, rebuild the images and commit them.
- Never use a personal access token in a workflow. Use `github.token` and OIDC.
- Git identity for this repository: `Gago Frigerio <xeroice@gmail.com>`. Never add a `Co-Authored-By` line.
- Check: `node --test "test/*.test.ts"`, then `tsc -p .`, then `node scripts/check-plugin-safety.ts .`, then `claude plugin validate --strict .`
