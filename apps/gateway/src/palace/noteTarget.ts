/**
 * The single write address computation for the whole system (R-8, R-9).
 *
 * This is the one file allowed to name a hall or a room; the lint rule in
 * eslint.config.js enforces that everywhere else. Do not make this pluggable,
 * configurable per request, or overridable — that would turn the invariant into
 * an option.
 */

declare const wingBrand: unique symbol;

/**
 * A palace wing name. Branded on purpose: a `Wing` can only be produced by the
 * project registry, so a raw string off a request body cannot be passed here
 * even by accident. The type system carries the rule, not a comment.
 */
export type Wing = string & { readonly [wingBrand]: true };

export type PalaceAddress = {
  readonly wing: Wing;
  readonly hall: string;
  readonly room: string;
};

const HUMAN_HALL = "human";
const HUMAN_ROOM = "notes";

/**
 * Where a person's note goes. The wing is the only variable part; the rest is
 * constant across every project in the palace.
 */
export function humanNoteAddress(wing: Wing): PalaceAddress {
  return { wing, hall: HUMAN_HALL, room: HUMAN_ROOM };
}

/**
 * Mints a Wing. Call this only from the project registry, after a project id
 * has been resolved against published projects for the calling user — never on
 * a value that came in with the request.
 */
export function wingFromRegistry(name: string): Wing {
  return name as Wing;
}
