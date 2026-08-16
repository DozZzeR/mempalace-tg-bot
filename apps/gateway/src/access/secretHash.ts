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

export function looksLikeHash(value: string): boolean {
  return value.startsWith("scrypt:");
}

/**
 * Trims and collapses inner whitespace. A phrase typed on a phone picks up a
 * trailing space or a double space between words often enough that treating
 * those as a different secret would just be a mysterious refusal.
 */
function normalize(phrase: string): string {
  return phrase.trim().replaceAll(/\s+/g, " ");
}
