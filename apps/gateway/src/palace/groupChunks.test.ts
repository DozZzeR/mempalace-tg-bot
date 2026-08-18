import { describe, expect, test } from "vitest";
import { groupChunks } from "./mcpAdapter.ts";

describe("rejoining a chunked drawer", () => {
  test("keeps an unchunked drawer as itself", () => {
    const groups = groupChunks(["drawer_wing_notes_abc"]);
    expect([...groups.keys()]).toEqual(["drawer_wing_notes_abc"]);
    expect(groups.get("drawer_wing_notes_abc")).toEqual(["drawer_wing_notes_abc"]);
  });

  test("gathers the chunks of one drawer under one key", () => {
    const groups = groupChunks([
      "drawer_wing_notes_abc_chunk_000000",
      "drawer_wing_notes_abc_chunk_000001",
    ]);

    expect([...groups.keys()]).toEqual(["drawer_wing_notes_abc"]);
    expect(groups.get("drawer_wing_notes_abc")).toHaveLength(2);
  });

  test("orders chunks even when the listing does not", () => {
    const groups = groupChunks([
      "d_chunk_000002",
      "d_chunk_000000",
      "d_chunk_000001",
    ]);

    // The split can fall mid-word, so the wrong order corrupts the text
    // rather than merely reordering it.
    expect(groups.get("d")).toEqual([
      "d_chunk_000000",
      "d_chunk_000001",
      "d_chunk_000002",
    ]);
  });

  test("keeps separate drawers separate", () => {
    const groups = groupChunks([
      "one_chunk_000000",
      "two_chunk_000000",
      "one_chunk_000001",
    ]);

    expect(groups.size).toBe(2);
    expect(groups.get("one")).toHaveLength(2);
    expect(groups.get("two")).toHaveLength(1);
  });

  test("does not mistake a chunk-like tail in a real id", () => {
    // Only a trailing _chunk_<digits> is a chunk marker.
    const groups = groupChunks(["drawer_chunk_notes_abc"]);
    expect([...groups.keys()]).toEqual(["drawer_chunk_notes_abc"]);
  });
});
