import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing for the admin phrase.
 *
 * scrypt rather than a plain digest, and the reason is the point of the whole
 * change: a phrase a person can remember carries far less entropy than a random
 * string, so a bare SHA-256 of it is a dictionary attack waiting to happen.
 * scrypt makes each guess cost memory and time, which is what buys back the
 * safety the memorability spends.
 *
 * The stored form carries its own parameters — `scrypt:N:r:p:salt:key` — so the
 * cost can be raised later without invalidating hashes already in use.
 */

const N = 16384;
const R = 8;
const P = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
// scrypt needs roughly 128 * N * r bytes; Node's default cap is below that.
const MAXMEM = 128 * N * R * 2;

export async function hashSecret(phrase: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(normalize(phrase), salt, KEY_BYTES, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return `scrypt:${N}:${R}:${P}:${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifySecret(
  phrase: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? "", "hex");
  const expected = Buffer.from(parts[5] ?? "", "hex");
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = await derive(normalize(phrase), salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: 128 * n * r * 2,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Whether a stored value is a complete, usable hash.
 *
 * Checks the whole shape, not just the prefix. A value truncated while being
 * copied — easy, since it is 90-odd characters — would pass a prefix test and
 * then silently refuse the correct phrase forever, sending whoever set it up
 * looking for the fault in the phrase. Better to fail at startup and say so.
 */
export function looksLikeHash(value: string): boolean {
  const parts = value.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, salt, key] = parts;
  for (const parameter of [n, r, p]) {
    const parsed = Number(parameter);
    if (!Number.isInteger(parsed) || parsed <= 0) return false;
  }

  return (
    isHex(salt) &&
    isHex(key) &&
    (salt?.length ?? 0) >= SALT_BYTES * 2 &&
    (key?.length ?? 0) >= KEY_BYTES * 2
  );
}

function isHex(value: string | undefined): boolean {
  return value !== undefined && value.length % 2 === 0 && /^[0-9a-f]+$/.test(value);
}

/**
 * Trims and collapses inner whitespace. A phrase typed on a phone picks up a
 * trailing space or a double space between words often enough that treating
 * those as a different secret would just be a mysterious refusal.
 */
function normalize(phrase: string): string {
  return phrase.trim().replaceAll(/\s+/g, " ");
}
