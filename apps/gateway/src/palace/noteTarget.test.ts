import { describe, expect, test } from "vitest";
import { humanNoteAddress, wingFromRegistry } from "./noteTarget.ts";

describe("human note address", () => {
  test("uses the constant hall and room for any project", () => {
    const alpha = humanNoteAddress(wingFromRegistry("alpha"));
    const beta = humanNoteAddress(wingFromRegistry("beta"));

    expect(alpha).toEqual({ wing: "alpha", hall: "human", room: "notes" });
    expect(beta).toEqual({ wing: "beta", hall: "human", room: "notes" });
  });

  test("varies only in the wing", () => {
    const a = humanNoteAddress(wingFromRegistry("alpha"));
    const b = humanNoteAddress(wingFromRegistry("beta"));

    expect(a.hall).toBe(b.hall);
    expect(a.room).toBe(b.room);
    expect(a.wing).not.toBe(b.wing);
  });

  test("never lands in a hall the models write to", () => {
    const { hall } = humanNoteAddress(wingFromRegistry("alpha"));

    // The whole point of a separate hall: an agent reading project memory can
    // tell a human note from a ratified decision by address alone.
    expect(hall).not.toBe("decision");
    expect(hall).not.toBe("code");
  });
});
