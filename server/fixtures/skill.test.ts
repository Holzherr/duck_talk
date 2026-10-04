/**
 * The skill a session starts in: what `openClaude` appends to Claude Code's prompt.
 *
 * The served folder is made fresh in a temp directory from the `*.SKILL.md` files
 * beside this one, so the fixture skills sit where a real project keeps them —
 * `.claude/skills/<name>/SKILL.md` — without this repo carrying a `.claude/` of its own.
 *
 *   node --test server/fixtures/skill.test.ts
 */

import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// The relay's state directory lands under the served folder, so it is pointed at a
// throwaway one before claude.ts loads — and the Claude prompt read is the shipped one.
process.env['PROJECT_CWD'] = mkdtempSync(join(tmpdir(), 'skill-state-'));
delete process.env['CLAUDE_SKILL'];
const { systemAppend } = await import('../claude.ts');
const { read } = await import('../prompts.ts');

const served = mkdtempSync(join(tmpdir(), 'skill-served-'));
for (const name of ['on-the-road', 'other']) {
  mkdirSync(join(served, '.claude', 'skills', name), { recursive: true });
  copyFileSync(fileURLToPath(new URL(`./${name}.SKILL.md`, import.meta.url)), join(served, '.claude', 'skills', name, 'SKILL.md'));
}
const empty = mkdtempSync(join(tmpdir(), 'skill-empty-'));

test('a served folder with on-the-road ends the append with its body, frontmatter gone', () => {
  const append = systemAppend(served);
  assert.ok(append.startsWith(read('claude')));
  assert.ok(append.endsWith('# On the road\n\nKeep every answer to two sentences.'));
  assert.ok(!append.includes('description:'));
});

test('no skill file, or --skill none, leaves the Claude prompt alone', () => {
  assert.equal(systemAppend(empty), read('claude'));
  assert.equal(systemAppend(served, 'none'), read('claude'));
});

test('CLAUDE_SKILL=other loads that skill instead', () => {
  process.env['CLAUDE_SKILL'] = 'other';
  try {
    const append = systemAppend(served);
    assert.ok(append.endsWith('# Other\n\nAnswer in one word.'));
    assert.ok(!append.includes('On the road'));
  } finally {
    delete process.env['CLAUDE_SKILL'];
  }
});
