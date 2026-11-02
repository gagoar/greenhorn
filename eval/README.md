# Human eval protocol

The stumble reader is a model. A model is not a human newcomer. This eval is the human step. It has not been run. This folder holds no results.

The method is a hypothesis: a text that follows "stumble, ground, example first" is easier for a stranger to understand than the original. In the one direct test we found (Rawson et al. 2015), the order of example and definition made no clear difference. We know of no study that tests this whole method on technical documents. The eval decides whether the hypothesis holds. It also tunes the limits in `greenhorn.config.json`, which are untested defaults today.

## Documents

Pick 3 to 5 real documents from a domain that the testers do not know. Use documents from one project only, never a mix of two projects. A document is a pull request description, a design note, release notes or an incident write-up. Each is 150 to 600 words.

Write down the author's intent for each document in two sentences. Do this before anyone reads any version. This is the answer key.

## Arms

Make three versions of each document.

| Arm | What it is |
|---|---|
| A. Original | The text as the author wrote it |
| B. Polish only | The original after `asd-ste100` (STE-flavored mode) and `iceberg:edit --no-em-dash`. No stumble pass, no rewrite |
| C. greenhorn | The original after the whole `/greenhorn:explain` pipeline |

Record the profile and the config that arm C used.

## Readers

- Use fresh readers: people who have not seen the document, any version of it, or the project behind it.
- Each reader sees one arm of one document. A reader never sees two versions of the same document.
- Spread readers over the arms so that each arm of each document has the same number of readers. Assign arms at random.
- Use at least 5 readers per arm per document if you can. State the real number in the results.
- Match the reader to the profile that arm C used. For `adjacent-engineer`, the readers write code and are new to the product.

## Task

1. Give the reader the text. No time limit, but record the time.
2. Take the text away.
3. Ask: "Explain what this text says in two sentences, in your own words."
4. Ask: "Mark each word or step that you did not follow." (A list is enough.)

Say nothing else. Do not help.

## Scoring

Two scorers, who do not know the arm, read each two-sentence answer against the author's intent. Each gives a score from 0 to 2:

| Score | Meaning |
|---|---|
| 2 | Both main points of the intent are present and correct |
| 1 | One main point is present and correct, or both are present with an error |
| 0 | The main point is missing or wrong |

Also record: the number of marked stumbles, the time to read, and the scorers' disagreements. Settle a disagreement by discussion and note it.

## Report

Report the numbers per arm: mean score, the count of readers, the mean stumbles, the mean time. Report them even when the result is a tie or when arm C is worse. Publish the raw `score-sheet.csv` with the report. Say how many readers took part, and do not claim more than that number supports.

Compare the reader stumbles with the model's stumbles for arm A. This shows how well the stumble reader predicts real stumbles. State the overlap, even when it is low.

If the results justify a change to a limit (`maxTerms`, `glossaryThreshold`, `maxDefinitionWords`), change the default in `greenhorn.config.example.json` and in `scripts/config.ts`, and say which result led to it.
