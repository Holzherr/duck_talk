/**
 * The acknowledgement: one "Mm-hm" when a spoken turn starts, none for a barge-in. A real
 * Session with Claude and the ears stubbed at the module boundary; the fake voice model
 * answers the acknowledgement with 1s and the reply with 2s.
 *
 *   node --test --experimental-test-module-mocks server/fixtures/ack.test.ts
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';

process.env['PROJECT_CWD'] = mkdtempSync(join(tmpdir(), 'ack-state-'));
process.env['TURN_QUIET_MS'] = '0'; // no watchdog: a failed test must not hold the process open
delete process.env['ACK'];

let claude: any = null, ears: any = null; // the callbacks the session handed over
const sent: string[] = [];
mock.module('../claude.ts', { exports: {
  DEFAULTS: { model: null, permission: 'plan', effort: null },
  claim: (_: unknown, cb: unknown) => { claude = cb; return { chat: 'fixture-chat', send: (i: string) => sent.push(i), interrupt() {}, set() {}, stopTasks() {} }; },
  release() {},
} });
mock.module('../ears.ts', { exports: {
  openEars: async (_a: unknown, _m: unknown, cb: unknown) => { ears = cb; return { send() {}, close() {} }; },
  keyword: () => null,
} });
const { Session } = await import('../session.ts');

const chunk = (byte: number) => ({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.alloc(480, byte).toString('base64') } }] } }] });
const ai = { models: { generateContentStream: async ({ contents }: { contents: string }) => (async function* () { yield chunk(contents === 'Mm-hm.' ? 1 : 2); })() } };
const pcm: Buffer[] = [];
const acks = () => pcm.filter((b) => b[0] === 1).length;
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

const session = new Session({ pcm: (b: Buffer) => pcm.push(b), event() {} }, ai as never, 'direct', { sttModel: 's', voiceModel: 'v', autocorrect: false, readback: false }, () => {});
session.open();
session.send(Buffer.alloc(640)); // the first microphone buffer opens the ears
await tick();
test.after(() => session.close());

test('a spoken turn is acknowledged once, before the reply', async () => {
  ears.onFinal('what time is it', null);
  await tick();
  assert.deepEqual(sent, ['what time is it']);
  assert.equal(acks(), 1);
  claude.onText('It is one. ');
  await tick();
  assert.equal(pcm.at(-1)![0], 2);
});

test('a barge-in during the reply is not acknowledged', async () => {
  ears.onPartial('wait', false); // a new utterance over the reply
  ears.onFinal('wait, what day is it', null);
  await tick();
  assert.deepEqual(sent, ['what time is it', 'wait, what day is it']);
  assert.equal(acks(), 1);
});

test('the turn after the barge-in ends is acknowledged again', async () => {
  claude.onResult({ sessionId: 'fixture-chat', costUsd: 0, error: null, model: null, permission: 'plan', effort: null });
  await tick(200); // the voice waits out what it sent
  ears.onFinal('thanks, and the date', null);
  await tick();
  assert.equal(acks(), 2);
});
