import { describe, expect, test } from "vitest";
import type { Fragment } from "@mempalace-bot/contract";
import { answerParts, proseView, sourcesView } from "./views.ts";

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

describe("splitting an answer from its sources", () => {
  test("keeps the prose apart from the passages", () => {
    const parts = answerParts({
      answer: "Релизят по вторникам.",
      fragments: [fragment("ship on Tuesdays")],
    });

    // They live in different messages, so that paging through passages cannot
    // overwrite the answer the person is reading.
    expect(parts.prose).toContain("Релизят по вторникам.");
    expect(parts.sources).toHaveLength(1);
    expect(parts.sources[0]).toContain("ship on Tuesdays");
  });

  test("says how many records the prose was built from", () => {
    const parts = answerParts({
      answer: "Ответ.",
      fragments: [fragment("a"), fragment("b")],
    });
    expect(parts.prose).toContain("из 2 записей");
  });

  test("yields no prose when the model composed none", () => {
    const parts = answerParts({ fragments: [fragment("raw")] });
    expect(parts.prose).toBeUndefined();
    expect(parts.sources).toHaveLength(1);
  });

  test("escapes model output before it reaches Telegram", () => {
    const parts = answerParts({
      answer: "<script>alert(1)</script>",
      fragments: [fragment("x")],
    });
    expect(parts.prose).not.toContain("<script>");
    expect(parts.prose).toContain("&lt;script&gt;");
  });
});

describe("the answer message", () => {
  test("is marked as composed and offers the sources", () => {
    const view = proseView("Ответ.", 3);

    expect(view.text).toContain("собран моделью");
    expect(view.buttons.flat().map((b) => b.data)).toContain("sources");
    expect(view.buttons.flat().some((b) => b.text.includes("3"))).toBe(true);
  });

  test("carries no paging of its own", () => {
    // Nothing rewrites this message; that is the point of it being separate.
    const view = proseView("Ответ.", 2);
    expect(view.buttons.flat().map((b) => b.data)).not.toContain("page:1");
  });
});

describe("the sources message", () => {
  test("does not claim the records were composed by a model", () => {
    const view = sourcesView(["источник"], 0);
    expect(view.text).not.toContain("собран моделью");
  });

  test("pages when there is more than one", () => {
    expect(sourcesView(["a", "b", "c"], 0).buttons[0]).toEqual([
      { text: "▶", data: "page:1" },
    ]);
    expect(sourcesView(["a", "b", "c"], 1).buttons[0]).toEqual([
      { text: "◀", data: "page:0" },
      { text: "▶", data: "page:2" },
    ]);
    expect(sourcesView(["a", "b", "c"], 2).buttons[0]).toEqual([
      { text: "◀", data: "page:1" },
    ]);
  });

  test("offers no paging for a single page", () => {
    expect(sourcesView(["only"], 0).buttons.flat().map((b) => b.data)).toEqual([
      "back",
    ]);
  });

  test("clamps a page index that is out of range", () => {
    expect(sourcesView(["a", "b"], 99).text).toContain("b");
  });

  test("says plainly when nothing was found", () => {
    expect(sourcesView([], 0).text).toContain("ничего не записано");
  });
});
