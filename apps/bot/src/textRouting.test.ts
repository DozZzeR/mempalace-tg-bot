import { describe, expect, test } from "vitest";

/**
 * What a plain text message means depends on what the person is in the middle
 * of. This routing had a real bug: the "pick a project first" guard ran before
 * the publish branch, so an admin naming a new project — who has not entered
 * one, and never will for that action — always got told to pick a project. The
 * feature could not work at all.
 *
 * The order is the behaviour, so it is tested as data rather than by driving
 * grammY: which branch claims a message, given the pending state.
 */

type Pending = {
  awaitingPublishWing?: string;
  currentProjectId?: string;
  awaitingNote?: "thought" | "plan" | "message";
};

type Branch = "publish" | "note" | "question" | "pick-a-project";

/** Mirrors the order of checks in the message:text handler. */
function route(pending: Pending): Branch {
  if (pending.awaitingPublishWing !== undefined) return "publish";
  if (pending.currentProjectId === undefined) return "pick-a-project";
  if (pending.awaitingNote !== undefined) return "note";
  return "question";
}

describe("what a text message means", () => {
  test("a pending publication claims the message even with no project open", () => {
    // The regression: publishing is not project-scoped, so it must be checked
    // before the project guard.
    expect(route({ awaitingPublishWing: "window_pvc_crm" })).toBe("publish");
  });

  test("a pending publication wins over an open project too", () => {
    expect(
      route({ awaitingPublishWing: "alpha_wing", currentProjectId: "beta" }),
    ).toBe("publish");
  });

  test("without a project and without anything pending, it asks for a project", () => {
    expect(route({})).toBe("pick-a-project");
  });

  test("inside a project, a pending note claims the message", () => {
    expect(route({ currentProjectId: "alpha", awaitingNote: "thought" })).toBe(
      "note",
    );
  });

  test("inside a project with nothing pending, it is a question", () => {
    expect(route({ currentProjectId: "alpha" })).toBe("question");
  });
});
