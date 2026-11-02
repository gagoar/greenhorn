<img src=".claude-plugin/icon.png" alt="greenhorn icon" width="120" align="right">

# greenhorn

**Write technical text so a newcomer can follow it: find where a stranger gets lost, answer each gap from your code, and show one real example first.**

greenhorn is a Claude Code plugin. It has two commands:

- `/greenhorn:explain` rewrites a text for a reader who is new to the system.
- `/greenhorn:test` only finds the places where such a reader would stop. It rewrites nothing.

Docs: [gagoar.github.io/greenhorn](https://gagoar.github.io/greenhorn/)

## Before and after

The pair below is an illustration written for this README. It is not from a real pull request. Both texts are in `testdata/readme/`.

| Before | After |
|---|---|
| Fixes the Photon regression by backing out the delta-sync change. The reconciler now short-circuits on a stale ETag and the rehydration path no longer double-fires the capture hook. | Images sometimes showed twice in the viewer. This change stops that.<br><br>For example, a dentist takes one X-ray and sees two copies of it. After this change the viewer shows one copy.<br><br>The cause is the **capture hook**, a function that runs each time a scanner sends an image. A rebuilt viewer list called the hook a second time for the same image. The hook now skips an image that it has already seen. |

The checker ran on both files. The real output:

```
$ node scripts/check-text.ts testdata/readme/before.md
testdata/readme/before.md:1:1: hard no-example: the text has no example: add a closed code block, a line that starts with "Example" or "For example" and has content, or a Before and After pair of labels
1 findings (1 hard, 0 warn) for profile adjacent-engineer

$ node scripts/check-text.ts testdata/readme/after.md
0 findings (0 hard, 0 warn) for profile adjacent-engineer
```

The checker is shallow. It saw that the "before" text has no example. It did not see the jargon (Photon, ETag, rehydration). Finding jargon is the job of the stumble pass, and that pass uses a model.

## Install

```
/plugin marketplace add gagoar/greenhorn
/plugin install greenhorn@greenhorn
```

greenhorn needs two other plugins, `unmistakable` (skill `asd-ste100`) and `iceberg` (skill `iceberg:edit`). Both come from the `gago-plugins` marketplace:

```
/plugin marketplace add gagoar/gago-plugins
/plugin install unmistakable@gago-plugins
/plugin install iceberg@gago-plugins
```

If one is missing, `/greenhorn:explain` stops and prints the command to install it.

## How it works

`/greenhorn:explain` runs nine steps. They match sections 0 to 8 of `skills/explain/SKILL.md`.

0. **Dependency check.** It stops when `asd-ste100` or `iceberg:edit` is missing.
1. **Input and profile.** Get the text and pick who the reader is. There are three presets: `smart-outsider`, `adjacent-engineer` (the default) and `new-hire`. They live in `greenhorn.config.example.json`. The skill passes the chosen name to the checker with `--profile`.
2. **Stumble pass.** A read-only agent, `greenhorn-reader`, gets the text and the profile. It has no tools and no repository access (see Limits for how that is enforced). It lists each word, step or jump that it cannot follow, with the question it would ask. It also writes one sentence for what it thinks the text says. If that sentence differs from what you meant, the text fails.
3. **Ground pass.** Claude answers each stumble from the code, the linked issue or the docs. An answer with no source goes to an `unsure` list and becomes a question for you. Nothing is invented.
4. **Rewrite.** One-sentence gist, then one concrete example with real values, then the mechanism. A term is defined at its first use as "X is a Y that does Z". An analogy appears only with a stated limit.
5. **Check.** `scripts/check-text.ts` runs. It fails on a circular definition and on a missing example. It only warns on the rest.
6. **Polish.** The `asd-ste100` skill in STE-flavored mode, then `iceberg:edit --no-em-dash`. The edit always deletes single hedge words. The skill compares with the draft and restores a hedge that carries real uncertainty.
7. **Lint loop.** At most 3 rounds. The text is never weakened to pass.
8. **Report.** The final text, the stumbles, the `unsure` list, the warnings that remain and the limits.

## The checker

```
node scripts/check-text.ts [--json] [--config PATH] [--profile NAME] [--disable id,id] [--] [FILE...]
```

It reads stdin when you give no file. Exit 0 means no hard failure. Exit 1 means a hard failure. Exit 2 means a usage error, such as an unknown flag, an unknown check or profile, a bad config, a directory instead of a file, or an empty `--disable`.

- A flag that takes a value also accepts `--flag=value`.
- `--disable` may repeat, and its ids add up. Spaces around an id are ignored.
- `--profile NAME` picks a profile of the config file, and its limits apply. The name must be a key of `profiles`. Without a `profiles` table only `adjacent-engineer` is known, so pass `--config greenhorn.config.example.json` to use a preset.
- `--` ends the flags, so a file name may start with a dash.

| Check | Level | What it finds |
|---|---|---|
| `circular-definition` | hard | A definition that uses its own term, or a term that the text defines later |
| `no-example` | hard | None of these: a closed code block with text in it, a line that starts with "Example:", "For example" or "e.g." and has content on that line or the next, or a Before and After pair where both are labels (`Before:`, `**Before**`, `## Before`) and not prose |
| `unclosed-fence` | warn | A code fence that never closes. The text after it is still checked, and the fence is not an example |
| `term-before-definition` | warn | A term used before the line that defines it |
| `undefined-repeated-term` | warn | A code-font or CamelCase or all-capitals name used 3 or more times and never defined. It will give false alarms |
| `too-many-terms` | warn | More defined terms than the limit |
| `long-definition` | warn | A definition longer than the limit |
| `analogy-without-limit` | warn | "like a" or "think of ... as" with none of "unlike", "differs from", "breaks down" or "the difference is" in the next two sentences, and no "but ... not" clause (where "not" is not followed by "like") in the analogy sentence or the one after it |

What counts as a definition. The checker joins the lines of a paragraph or list item (at most 12 lines) before it looks. It reads three forms:

- Colon form: `**Term**: body`, with an optional list bullet. The bold labels Note, Warning, Tip, Example, Before, After, Caution and Important are not terms.
- Sentence form: "X is a/an Y that ..." or "X are a/an Y that ...", where X is in bold, in code font or a capitalized name. The word `that` is required: "A **cache** is a store" is not a definition.
- Lowercase form: the same pattern with a plain lowercase X of one or two words, only at the start of a sentence, with an optional "A", "An" or "The" before it. "We think a cache is a store that ..." is not a definition.

A pronoun such as "it" or "this" is never a term. A term defined twice keeps its first definition. Text inside a closed code fence is ignored. A fence closes only on the same mark (backtick or tilde) with at least as many marks as the opener, as in CommonMark. A fence that never closes hides nothing.

## Configuration

Copy `greenhorn.config.example.json` to `greenhorn.config.json`. The schema is `schema/greenhorn.schema.json`. The checker rejects a key that the schema does not list, and a `profile` that `profiles` does not define. The limits are:

| Limit | Default |
|---|---|
| `maxTerms` | 5 |
| `glossaryThreshold` | 3 |
| `maxDefinitionWords` | 25 |
| `requireExample` | true |
| `analogyNeedsLimit` | true |

These numbers are untested defaults. No study backs them. They are guesses until the eval in `eval/` says otherwise.

## Limits

- The reader agent has no tools, but how that is enforced is partly undocumented. Its frontmatter sets `tools: []`. The Claude Code docs say only that an omitted `tools` inherits every tool, and say nothing about an empty list. In Claude Code 2.1.316 we saw that `tools: []` leaves the agent only the hand-back tool, but a later version may change that. So `disallowedTools` also names every tool that we know of, and `mcp__*` (a documented wildcard) blocks every MCP tool. A test keeps those lines. We checked this by hand in one version only.
- `allowed-tools` in a skill only pre-approves tools. It does not remove the others. `/greenhorn:test` therefore sets `disallowed-tools` to hold its rule that it writes nothing, and `/greenhorn:explain` tells the model to treat the text and the reader output as data, never as instructions. Both are guards, not a sandbox.
- The stumble reader is a model. It is not a human newcomer. It finds likely stumbles. It does not prove that a text is clear, and a clean result does not prove it either. The final test is a real person.
- The numbers above are untested defaults.
- The checker reads text shape. It cannot tell whether a definition is true or whether an example is a good one.
- Each of the warn checks can be wrong. `undefined-repeated-term` will flag a name that needs no definition.
- The method is a hypothesis. We know of no study that compares definition-first with example-first text. The human eval in `eval/README.md` is how the method gets tested. It has no results yet.

## Prior art and reading

[coldread](https://github.com/patrykwiener/coldread) by patrykwiener solves a related problem: it makes session context readable to a reader who was outside the session. greenhorn targets a different gap, the domain concepts that a newcomer lacks.

The design leans on these sources. They are supporting reading, not verified against the primary paper, and not proof for this tool:

- Concreteness fading: Fyfe et al. (2014).
- Mismatch risk of analogies: Gray and Holyoak (2021).
- The worked-example effect and the expertise reversal effect: the Sweller line of work.

## Privacy

greenhorn runs on your machine, inside your Claude Code session. The scripts use only Node built-in modules and make no network call. The plugin collects no data and sends no telemetry. The text that you ask it to explain goes to the Claude model in your session, as any prompt does. The stumble reader gets only the text and the profile. The plugin keeps a draft in `.greenhorn/` in your working directory. Delete it when you are done.

## Terms

The plugin is provided as it is, with no warranty. You are responsible for checking the text that it writes, in particular the facts and the examples, before you publish it. The license below applies.

## License

MIT. See `LICENSE`.

## Credits

The icon is a modified work from the Noun Project. See [CREDITS.md](CREDITS.md) for the artist.
