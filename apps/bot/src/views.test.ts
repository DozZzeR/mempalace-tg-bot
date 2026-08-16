import { describe, expect, test } from "vitest";
import type { Fragment, Project } from "@mempalace-bot/contract";
import {
  escapeHtml,
  paginate,
  projectEnteredView,
  projectListView,
} from "./views.ts";

function fragment(text: string, room = "decisions"): Fragment {
  return {
    text,
    score: 0.9,
    provenance: { hall: "decision", room, createdAt: "2026-08-16T10:00:00.000Z" },
  };
}

const ALPHA: Project = { id: "alpha", title: "Alpha" };

describe("project list", () => {
  test("offers one button per project", () => {
    const view = projectListView({
      projects: [ALPHA, { id: "beta", title: "Beta" }],
    });
    expect(view.buttons).toEqual([
      [{ text: "Alpha", data: "open:0" }],
      [{ text: "Beta", data: "open:1" }],
    ]);
  });

  test("explains an empty list instead of showing nothing", () => {
    const view = projectListView({ projects: [] });
    expect(view.buttons).toEqual([]);
    expect(view.text).toContain("администратор");
  });

  test("addresses projects by index, never by id", () => {
    // callback_data is capped at 64 bytes and project ids are free-form, so an
    // index keeps the payload bounded whatever the registry contains.
    const view = projectListView({
      projects: [{ id: "x".repeat(300), title: "Long" }],
    });
    expect(view.buttons[0]?.[0]?.data).toBe("open:0");
  });

  test("shows no admin entrance to an ordinary person", () => {
    const view = projectListView({ projects: [ALPHA] });
    expect(view.buttons.flat().map((b) => b.data)).not.toContain("adm:enter");
  });

  test("offers the admin entrance to an admin", () => {
    const view = projectListView({ projects: [ALPHA], isAdmin: true });
    expect(view.buttons.flat().map((b) => b.data)).toContain("adm:enter");
  });

  test("carries the waiting count on the way in", () => {
    const view = projectListView({
      projects: [ALPHA],
      isAdmin: true,
      pendingRequests: 2,
    });

    // On the button as well as in the text: a number you walk past is easier
    // to act on than a notice you dismiss.
    expect(view.buttons.flat().some((b) => b.text.includes("2"))).toBe(true);
    expect(view.text).toContain("Ждут решения: 2");
  });

  test("says nothing about requests when none are waiting", () => {
    const view = projectListView({
      projects: [ALPHA],
      isAdmin: true,
      pendingRequests: 0,
    });
    expect(view.text).not.toContain("Ждут решения");
  });

  test("still offers the admin entrance when there are no projects", () => {
    const view = projectListView({ projects: [], isAdmin: true });
    // Otherwise a fresh deployment with nothing published leaves the owner with
    // no way in at all.
    expect(view.buttons.flat().map((b) => b.data)).toContain("adm:enter");
  });
});

describe("escaping", () => {
  test("neutralises markup in palace content", () => {
    expect(escapeHtml("<b>x</b> & y")).toBe("&lt;b&gt;x&lt;/b&gt; &amp; y");
  });

  test("escapes a project title before it reaches Telegram", () => {
    const view = projectEnteredView({ id: "p", title: "<script>" });
    expect(view.text).toContain("&lt;script&gt;");
    expect(view.text).not.toContain("<script>");
  });
});

describe("pagination", () => {
  test("keeps a short answer on one page", () => {
    expect(paginate([fragment("short"), fragment("also short")])).toHaveLength(1);
  });

  test("splits when fragments exceed one message", () => {
    const big = Array.from({ length: 6 }, () => fragment("x".repeat(900)));
    const pages = paginate(big);

    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      // Telegram rejects anything over 4096; every page must clear it.
      expect(page.length).toBeLessThan(4096);
    }
  });

  test("says so when a single fragment had to be cut", () => {
    const pages = paginate([fragment("y".repeat(5000))]);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("сокращён");
  });

  test("carries provenance on every fragment", () => {
    const pages = paginate([fragment("decided", "adr_scope")]);
    expect(pages[0]).toContain("decision/adr_scope");
    expect(pages[0]).toContain("2026-08-16");
  });

  test("returns no pages for no fragments", () => {
    expect(paginate([])).toEqual([]);
  });
});
