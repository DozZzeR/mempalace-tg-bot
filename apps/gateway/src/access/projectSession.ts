import type { PalaceAdapter, PalaceDrawer, PalaceFragment } from "../palace/adapter.ts";
import type { Wing } from "../palace/noteTarget.ts";
import type { Registry } from "./registry.ts";

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
  readonly projectId: string;

  private constructor(wing: Wing, palace: PalaceAdapter, projectId: string) {
    this.#wing = wing;
    this.#palace = palace;
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
    const wing = registry.resolveWingFor(callerId, projectId);
    if (wing === undefined) return undefined;
    return new ProjectSession(wing, palace, projectId);
  }

  search(query: string, limit = 8): Promise<PalaceFragment[]> {
    return this.#palace.search(this.#wing, query, limit);
  }

  read(key: string): Promise<PalaceDrawer | undefined> {
    return this.#palace.drawer(this.#wing, key);
  }
}
