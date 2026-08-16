import { describe, expect, test } from "vitest";
import { hashSecret, looksLikeHash, verifySecret } from "./secretHash.ts";

const PHRASE = "три весёлых бобра чинят плотину";

describe("admin phrase hashing", () => {
  test("accepts the phrase it was made from", async () => {
    const stored = await hashSecret(PHRASE);
    expect(await verifySecret(PHRASE, stored)).toBe(true);
  });

  test("rejects a different phrase", async () => {
    const stored = await hashSecret(PHRASE);
    expect(await verifySecret("три весёлых бобра чинят мост", stored)).toBe(false);
  });

  test("salts, so the same phrase stores differently every time", async () => {
    const a = await hashSecret(PHRASE);
    const b = await hashSecret(PHRASE);

    // Without a salt, two deployments using the same phrase would be visibly
    // identical, and one precomputed table would cover both.
    expect(a).not.toBe(b);
    expect(await verifySecret(PHRASE, b)).toBe(true);
  });

  test("carries its own parameters so cost can be raised later", async () => {
    const stored = await hashSecret(PHRASE);
    const [scheme, n, r, p] = stored.split(":");

    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  test("forgives the whitespace a phone adds", async () => {
    const stored = await hashSecret(PHRASE);

    // A trailing space or a doubled one between words is common enough on a
    // phone that treating it as a different secret is just a mystery refusal.
    expect(await verifySecret(`  ${PHRASE}  `, stored)).toBe(true);
    expect(await verifySecret(PHRASE.replace(" ", "  "), stored)).toBe(true);
  });

  test("does not forgive different words", async () => {
    const stored = await hashSecret(PHRASE);
    expect(await verifySecret(PHRASE.replace("бобра", "Бобра"), stored)).toBe(
      false,
    );
  });

  test("refuses a malformed stored value instead of throwing", async () => {
    // A truncated or hand-edited env line must fail closed, not crash the
    // gateway on every attempt.
    for (const broken of ["", "scrypt", "scrypt:1:2:3", "plain-text-secret"]) {
      expect(await verifySecret(PHRASE, broken)).toBe(false);
    }
  });

  test("recognises a hash so config can reject a raw phrase", async () => {
    expect(looksLikeHash(await hashSecret(PHRASE))).toBe(true);
    expect(looksLikeHash(PHRASE)).toBe(false);
  });

  test("rejects a hash cut short while copying", async () => {
    const stored = await hashSecret(PHRASE);

    // The value is ~100 characters, so a partial paste is easy. A prefix check
    // would accept it, and then the correct phrase would be refused forever
    // with the fault looking like it lay in the phrase.
    for (const cut of [20, 40, 60, stored.length - 10]) {
      expect(looksLikeHash(stored.slice(0, cut))).toBe(false);
    }
  });

  test("rejects a hash with a mangled parameter", async () => {
    const stored = await hashSecret(PHRASE);
    const parts = stored.split(":");

    expect(looksLikeHash(["scrypt", "abc", parts[2], parts[3], parts[4], parts[5]].join(":"))).toBe(
      false,
    );
    expect(looksLikeHash(["bcrypt", ...parts.slice(1)].join(":"))).toBe(false);
  });

  test("rejects a salt or key that is not hex", async () => {
    const parts = (await hashSecret(PHRASE)).split(":");
    expect(
      looksLikeHash(["scrypt", parts[1], parts[2], parts[3], "ZZZZ", parts[5]].join(":")),
    ).toBe(false);
  });
});
