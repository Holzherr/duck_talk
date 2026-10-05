/**
 * `duck-talk review`, run the way a person runs it: through cli.ts, on the turns and
 * the run log beside this file — one turn of each kind that did not work, two that did,
 * and one from the day before that must be left out.
 *
 *   node --test server/fixtures/review/review.test.ts
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const cli = fileURLToPath(new URL('../../cli.ts', import.meta.url));
const folder = fileURLToPath(new URL('.', import.meta.url));

const review = (...args: string[]) => spawnSync(process.execPath, [cli, 'review', '--cwd', folder, ...args], { encoding: 'utf8' });

test('a day of turns prints the checked-in digest', () => {
  const run = review('--day', '2026-10-04');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, readFileSync(new URL('./expected.md', import.meta.url), 'utf8'));
});

test('a day with no turns says so and exits 0', () => {
  const run = review('--day', '2026-10-02');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, 'no turns on 2026-10-02\n');
});

test('a day that is not a date is refused', () => {
  const run = review('--day', 'yesterday');
  assert.equal(run.status, 2);
  assert.match(run.stderr, /YYYY-MM-DD/);
});
