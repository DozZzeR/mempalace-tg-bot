import { describe, expect, test } from "vitest";
import type { Fragment } from "@mempalace-bot/contract";
import { answerPages, answerView } from "./views.ts";

function fragment(text: string): Fragment {
  return {
    text,
    score: 0.9,
    provenance: {
      hall: "decision",
      room: "decisions",
      createdAt: "2026-08-16T10:00:00.000Z",
    },
  };
}

describe("composed answers", () => {
  test("puts the prose first and keeps the sources after it", () => {
    const pages = answerPages({
      answer: "Релизят по вторникам.",
      fragments: [fragment("ship on Tuesdays")],
    });

    expect(pages.length).toBe(2);
    expect(pages[0]).toContain("Релизят по вторникам.");
    // The record is never dropped in favour of the prose: a composed answer is
    // a translation, and the reader has to be able to check it.
    expect(pages[1]).toContain("ship on Tuesdays");
  });

  test("says how many records the prose was built from", () => {
    const pages = answerPages({
      answer: "Ответ.",
      fragments: [fragment("a"), fragment("b")],
    });
    expect(pages[0]).toContain("из 2 записей");
  });

  test("shows only fragments when no prose was composed", () => {
    const pages = answerPages({ fragments: [fragment("raw")] });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("raw");
  });

  test("escapes model output before it reaches Telegram", () => {
    const pages = answerPages({
      answer: "<script>alert(1)</script>",
      fragments: [fragment("x")],
    });
    expect(pages[0]).not.toContain("<script>");
    expect(pages[0]).toContain("&lt;script&gt;");
  });

  test("marks only the composed page as model output", () => {
    const pages = answerPages({
      answer: "Ответ.",
      fragments: [fragment("source")],
    });

    const first = answerView(pages, 0, { synthesized: true });
    const second = answerView(pages, 1, { synthesized: true });

    expect(first.text).toContain("собран моделью");
    // Labelling the source page as model output would misrepresent the record.
    expect(second.text).not.toContain("собран моделью");
  });
});
