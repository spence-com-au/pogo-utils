---
name: bug-report
description: >-
  File a bug against `pogo-utils` as a GitHub issue, filled against the repository bug report form. Use when the user
  runs `/bug-report`, or asks to write up, file or report a bug or an issue for something that went wrong.
---

# Filing a bug report

Turn a failure into an issue on [spence-com-au/pogo-utils](https://github.com/spence-com-au/pogo-utils), filled against
the repository's own bug report form.

An argument, when there is one, says which failure to write up — it steers a session that holds more than one, and is
never the content of the report.

## Read the form first

Read `.github/ISSUE_TEMPLATE/bug_report.yaml`. It is the contract, and this document deliberately does not restate it:

- Each `body` entry carrying an `id` is one section of the issue body, and its `attributes.label` is that section's
  heading. Match the label exactly — the heading is what a later search looks for.
- `validations.required: true` marks what cannot go up empty. If you cannot fill a required section, ask; do not file
  around it.
- A `dropdown` answers with one of its own `options`. A failure that fits none of them is the form wanting a new option,
  not a label to invent.
- The top-level `labels` list is what the issue must be created with. `gh issue create` does not read this file, so a
  label that is not passed on the command line is a label the issue does not get.

Two paths reach the same issue — the web form, and this skill — and only the web form reads that YAML on its own.
Anything the form declares is invisible here unless you go and read it, which is why this step is first rather than
last.

## Gather

Take from the session what the session already holds. Ask only for what is not there.

| Section  | Where it comes from                                                                              |
| -------- | ------------------------------------------------------------------------------------------------ |
| Page     | Which tab, which the fragment names: `#/events` is the Events page.                              |
| Link     | The address in full. The fragment carries the state, so `#/pokedex?q=pika&n=25` is what to open. |
| Expected | What the page should have done. Ask when the session never said.                                 |
| Actual   | What it did instead.                                                                             |
| Browser  | Which browser and version, phone or desktop. Ask — nothing in the session knows this.            |
| Console  | What the browser console printed. Empty is a fair answer; a reader need not have looked.         |

A failure in a `pnpm inventory` command is Page `Pokémon inventory`, and one in a `pnpm battle` command is Page
`Trainer battles`, with Link and Browser left empty. The command and the Node version it ran under go in
`What happened instead`, and what it printed goes in Console.

Invoked cold, with no failure in scope, interview for each section in one round rather than one question at a time.

A session that has the source can often name the file that is wrong, where a reader has only a URL and a browser. Put
that in `What happened instead` when you have it — it is the most useful sentence in the report — and still fill the
rest as the reproduction rather than as a patch.

## Confirm

Draft a title that describes the defect rather than the fix, in the voice the repository's commit subjects use —
`The Events page shows a UTC start for a local event`. No `[bug]` prefix: the label already says it.

Search for what is already filed, and show any hits above the body rather than judging them:

```bash
gh issue list --search '<keywords from the title>' --state all --limit 10
```

Then show the rendered body, the title and the label. Wait. Do not create anything until the user says to.

## Create

Write the body to a file outside the working tree — the session scratchpad — so an abandoned run leaves nothing behind
for a later `git add` to pick up. Then:

```bash
gh issue create --title '<title>' --label '<each label from the form>' --body-file '<path>'
```

No `--repo`: `gh` takes it from the checkout's remote, which is the one place it is written down, and a second copy on
the command line is a copy that can disagree with it.

Print the URL it returns, and stop. Do not open a browser, and do not comment `@claude` on the issue: no workflow here
answers a mention, so it reaches nobody.
