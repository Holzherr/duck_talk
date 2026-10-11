/**
 * Who gets a socket: the relay started for real in a throwaway folder, then dialled the
 * ways an attacker would — no token, a wrong one, from a web page, from the network.
 *
 *   node --test server/fixtures/auth.test.ts
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';

const CLI = fileURLToPath(new URL('../cli.ts', import.meta.url));
const PORT = 8800 + Math.floor(Math.random() * 100);
const TOKEN = 'test-token-0123456789';
let relay: ChildProcess;

before(async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'auth-served-'));
  const env = { ...process.env, GEMINI_API_KEY: 'not-a-real-key', DUCK_TALK_TOKEN: TOKEN, PROJECT_CWD: cwd };
  delete env['HOST'];
  relay = spawn(process.execPath, [CLI, '--port', String(PORT)], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay did not start')), 15_000);
    relay.stdout!.on('data', (d: Buffer) => { if (String(d).includes('simulator')) { clearTimeout(timer); resolve(); } });
    relay.on('exit', (code) => reject(new Error(`relay exited ${code}`)));
  });
});
after(() => { relay.kill(); });

/** The HTTP status the upgrade was refused with, 101 when a socket opened, or the error code. */
function dial(url: string, headers: Record<string, string> = {}): Promise<number | string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.on('open', () => { ws.close(); resolve(101); });
    ws.on('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode ?? 0); });
    ws.on('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message));
  });
}

const local = `ws://127.0.0.1:${PORT}/?data=1`;
const bearer = { Authorization: `Bearer ${TOKEN}` };

test('no token is refused before a socket exists', async () => {
  assert.equal(await dial(local), 401);
  assert.equal(await dial(`ws://127.0.0.1:${PORT}/?mode=direct`), 401);
});

test('a wrong token is refused, whatever its length', async () => {
  assert.equal(await dial(local, { Authorization: 'Bearer nope' }), 401);
  assert.equal(await dial(local, { Authorization: `Bearer ${TOKEN}x` }), 401);
  assert.equal(await dial(`${local}&token=nope`), 401);
});

test('a web page is refused even with the token', async () => {
  assert.equal(await dial(local, { ...bearer, Origin: 'https://evil.example' }), 403);
  assert.equal(await dial(local, { ...bearer, Origin: 'null' }), 403);
});

test('the token opens a socket, as a header or in the query', async () => {
  assert.equal(await dial(local, bearer), 101);
  assert.equal(await dial(`${local}&token=${TOKEN}`), 101);
});

test('only loopback is listened on by default', async (t) => {
  const lan = Object.values(networkInterfaces()).flat().find((a) => a?.family === 'IPv4' && !a.internal)?.address;
  if (!lan) return t.skip('no non-loopback IPv4 address on this machine');
  assert.equal(await dial(`ws://${lan}:${PORT}/?data=1`, bearer), 'ECONNREFUSED');
});

test('without DUCK_TALK_TOKEN a token is minted once, private to this user', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'auth-mint-'));
  process.env['PROJECT_CWD'] = cwd;
  delete process.env['DUCK_TALK_TOKEN'];
  const { token } = await import('../auth.ts');
  const first = token();
  assert.ok(first.length >= 40);
  assert.equal(token(), first);
  const file = join(cwd, '.duck-talk', 'token');
  assert.equal(readFileSync(file, 'utf8').trim(), first);
  assert.equal(statSync(file).mode & 0o777, 0o600);
});
