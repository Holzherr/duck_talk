Status: agreed

# Turn review: what went wrong in yesterday's voice turns, and who fixes it

The owner, 2026-10-05: "Yes. You write the spec, not me — the requirements are in AT-039
and the on-the-road skill. Review the turns nightly and ship the fixes; reversible
skill edits merge without asking me."

The relay already keeps every finished turn, one line each, in
`<folder>/.duck-talk/turns.jsonl`, and one log per run for a week in
`<folder>/.duck-talk/logs/`. Nothing reads them back. This spec says what reads
them, what counts as a turn that did not work, and how a fix gets shipped.

## 1. Where the review runs

In the relay, as a subcommand: `duck-talk review [--day YYYY-MM-DD] [--cwd <folder>]`.
It works on any Mac that has the folder's `.duck-talk/`, needs no key and no
network, and starts nothing. `--day` is a local calendar day and defaults to
yesterday; `--cwd` defaults to the current folder, as for the relay itself.

It prints a markdown digest to stdout and exits 0. A day with no turns prints
`no turns on <day>` and exits 0.

## 2. What counts as a turn that did not work

A turn belongs to the day its `heard_at` falls on (`ran_at`, then
`partial_first_at` for a turn that has none). Seven kinds, and one turn can be
several:

| kind | the turn… | read from |
|---|---|---|
| interrupted | was cancelled by the user: spoken over, "stop", the stop button, or typed over | run log: `cancel (partial while claude, not continuing)`, `cancel (stop word)`, `cancel (stop frame)`, `cancel (typed over the reply)` |
| corrected | had its words corrected afterwards: a correction was saved from this turn's clip | `corrections.jsonl` entry whose `clip` is the turn's `clip` |
| error | ended on an `error` frame | run log: `cancel (claude error: …)`, `ears failed: …`, `ears error: …` |
| tool timeout | went silent until the watchdog cancelled it | run log: `cancel (nothing from claude for …s)` |
| slow first audio | waited more than **10 s** for the first reply audio | `voice_out_at − heard_at`; in review mode `voice_out_at − ran_at`, because the hold is a person deciding |
| long reply | had a reply read aloud longer than **60 words** | words in `said`, for a turn that produced voice |
| retracted | was taken back while still being spoken: Claude started on a fragment | run log: `retract (partial while claude, continuing)` |

A run log line belongs to the turn its connection ends next: the log is read per
`[id]`, and the line `turn N end` closes the turn whose last `heard:` (or `typed:`)
text and number `N` match a turn record. Logs older than a week are gone, so the
digest says how many of the day's turns it found in a log; a turn it did not find
counts zero for the four log kinds.

Errors that happen between turns (a model switch refused) are not a turn's and are
not counted.

## 3. Auto-fix

The night team runs `duck-talk review` on the turns copied into the night's inputs
and files one backlog item per pattern it finds, through the normal backlog. Nothing
changes the app or the relay unattended.

- A reversible edit to the on-the-road skill (`.claude/skills/on-the-road/SKILL.md`)
  merges after review without asking the owner.
- Anything else — relay code, prompts, the iPhone app — goes through review, and
  product changes reach the owner as usual.

## 4. Privacy

Transcripts stay on the Mac. The digest quotes heard text, and only in its local
output. Nothing the review prints is committed, posted or sent anywhere; a backlog
item filed from it describes the pattern and its counts, never the quoted words.

## Out of scope

Changes to the wire protocol, the iPhone app or how `session.ts` records a turn.
Copying the files into the night's inputs is the night runner's job (AT-039).
