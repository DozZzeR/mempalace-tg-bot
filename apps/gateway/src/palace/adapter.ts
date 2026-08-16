import type { PalaceAddress, Wing } from "./noteTarget.ts";

/**
 * The palace behind an interface. Everything above this line is unaware of how
 * MemPalace is actually reached (D-2) — MCP over HTTP today, possibly something
 * else later. Raw palace payloads are normalized here and nowhere else.
 *
 * Note what every method takes: a `Wing`, which only the registry can mint. An
 * adapter cannot be called with a location that came off a request.
 */

export type PalaceFragment = {
  text: string;
  hall: string;
  room: string;
  createdAt: string;
  /** 0..1, higher is closer. */
  score: number;
};

export type PalaceDrawer = {
  key: string;
  text: string;
  hall: string;
  room: string;
  createdAt: string;
};

export interface PalaceAdapter {
  /**
   * Search within one wing. An adapter that returns fragments from outside the
   * given wing is a contract violation, not a performance win — callers rely on
   * the scope holding here.
   */
  search(wing: Wing, query: string, limit: number): Promise<PalaceFragment[]>;

  /** Full text of one drawer, or undefined when it is not in this wing. */
  drawer(wing: Wing, key: string): Promise<PalaceDrawer | undefined>;

  /** Wings the palace itself will admit to. Used to validate the registry. */
  listWings(): Promise<string[]>;

  /**
   * The only write in the system. It takes a full `PalaceAddress`, which can
   * only be produced by `humanNoteAddress` — there is no overload that accepts
   * a wing, hall and room separately, so a caller cannot assemble a
   * destination of its own.
   */
  writeNote(address: PalaceAddress, content: string): Promise<string>;

  /** Everything in one room, newest first. Used to show a project's notes. */
  listRoom(
    address: PalaceAddress,
    limit: number,
  ): Promise<Array<{ key: string; text: string }>>;
}
