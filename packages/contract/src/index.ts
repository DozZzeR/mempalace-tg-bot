/**
 * The wire contract between the bot and the Palace Gateway.
 *
 * Read this before adding a field: the bot must never learn what a wing is
 * (R-6, and the invariant in .agents/WORKFLOW.md). Nothing here carries a wing,
 * hall, or room — the gateway maps a ProjectId to a palace address on its own
 * side, and the write address is computed there from constants. A field added
 * here that names a palace location would hand the caller the steering wheel.
 */

/** Opaque registry identifier. Not a wing name; the bot cannot derive one. */
export type ProjectId = string;

/** A project as a person sees it: a button with a label. */
export type Project = {
  id: ProjectId;
  title: string;
  description?: string;
};

/** Where a fragment came from, so an answer can be traced back. */
export type Provenance = {
  /** Human-readable location, e.g. "decisions". Never a raw wing name. */
  room: string;
  hall: string;
  createdAt: string;
};

export type Fragment = {
  text: string;
  provenance: Provenance;
  /** Similarity as reported by the palace, 0..1. Higher is closer. */
  score: number;
};

export type SearchResponse = {
  projectId: ProjectId;
  query: string;
  fragments: Fragment[];
  /** True when a model composed the prose answer rather than the palace. */
  synthesized: boolean;
  /**
   * Prose composed by the model from the fragments, in the reader's language.
   * Absent when no model ran or its answer was not grounded in the material.
   * Present or not, `fragments` always carries the record itself — the reader
   * must be able to check the prose against what was actually written.
   */
  answer?: string;
};

export type ProjectsResponse = {
  projects: Project[];
};

export type DrawerResponse = {
  projectId: ProjectId;
  key: string;
  text: string;
  provenance: Provenance;
};

/** What a person can file into a project's human room. */
export type NoteKind = "thought" | "plan" | "message";

/**
 * The write request. Note what is absent: no destination of any sort. The
 * gateway derives it from the ProjectId in the path plus two constants.
 */
export type CreateNoteRequest = {
  text: string;
  kind: NoteKind;
  /** Telegram user id of the addressee. Only meaningful when kind is "message". */
  to?: number;
};

export type Note = {
  id: string;
  text: string;
  kind: NoteKind;
  authorId: number;
  authorName: string;
  createdAt: string;
  to?: number;
};

/** Someone who can see a project, and so can be addressed in it. */
export type Member = {
  id: number;
  displayName: string;
};

export type MembersResponse = {
  members: Member[];
};

export type ListNotesResponse = {
  projectId: ProjectId;
  notes: Note[];
};

/** Someone who asked for access and is waiting on an admin. */
export type AccessRequest = {
  telegramUserId: number;
  displayName: string;
  requestedAt: string;
};

export type AdminUser = {
  telegramUserId: number;
  displayName: string;
  isAdmin: boolean;
  /** False means they see the whole registry. */
  restricted: boolean;
  projectIds: string[];
};

export type AdminStateResponse = {
  requests: AccessRequest[];
  users: AdminUser[];
  projects: Project[];
};

/**
 * A palace wing as an admin sees it while deciding what to publish. This is the
 * one place a wing name crosses the wire, and it is admin-only — ordinary
 * traffic still never names a palace location.
 */
export type AdminWing = {
  wing: string;
  published: boolean;
  projectId?: string;
};

export type AdminWingsResponse = {
  wings: AdminWing[];
};

export type AdminSessionResponse = {
  /** ISO timestamp after which admin actions stop working. */
  expiresAt: string;
};

export type ErrorResponse = {
  error: string;
  /**
   * Deliberately coarse. A project the caller may not see must be reported the
   * same way as one that does not exist, or the response leaks its existence.
   */
  code:
    | "not_found"
    | "forbidden"
    | "bad_request"
    | "rate_limited"
    | "internal";
  /** Present on rate_limited: how long to wait before trying again. */
  retryAfterSeconds?: number;
};
