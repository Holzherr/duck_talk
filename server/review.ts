/**
 * `duck-talk review` — one day of turns read back, and what went wrong in them.
 *
 * Everything it reads the relay already wrote, so nothing had to be added for it: the
 * turn records (turns.ts), the corrections (corrections.ts) and the run logs (log.ts).
 * It starts nothing and needs no key, so it works on any Mac that has the folder's
 * `.duck-talk/`. What counts as a turn that did not work is specs/turn-review.md.
 *
 * Four of the seven kinds are not in the turn record: a cancel, an error and a retract
 * are said only in the log. So the log is read per connection — `[id]` — and the
 * `turn N end` line closes whichever turn that connection last heard. Its number and
 * its words together are what find the record, because a record carries no connection.
 * Logs last a week; the digest says how many turns it found in one, so a quiet week-old
 * day reads as unknown rather than as clean. What it quotes is printed on this Mac only.
 */

import { readFileSync, readdirSync, writeSync } from 'node:fs';
import { state } from './paths.ts';
import type { Turn } from './turns.ts';
import type { Correction } from './corrections.ts';

const SLOW_MS = 10_000;
const LONG_WORDS = 60;

const KINDS = [
  'interrupted', 'corrected', 'error', 'tool timeout',
  `slow first audio (over ${SLOW_MS / 1000} s)`, `long reply (over ${LONG_WORDS} words)`, 'retracted',
] as const;
type Kind = (typeof KINDS)[number];

/** What session.ts logs when a turn ends badly, and which kind each one is. */
const LOGGED: [RegExp, Kind][] = [
  [/^cancel \((partial while claude, not continuing|stop word|stop frame|typed over the reply)\)$/, 'interrupted'],
  [/^cancel \(claude error: |^ears (failed|error): /, 'error'],
  [/^cancel \(nothing from claude for /, 'tool timeout'],
  [/^retract \(/, 'retracted'],
];

/** One turn as a run log saw it: when that run started, and what went wrong in it —
 *  each kind with the words worth quoting beside it, empty when there are none. */
interface Logged { start: number; turn: number; text: string; kinds: Map<Kind, string> }

/** Print the digest for `day` (default yesterday); the exit code is the return. */
export function main(day = yesterday()): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    console.error(`--day takes a date, YYYY-MM-DD, not "${day}"`);
    return 2;
  }
  // Written synchronously: cli.ts exits straight after, and a pipe would lose the rest.
  writeSync(1, `${review(day)}\n`);
  return 0;
}

export function review(day: string): string {
  const turns = lines<Turn>('turns.jsonl').filter((t) => date(when(t)) === day);
  if (!turns.length) return `no turns on ${day}`;
  const corrections = lines<Correction>('corrections.jsonl');
  const logs = logged();

  let found = 0;
  const rows = turns.map((t) => {
    const at = when(t)!;
    // The latest run that had started by then — a turn number and its words repeat
    // across runs, and the run that was live is the one that said this.
    const log = logs.findLast((l) => l.start <= at && l.turn === t.turn && l.text === words(t));
    if (log) found++;
    const kinds = new Map(log?.kinds);
    const fix = t.clip ? corrections.find((c) => c.clip === t.clip) : undefined;
    if (fix) kinds.set('corrected', ` → "${fix.meant}"`);
    const wait = waited(t);
    if (wait !== null && wait > SLOW_MS) kinds.set(KINDS[4], ` (${seconds(wait)})`);
    const said = t.said.split(/\s+/).filter(Boolean).length;
    if (t.voice_ms > 0 && said > LONG_WORDS) kinds.set(KINDS[5], ` (${said} words)`);
    return { t, kinds, wait };
  });

  const wrong = rows.filter((r) => r.kinds.size).length;
  const cost = turns.reduce((sum, t) => sum + (t.cost_usd ?? 0), 0);
  const out = [
    `# Turns on ${day}`,
    '',
    `${turns.length} turns, ${wrong} went wrong, $${cost.toFixed(2)} spent. ${found} of ${turns.length} found in a run log.`,
    '',
    '## What went wrong',
    '',
  ];
  for (const kind of KINDS) {
    const hit = rows.filter((r) => r.kinds.has(kind));
    const first = hit[0];
    out.push(`- ${kind}: ${hit.length}${first ? ` — "${words(first.t)}"${first.kinds.get(kind)}` : ''}`);
  }
  const slowest = rows.filter((r) => r.wait !== null).sort((a, b) => b.wait! - a.wait!).slice(0, 5);
  if (slowest.length) {
    out.push('', '## Slowest waits to first audio', '');
    slowest.forEach((r, i) => out.push(`${i + 1}. ${seconds(r.wait!)} — "${words(r.t)}"`));
  }
  return out.join('\n');
}

/** Every turn the run logs closed, oldest run first. */
function logged(): Logged[] {
  let names: string[];
  try {
    names = readdirSync(state('logs')).filter((n) => n.endsWith('.log')).sort();
  } catch {
    return []; // no logs kept here, or all older than a week
  }
  const found: Logged[] = [];
  for (const name of names) {
    // `2026-10-04_08-00-00.log` is local time, as Date reads an ISO stamp with no zone.
    const start = new Date(`${name.slice(0, 10)}T${name.slice(11, 19).replaceAll('-', ':')}`).getTime();
    const open = new Map<string, { text: string; kinds: Map<Kind, string> }>();
    for (const line of readFileSync(state('logs', name), 'utf8').split('\n')) {
      const m = /^\[(\d+)\] (.*)$/.exec(line);
      if (!m) continue;
      const msg = m[2]!;
      const now = open.get(m[1]!) ?? { text: '', kinds: new Map() };
      open.set(m[1]!, now);
      const said = /^(?:heard|typed): (.*)$/.exec(msg);
      if (said) now.text = said[1]!;
      const end = /^turn (\d+) end /.exec(msg);
      if (end) {
        found.push({ start, turn: Number(end[1]), text: now.text, kinds: now.kinds });
        now.kinds = new Map();
        continue;
      }
      for (const [pattern, kind] of LOGGED) {
        if (!pattern.test(msg)) continue;
        // An error is worth its words; the other three are said by their kind.
        now.kinds.set(kind, kind === 'error' ? ` (${msg.replace(/^cancel \((.*)\)$/, '$1')})` : '');
      }
    }
  }
  return found;
}

/** A JSON-lines file under `.duck-talk/`, a half-written line skipped. */
function lines<T>(name: string): T[] {
  let text: string;
  try {
    text = readFileSync(state(name), 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').flatMap((line) => {
    try { return line.trim() ? [JSON.parse(line) as T] : []; } catch { return []; }
  });
}

/** When the turn happened: heard, or else the next stamp it has. */
function when(t: Turn): number | null {
  return t.heard_at ?? t.ran_at ?? t.partial_first_at;
}

/** The words a turn is quoted by: what was heard, or what was typed. */
function words(t: Turn): string {
  return t.heard || t.instruction;
}

/** Instruction to first reply audio; in review mode from its sending, as the hold is a person deciding. */
function waited(t: Turn): number | null {
  const from = t.approval ? t.ran_at : t.heard_at;
  return from && t.voice_out_at ? t.voice_out_at - from : null;
}

/** A moment as its local calendar day, `2026-10-04`. */
function date(at: number | null): string | null {
  if (at === null) return null;
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return date(d.getTime())!;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
