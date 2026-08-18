import { describe, expect, test } from "vitest";
import type { Note } from "@mempalace-bot/contract";
import { notesListView } from "./views.ts";

function note(text: string, over: Partial<Note> = {}): Note {
  return {
    id: "n1",
    text,
    kind: "thought",
    authorId: 1,
    authorName: "Alex",
    createdAt: "2026-08-18T15:20:00.000Z",
    ...over,
  };
}

describe("the notes list", () => {
  test("puts every note in an expandable quote", () => {
    const view = notesListView([note("одна"), note("две")]);

    // Telegram collapses a long quote itself and offers its own expand in
    // place — no button, no round trip, nothing to go stale.
    expect(view.text.match(/<blockquote expandable>/g)).toHaveLength(2);
  });

  test("carries the whole note, not a clipped version", () => {
    const long = "п".repeat(900);
    expect(notesListView([note(long)]).text).toContain(long);
  });

  test("keeps kind, author and date on the header line", () => {
    const view = notesListView([note("текст", { kind: "plan" })]);

    expect(view.text).toContain("план");
    expect(view.text).toContain("Alex");
    expect(view.text).toContain("2026-08-18");
  });

  test("marks a message addressed to the reader", () => {
    const view = notesListView([note("привет", { kind: "message", to: 42 })], 42);
    expect(view.text).toContain("вам");
  });

  test("does not mark a message addressed to somebody else", () => {
    const view = notesListView([note("привет", { kind: "message", to: 7 })], 42);
    expect(view.text).not.toContain("вам");
  });

  test("escapes stored text before Telegram sees it", () => {
    const view = notesListView([note("<b>не разметка</b>")]);
    expect(view.text).toContain("&lt;b&gt;");
    expect(view.text).not.toContain("<b>не разметка");
  });

  test("stays inside one Telegram message", () => {
    const many = Array.from({ length: 30 }, (_, i) => note("я".repeat(400) + i));
    const view = notesListView(many);

    // Fitting fewer notes in full beats showing more of them mangled.
    expect(view.text.length).toBeLessThan(4096);
    expect(view.text).toContain("Показаны последние");
  });

  test("always shows at least one note, however long", () => {
    const view = notesListView([note("я".repeat(9000))]);

    expect(view.text.length).toBeLessThan(4096);
    expect(view.text).toContain("<blockquote expandable>");
  });

  test("says nothing about omissions when everything fits", () => {
    expect(notesListView([note("коротко")]).text).not.toContain("Показаны последние");
  });

  test("offers writing and leaving, and nothing per-note", () => {
    const view = notesListView([note("одна"), note("две")]);
    const data = view.buttons.flat().map((b: { data: string }) => b.data);

    expect(data).toEqual(["note", "back"]);
  });

  test("invites the first note when the room is empty", () => {
    const view = notesListView([]);
    expect(view.text).toContain("Будете первым");
    expect(view.text).not.toContain("blockquote");
  });
});
