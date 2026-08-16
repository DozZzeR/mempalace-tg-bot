import { randomUUID } from "node:crypto";
import type { Note, NoteKind } from "@mempalace-bot/contract";
import type { PalaceAdapter, PalaceDrawer, PalaceFragment } from "../palace/adapter.ts";
import { humanNoteAddress, type Wing } from "../palace/noteTarget.ts";
import { parseNote, serializeNote } from "../palace/noteRecord.ts";
import type { Caller, Registry } from "./registry.ts";

/**
 * A palace connection already bound to one project.
 *
 * The point is what this class does NOT have: no method takes a wing, a hall or
 * a room. Once opened, a session cannot be pointed anywhere else — not by a
 * caller, not by a request body, and not by a language model handed the object.
 * Scope is established once, at open(), by the registry.
 *
 * This is the surface anything untrusted gets. A reasoning layer given a
 * ProjectSession can be wrong, confused, or actively subverted by injected text
 * and still cannot read another project, because the vocabulary for saying
 * "another project" does not exist here.
 */
export class ProjectSession {
  // ECMAScript private fields, not TypeScript `private`. The difference is the
  // whole point: `private` is erased at compile time, so `session.palace` would
  // still be reachable at runtime and could be called with any wing. These are
  // genuinely inaccessible from outside the class.
  readonly #wing: Wing;
  readonly #palace: PalaceAdapter;
  readonly #caller: Caller;
  readonly projectId: string;

  private constructor(
    wing: Wing,
    palace: PalaceAdapter,
    caller: Caller,
    projectId: string,
  ) {
    this.#wing = wing;
    this.#palace = palace;
    this.#caller = caller;
    this.projectId = projectId;
  }

  /**
   * Opens a session, or returns undefined when this caller may not see this
   * project. Undefined covers "no such project", "forbidden wing" and "outside
   * the caller's set" alike — the caller cannot tell which, so a failure to
   * open never reveals that a project exists.
   */
  static open(
    registry: Registry,
    palace: PalaceAdapter,
    callerId: number,
    projectId: string,
  ): ProjectSession | undefined {
    const caller = registry.caller(callerId);
    if (caller === undefined) return undefined;

    const wing = registry.resolveWingFor(callerId, projectId);
    if (wing === undefined) return undefined;

    return new ProjectSession(wing, palace, caller, projectId);
  }

  search(query: string, limit = 8): Promise<PalaceFragment[]> {
    return this.#palace.search(this.#wing, query, limit);
  }

  read(key: string): Promise<PalaceDrawer | undefined> {
    return this.#palace.drawer(this.#wing, key);
  }

  /**
   * Files a note into this project's human room. The signature is the guarantee:
   * a caller supplies what to say, never where it lands. The address comes from
   * humanNoteAddress and the bound wing, and authorship comes from the caller
   * the registry resolved — so neither destination nor author can be forged by
   * anything upstream, including a request body and including a model.
   */
  async writeNote(input: {
    text: string;
    kind: NoteKind;
    to?: number;
  }): Promise<Note> {
    const meta = {
      id: randomUUID(),
      kind: input.kind,
      authorId: this.#caller.id,
      authorName: this.#caller.displayName,
      createdAt: new Date().toISOString(),
      // An addressee is only meaningful on a message; carrying it on a thought
      // would put a name on a record that was never sent to anyone.
      ...(input.kind === "message" && input.to !== undefined
        ? { to: input.to }
        : {}),
    };

    await this.#palace.writeNote(
      humanNoteAddress(this.#wing),
      serializeNote(meta, input.text),
    );

    return { ...meta, text: input.text };
  }

  /** What people have already written in this project. Newest first. */
  async notes(limit = 20): Promise<Note[]> {
    const stored = await this.#palace.listRoom(
      humanNoteAddress(this.#wing),
      limit,
    );
    return stored.map((entry) => parseNote(entry.text, entry.key));
  }
}
