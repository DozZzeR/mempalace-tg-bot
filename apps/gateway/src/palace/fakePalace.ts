import type {
  PalaceAdapter,
  PalaceDrawer,
  PalaceFragment,
} from "./adapter.ts";
import type { Wing } from "./noteTarget.ts";

/**
 * A hand-written fake honouring the adapter contract, for tests.
 *
 * It is deliberately *permissive*: it returns whatever wing is asked for,
 * including wings the gateway should never ask about. A fake that refused
 * would hide exactly the bug the access tests exist to catch — the tests must
 * prove the gateway never asks, not that the palace would have said no.
 */
export class FakePalace implements PalaceAdapter {
  readonly searched: Array<{ wing: string; query: string }> = [];
  readonly writes: unknown[] = [];

  private readonly contents: Record<
    string,
    Array<{ text: string; hall?: string; room?: string; key?: string }>
  >;

  constructor(
    contents: Record<
      string,
      Array<{ text: string; hall?: string; room?: string; key?: string }>
    > = {},
  ) {
    this.contents = contents;
  }

  async search(wing: Wing, query: string): Promise<PalaceFragment[]> {
    this.searched.push({ wing, query });
    const entries = this.contents[wing] ?? [];
    return entries
      .filter((entry) => entry.text.includes(query))
      .map((entry) => ({
        text: entry.text,
        hall: entry.hall ?? "decision",
        room: entry.room ?? "general",
        createdAt: "2026-08-16T00:00:00.000Z",
        score: 0.9,
      }));
  }

  async drawer(wing: Wing, key: string): Promise<PalaceDrawer | undefined> {
    const entry = (this.contents[wing] ?? []).find((item) => item.key === key);
    if (entry === undefined) return undefined;
    return {
      key,
      text: entry.text,
      hall: entry.hall ?? "decision",
      room: entry.room ?? "general",
      createdAt: "2026-08-16T00:00:00.000Z",
    };
  }

  async listWings(): Promise<string[]> {
    return Object.keys(this.contents);
  }
}
