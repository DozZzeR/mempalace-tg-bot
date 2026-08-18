import { describe, expect, test } from "vitest";
import type { Note } from "@mempalace-bot/contract";
import { notesListView, noteView } from "./views.ts";

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

const LONG = "п".repeat(900);

describe("the notes list", () => {
  test("shows a clipped version, not the whole note", () => {
    const view = notesListView([note(LONG)]);

    // Ten notes at full length is a wall nobody reads, so the list stays
    // skimmable and the full text waits to be asked for.
    expect(view.text.length).toBeLessThan(LONG.length);
    expect(view.text).toContain("…");
  });

  test("says how much was left out", () => {
    const view = notesListView([note(LONG)]);
    expect(view.text).toContain("ещё 600 симв.");
  });

  test("does not clip a note that already fits", () => {
    const view = notesListView([note("короткая мысль")]);
    expect(view.text).toContain("короткая мысль");
    expect(view.text).not.toContain("симв.");
  });

  test("numbers the entries and offers one opener each", () => {
    const view = notesListView([note("одна"), note("две"), note("три")]);

    expect(view.text).toContain("1.");
    expect(view.text).toContain("3.");
    expect(view.buttons.flat().map((b) => b.data)).toEqual(
      expect.arrayContaining(["open-note:0", "open-note:1", "open-note:2"]),
    );
  });

  test("groups openers so they do not bury the list", () => {
    const many = Array.from({ length: 7 }, (_, i) => note(`n${i}`));
    const rows = notesListView(many).buttons.filter((row) =>
      row.every((b) => b.data.startsWith("open-note:")),
    );

    // Seven numbered buttons in two rows, not seven rows.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(5);
  });

  test("marks a message addressed to the reader", () => {
    const view = notesListView(
      [note("привет", { kind: "message", to: 42 })],
      42,
    );
    expect(view.text).toContain("вам");
  });

  test("says when older notes were left off", () => {
    const many = Array.from({ length: 14 }, (_, i) => note(`n${i}`));
    expect(notesListView(many).text).toContain("последние 10 из 14");
  });

  test("offers no openers when there is nothing written", () => {
    const view = notesListView([]);
    expect(view.buttons.flat().map((b) => b.data)).not.toContain("open-note:0");
    expect(view.text).toContain("Будете первым");
  });
});

describe("one note in full", () => {
  test("shows the whole text", () => {
    const view = noteView(note(LONG), 0);
    expect(view.text).toContain(LONG);
  });

  test("carries author, kind and time", () => {
    const view = noteView(note("мысль", { kind: "plan" }), 2);

    expect(view.text).toContain("план");
    expect(view.text).toContain("Alex");
    expect(view.text).toContain("2026-08-18");
    expect(view.text).toContain("№3");
  });

  test("escapes the stored text before Telegram sees it", () => {
    const view = noteView(note("<b>не разметка</b>"), 0);
    expect(view.text).toContain("&lt;b&gt;");
  });

  test("admits when a note is too long even for its own message", () => {
    const view = noteView(note("я".repeat(4000)), 0);

    // Telegram caps a message at 4096; silently losing the tail would be worse
    // than saying so.
    expect(view.text.length).toBeLessThan(4096);
    expect(view.text).toContain("длиннее");
  });

  test("leads back to the list", () => {
    expect(noteView(note("x"), 0).buttons.flat().map((b) => b.data)).toEqual([
      "notes",
    ]);
  });
});
