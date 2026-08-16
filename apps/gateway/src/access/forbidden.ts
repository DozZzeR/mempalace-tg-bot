/**
 * Wings that must never be reachable through the bot, under any configuration.
 *
 * This is deliberately a hardcoded constant and not a setting. The access model
 * says private and family wings are denied unconditionally — "not by allowlist,
 * not by configuration, and not by a default that a config file can flip". A
 * denied wing cannot be published into the registry: the registry rejects it
 * rather than trusting that nobody will try.
 */

const FORBIDDEN_EXACT = new Set(["family", "private"]);
const FORBIDDEN_PREFIXES = ["family_", "private_", "personal_"];

export function isForbiddenWing(wing: string): boolean {
  const name = wing.trim().toLowerCase();
  if (FORBIDDEN_EXACT.has(name)) return true;
  return FORBIDDEN_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export class ForbiddenWingError extends Error {
  constructor(wing: string) {
    super(`wing "${wing}" can never be published as a project`);
    this.name = "ForbiddenWingError";
  }
}
