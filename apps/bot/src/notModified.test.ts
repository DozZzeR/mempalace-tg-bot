import { describe, expect, test } from "vitest";
import { GrammyError } from "grammy";

/**
 * Telegram rejects an edit whose result is identical to what is already on
 * screen. Tapping the same button twice does exactly that, and the rejection
 * used to surface as a failure message right under the screen the person had
 * successfully asked for.
 *
 * The predicate is what decides whether an edit failure is worth telling anyone
 * about, so it is tested directly.
 */

function isNotModified(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    error.description.includes("message is not modified")
  );
}

function telegramError(code: number, description: string): GrammyError {
  return new GrammyError(
    "Call to 'editMessageText' failed!",
    { ok: false, error_code: code, description },
    "editMessageText",
    {},
  );
}

describe("recognising a no-op edit", () => {
  test("treats an unchanged message as success", () => {
    expect(
      isNotModified(
        telegramError(
          400,
          "Bad Request: message is not modified: specified new message content and reply markup are exactly the same",
        ),
      ),
    ).toBe(true);
  });

  test("does not swallow other bad requests", () => {
    // A message too long, or one too old to edit, is a real failure and must
    // still reach the person.
    expect(isNotModified(telegramError(400, "Bad Request: message is too long"))).toBe(
      false,
    );
    expect(
      isNotModified(telegramError(400, "Bad Request: message can't be edited")),
    ).toBe(false);
  });

  test("does not swallow other status codes", () => {
    expect(isNotModified(telegramError(403, "Forbidden: bot was blocked"))).toBe(
      false,
    );
    expect(isNotModified(telegramError(429, "Too Many Requests"))).toBe(false);
  });

  test("does not swallow ordinary errors", () => {
    expect(isNotModified(new Error("network down"))).toBe(false);
    expect(isNotModified(undefined)).toBe(false);
  });
});
