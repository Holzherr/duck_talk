/**
 * Who may open a socket: the relay runs Claude with file and shell access, so a socket
 * is a shell on this Mac, and only someone holding the relay's token gets one.
 *
 * The token is `DUCK_TALK_TOKEN` when the environment sets it, and otherwise one minted
 * on first start and kept in `.duck-talk/token` (mode 0600), so a restart does not
 * log the phone out. The phone sends it as `Authorization: Bearer <token>`; `?token=`
 * is accepted too, for clients that cannot set a header (probe.ts on Node's WebSocket).
 *
 * Checked at the upgrade, before any socket or session exists, so nothing an
 * unauthenticated client sends reaches Claude, Gemini or the store. Compared in
 * constant time over SHA-256 digests, which also makes the two lengths equal.
 *
 * A request from a web page is refused outright: a browser always sends an `Origin`
 * (`http(s)://…`, or `null`), while the app's URLSession and the Node clients send none.
 * That is what keeps a page open on this Mac from dialling ws://localhost.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { state } from './paths.ts';

/** The relay's token: the environment's, or the one kept beside the project's state. */
export function token(): string {
  const env = process.env['DUCK_TALK_TOKEN']?.trim();
  if (env) return env;
  const file = state('token');
  try {
    const kept = readFileSync(file, 'utf8').trim();
    if (kept) return kept;
  } catch { /* first start: minted below */ }
  const minted = randomBytes(32).toString('base64url');
  writeFileSync(file, `${minted}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return minted;
}

function digest(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

/** What the client presented: the bearer header, else `?token=`. */
function presented(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return new URL(req.url ?? '/', 'ws://x').searchParams.get('token');
}

/** Null when the request may open a socket, else the HTTP status to refuse it with. */
export function refusal(req: IncomingMessage, expected: string): 401 | 403 | null {
  const origin = req.headers.origin;
  if (origin !== undefined && !/^wss?:\/\//i.test(origin)) return 403;
  const got = presented(req);
  if (got === null || !timingSafeEqual(digest(got), digest(expected))) return 401;
  return null;
}
