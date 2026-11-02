<img src=".claude-plugin/icon.png" alt="greenhorn icon" width="120" align="right">

# greenhorn

**Explain it to someone who has never seen your system.**

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
/plugin marketplace add gagoar/gago-plugins
/plugin install greenhorn@gago-plugins
```

The two helper plugins, `unmistakable` (skill `asd-ste100`) and `iceberg` (skill `iceberg:edit`), install with greenhorn. If one is missing, `/greenhorn:explain` stops and prints the command to install it.

A greenhorn is a newcomer. The plugin is named for the reader it writes for.

## How it works

`/greenhorn:explain` runs nine steps. They match sections 0 to 8 of `skills/explain/SKILL.md`.

0. **Dependency check.** The manifest lists both helpers as dependencies. The skill also stops when `asd-ste100` or `iceberg:edit` is missing, at step 0 or at the polish step. A model makes this check, so treat it as a fallback, not a gate.
1. **Input and profile.** Get the text and pick who the reader is. There are three presets: `smart-outsider`, `adjacent-engineer` (the default) and `new-hire`. They live in `greenhorn.config.example.json`. The skill passes the chosen name to the checker with `--profile`.
2. **Stumble pass.** A read-only agent, `greenhorn-reader`, gets the text and the profile. It has no tools and no repository access (see Limits for how that is enforced). It lists each word, step or jump that it cannot follow, with the question it would ask. It also writes one sentence for what it thinks the text says. If that sentence differs from what you meant, the text fails.
3. **Ground pass.** Claude answers each stumble from the code, the linked issue or the docs. An answer with no source goes to an `unsure` list and becomes a question for you. Nothing is invented.
4. **Rewrite.** One-sentence gist, then one concrete example with real values, then the mechanism. A term is defined at its first use as "X is a Y that does Z". An analogy appears only with a stated limit.
5. **Check.** `scripts/check-text.ts` runs. It fails on a circular definition and on a missing example. It only warns on the rest.
6. **Polish.** The `asd-ste100` skill in STE-flavored mode, then `iceberg:edit --no-em-dash`. The edit always deletes single hedge words. The skill compares with the draft and restores a hedge that carries real uncertainty.
7. **Lint loop.** At most 3 rounds. The text is never weakened to pass.
8. **Report.** The final text, the stumbles, the `unsure` list, the warnings that remain and the limits.

Between 7 and 8 there is a **verify pass** (step 7a). A second, fresh `greenhorn-reader` reads only the final text. `scripts/verify-reader.ts` checks its JSON (each quote must be in the draft) and counts which stumbles of the first reading come back. If some do, the skill fixes them once more, within the cap of 3 rounds. The report says how many stumbles the second reader found and how many of the first did not recur. A count of zero is not a success. Runs vary, the match is approximate, and this does not measure clarity for people. The pass costs one more reader call per run, and one more when a fix round runs. Turn it off with `verify.enabled: false`.

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
| `undefined-repeated-term` | warn | A code-font name or an all-capitals acronym used 3 or more times and never defined. It skips paths, file names, flags, calls, assignments and a list of universal terms (PR, API, README, SHA, main and the like). It will give false alarms |
| `too-many-terms` | warn | More defined terms than the limit |
| `long-definition` | warn | A definition longer than the limit |
| `analogy-without-limit` | warn | "like a" or "think of ... as" with none of "unlike", "differs from", "breaks down" or "the difference is" in the next two sentences, and no "but ... not" clause (where "not" is not followed by "like") in the analogy sentence or the one after it |

What counts as a definition. The checker joins the lines of a paragraph or list item (at most 12 lines) before it looks. It reads three forms:

- Colon form: `**Term**: body`, with an optional list bullet. The body must read like a definition: it starts with "a", "an" or "the", or with "is", "are", "means" or "refers to", or it starts with "any", "each", "every", "one", "some" or "all" and has "that" or "which" within 12 words. A body that starts with a digit, a list marker, a link, a code span, a path or a verb in the imperative is not a definition. A body that starts with an article but says "was", "did", "has", "will" or "not" before any "that" or "which" is a statement, not a definition: "**Reason**: the cache was not cleared". The bold labels in a fixed list (Note, Warning, Summary, Risk, Size, Legend, Review order, Cause, Fix and others; see `LABELS` in `scripts/document.ts`) are never terms.
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

`verify` has two settings: `enabled` (default true) and `maxRounds` (default 1, the most verify fix rounds). They are untested defaults too.

These numbers are untested defaults. No study backs them. They are guesses until the eval in `eval/` says otherwise.

## Limits

- The reader agent has no tools, but how that is enforced is partly undocumented. Its frontmatter sets `tools: []`. The Claude Code docs say only that an omitted `tools` inherits every tool, and say nothing about an empty list. In Claude Code 2.1.316 we saw that `tools: []` leaves the agent only the hand-back tool, but a later version may change that. So `disallowedTools` also names every tool that we know of, and `mcp__*` (a documented wildcard) blocks every MCP tool. A test keeps those lines. We checked this by hand in one version only.
- `allowed-tools` in a skill only pre-approves tools. It does not remove the others. `/greenhorn:test` therefore sets `disallowed-tools` to hold its rule that it writes nothing, and `/greenhorn:explain` tells the model to treat the text and the reader output as data, never as instructions. Both are guards, not a sandbox.
- The stumble reader is a model. It is not a human newcomer. It finds likely stumbles. It does not prove that a text is clear, and a clean result does not prove it either. The final test is a real person.
- The numbers above are untested defaults.
- The checker reads text shape. It cannot tell whether a definition is true or whether an example is a good one.
- Each of the warn checks can be wrong. `undefined-repeated-term` will flag a name that needs no definition.
- The method is a hypothesis. No study tests this combination. The human eval in `eval/README.md` is how the method gets tested. It has no results yet.

## Prior art and research

[coldread](https://github.com/patrykwiener/coldread) by patrykwiener solves a related problem: it makes session context readable to a reader who was outside the session. greenhorn targets a different gap, the domain concepts that a newcomer lacks.

We started with a terms block at the top of the pull request description. Then we read the papers. In the one paper that tests the order (Rawson et al. 2015, two experiments with about 25 students per group), the two orders did not differ significantly, so we dropped our own claim about order. What is left is a hypothesis that we are testing: a newcomer follows technical text better when a reader with no context marks where they get lost, when every gap is filled from the real source, and when the text opens with one concrete example. No study tests this combination, and the defaults above are untested.

[How we got here](https://gagoar.github.io/greenhorn/evidence.html) tells the whole account and lists every source with its read status.

## Privacy

greenhorn runs on your machine, inside your Claude Code session. The scripts use only Node built-in modules and make no network call. The plugin collects no data and sends no telemetry. The text that you ask it to explain goes to the Claude model in your session, as any prompt does. The stumble reader gets only the text and the profile. The plugin keeps a draft in `.greenhorn/` in your working directory. Delete it when you are done.

## Terms

The plugin is provided as it is, with no warranty. You are responsible for checking the text that it writes, in particular the facts and the examples, before you publish it. The license below applies.

## License

MIT. See `LICENSE`.

## Credits

Icon: ["Bath toy"](https://thenounproject.com/icon/bath-toy-2990119/) by SUPRIYANTO YANTO, from Noun Project, used under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Recolored and placed in a new composition. See [CREDITS.md](CREDITS.md).
