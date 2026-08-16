import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type {
  AdminSessionResponse,
  AdminStateResponse,
  CreateNoteRequest,
  DrawerResponse,
  ErrorResponse,
  ListNotesResponse,
  NoteKind,
  ProjectsResponse,
  SearchResponse,
} from "@mempalace-bot/contract";
import type { Registry, Caller } from "./access/registry.ts";
import { ProjectSession } from "./access/projectSession.ts";
import type { AdminStore } from "./access/admin.ts";
import { AnswerService } from "./answer/answerService.ts";
import type { PalaceAdapter } from "./palace/adapter.ts";

/**
 * Palace Gateway HTTP surface. Every access decision in the system is taken in
 * this file or in the registry it calls; the bot takes none.
 *
 * Two response conventions carry weight and should not be "improved":
 *  - a project the caller may not see is reported exactly as one that does not
 *    exist, so a response never leaks existence;
 *  - errors are coarse on purpose. Detail here is detail an attacker reads.
 */

export type ServerDeps = {
  registry: Registry;
  palace: PalaceAdapter;
  /** Shared secret the bot presents. */
  token: string;
  /** Absent means verbatim search and no composed prose. */
  answers?: AnswerService;
  /** Absent means there is no admin surface at all. */
  admin?: AdminStore;
  /** How long an opened admin session lasts. */
  adminTtlMs?: number;
  /** Vitest wants silence; production wants logs. */
  logger?: boolean;
};

const SEARCH_LIMIT = 8;

declare module "fastify" {
  interface FastifyRequest {
    caller?: Caller;
    /** Set even for strangers, who may only ask for access. */
    callerId?: number;
  }
}

function fail(reply: FastifyReply, status: number, body: ErrorResponse): void {
  void reply.code(status).send(body);
}

const NOT_FOUND: ErrorResponse = { error: "not found", code: "not_found" };

const DEFAULT_ADMIN_TTL_MS = 15 * 60 * 1000;
const NOTE_KINDS: readonly NoteKind[] = ["thought", "plan", "message"];
const MAX_NOTE_LENGTH = 4000;

function asKind(value: unknown): NoteKind | undefined {
  return NOTE_KINDS.find((kind) => kind === value);
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });

  app.get("/healthz", async () => ({ ok: true }));

  /**
   * Cuts 1 and 2 of the access model, applied before any route body runs:
   * the caller must be our bot, and the human must be on the allowlist.
   */
  app.addHook("preHandler", async (request, reply) => {
    if (request.url === "/healthz") return;

    const header = request.headers.authorization;
    if (header !== `Bearer ${deps.token}`) {
      fail(reply, 401, { error: "unauthorized", code: "forbidden" });
      return;
    }

    const raw = request.headers["x-telegram-user-id"];
    const userId = Number(Array.isArray(raw) ? raw[0] : raw);
    if (!Number.isInteger(userId)) {
      fail(reply, 400, { error: "missing caller", code: "bad_request" });
      return;
    }

    // Asking for access is the one thing a stranger may do. It grants nothing;
    // it only records that they asked, so an admin has something to act on.
    if (request.url === "/access-requests") {
      request.callerId = userId;
      return;
    }

    const caller = deps.registry.caller(userId);
    if (caller === undefined) {
      // Not on the allowlist: the bot answers such people not at all.
      fail(reply, 403, { error: "forbidden", code: "forbidden" });
      return;
    }
    request.caller = caller;
    request.callerId = userId;
  });

  /**
   * Every admin route passes through here. An admin without an open session is
   * refused exactly like a non-admin, so the routes do not advertise that an
   * admin surface exists.
   */
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/admin")) return;
    if (request.url === "/admin/session" && request.method === "POST") return;

    const admin = deps.admin;
    const caller = request.caller;

    // Two distinct answers on purpose. Someone who is not an admin gets a plain
    // 404: nothing should confirm that an admin API exists here. An admin who
    // simply has not opened a session gets a 403, because for them the useful
    // information is "unlock first", not "this does not exist".
    if (admin === undefined || caller === undefined || !caller.isAdmin) {
      return fail(reply, 404, NOT_FOUND);
    }
    if (!admin.hasSession(caller.id)) {
      return fail(reply, 403, { error: "admin session required", code: "forbidden" });
    }
  });

  app.get("/projects", async (request, reply) => {
    const caller = request.caller;
    if (caller === undefined) return fail(reply, 403, NOT_FOUND);

    const body: ProjectsResponse = {
      projects: deps.registry.visibleTo(caller.id),
    };
    return reply.send(body);
  });

  app.get<{ Params: { id: string }; Querystring: { q?: string } }>(
    "/projects/:id/search",
    async (request, reply) => {
      const caller = request.caller;
      if (caller === undefined) return fail(reply, 403, NOT_FOUND);

      const query = (request.query.q ?? "").trim();
      if (query === "") {
        return fail(reply, 400, { error: "empty query", code: "bad_request" });
      }

      // Cut 3. Undefined covers "no such project", "forbidden wing" and
      // "outside this caller's set" alike — the caller cannot tell which.
      const session = ProjectSession.open(
        deps.registry,
        deps.palace,
        caller.id,
        request.params.id,
      );
      if (session === undefined) return fail(reply, 404, NOT_FOUND);

      const title =
        deps.registry
          .visibleTo(caller.id)
          .find((project) => project.id === request.params.id)?.title ??
        request.params.id;

      const answers = deps.answers ?? new AnswerService();
      const result = await answers.answer(session, title, query, {
        maxFragments: SEARCH_LIMIT,
      });

      const body: SearchResponse = {
        projectId: request.params.id,
        query,
        synthesized: result.synthesized,
        ...(result.answer === undefined ? {} : { answer: result.answer }),
        fragments: result.fragments.map((fragment) => ({
          text: fragment.text,
          score: fragment.score,
          provenance: {
            hall: fragment.hall,
            room: fragment.room,
            createdAt: fragment.createdAt,
          },
        })),
      };
      return reply.send(body);
    },
  );

  app.get<{ Params: { id: string; key: string } }>(
    "/projects/:id/drawers/:key",
    async (request, reply) => {
      const caller = request.caller;
      if (caller === undefined) return fail(reply, 403, NOT_FOUND);

      const wing = deps.registry.resolveWingFor(caller.id, request.params.id);
      if (wing === undefined) return fail(reply, 404, NOT_FOUND);

      const drawer = await deps.palace.drawer(wing, request.params.key);
      if (drawer === undefined) return fail(reply, 404, NOT_FOUND);

      const body: DrawerResponse = {
        projectId: request.params.id,
        key: drawer.key,
        text: drawer.text,
        provenance: {
          hall: drawer.hall,
          room: drawer.room,
          createdAt: drawer.createdAt,
        },
      };
      return reply.send(body);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/projects/:id/notes",
    async (request, reply) => {
      const caller = request.caller;
      if (caller === undefined) return fail(reply, 403, NOT_FOUND);

      const session = ProjectSession.open(
        deps.registry,
        deps.palace,
        caller.id,
        request.params.id,
      );
      if (session === undefined) return fail(reply, 404, NOT_FOUND);

      const body: ListNotesResponse = {
        projectId: request.params.id,
        notes: await session.notes(),
      };
      return reply.send(body);
    },
  );

  /**
   * The only write in the system.
   *
   * Note what is read off the body: text, kind, and an addressee. Nothing else,
   * and deliberately no destination — the session computes that from the wing
   * it was opened with. Extra fields in the body are ignored rather than
   * merged, so `{"text":"x","wing":"family"}` writes "x" to this project and
   * nothing else happens.
   */
  app.post<{ Params: { id: string }; Body: CreateNoteRequest }>(
    "/projects/:id/notes",
    async (request, reply) => {
      const caller = request.caller;
      if (caller === undefined) return fail(reply, 403, NOT_FOUND);

      const body = (request.body ?? {}) as Partial<CreateNoteRequest>;
      const text = typeof body.text === "string" ? body.text.trim() : "";
      const kind = asKind(body.kind);

      if (text === "" || text.length > MAX_NOTE_LENGTH) {
        return fail(reply, 400, { error: "bad text", code: "bad_request" });
      }
      if (kind === undefined) {
        return fail(reply, 400, { error: "bad kind", code: "bad_request" });
      }

      const session = ProjectSession.open(
        deps.registry,
        deps.palace,
        caller.id,
        request.params.id,
      );
      if (session === undefined) return fail(reply, 404, NOT_FOUND);

      const note = await session.writeNote({
        text,
        kind,
        ...(typeof body.to === "number" ? { to: body.to } : {}),
      });
      return reply.code(201).send(note);
    },
  );

  app.post<{ Body: { displayName?: string } }>(
    "/access-requests",
    async (request, reply) => {
      const userId = request.callerId;
      if (userId === undefined || deps.admin === undefined) {
        return fail(reply, 404, NOT_FOUND);
      }
      // Already admitted people are not turned into requests.
      if (deps.registry.caller(userId) !== undefined) {
        return reply.code(204).send();
      }
      deps.admin.requestAccess(userId, (request.body?.displayName ?? "").slice(0, 100));
      return reply.code(202).send({ ok: true });
    },
  );

  app.post<{ Body: { secret?: string } }>(
    "/admin/session",
    async (request, reply) => {
      const userId = request.callerId;
      const admin = deps.admin;
      if (admin === undefined || userId === undefined) {
        return fail(reply, 404, NOT_FOUND);
      }

      const secret = typeof request.body?.secret === "string" ? request.body.secret : "";
      if (!admin.openSession(userId, secret)) {
        // A wrong secret and a non-admin look identical from outside.
        return fail(reply, 403, { error: "forbidden", code: "forbidden" });
      }

      const body: AdminSessionResponse = {
        expiresAt: new Date(
          Date.now() + (deps.adminTtlMs ?? DEFAULT_ADMIN_TTL_MS),
        ).toISOString(),
      };
      return reply.send(body);
    },
  );

  app.delete("/admin/session", async (request, reply) => {
    deps.admin?.closeSession(request.caller?.id ?? 0);
    return reply.code(204).send();
  });

  app.get("/admin/state", async (_request, reply) => {
    const admin = deps.admin;
    if (admin === undefined) return fail(reply, 404, NOT_FOUND);

    const body: AdminStateResponse = {
      requests: admin.pending().map((entry) => ({
        telegramUserId: entry.telegramUserId,
        displayName: entry.displayName,
        requestedAt: entry.requestedAt,
      })),
      users: admin.users(),
      projects: deps.registry.published(),
    };
    return reply.send(body);
  });

  app.post<{ Params: { id: string }; Body: { approve?: boolean } }>(
    "/admin/requests/:id",
    async (request, reply) => {
      const admin = deps.admin;
      if (admin === undefined) return fail(reply, 404, NOT_FOUND);

      const target = Number(request.params.id);
      if (!Number.isInteger(target)) {
        return fail(reply, 400, { error: "bad id", code: "bad_request" });
      }
      if (!admin.decide(target, request.body?.approve === true)) {
        return fail(reply, 404, NOT_FOUND);
      }
      return reply.code(204).send();
    },
  );

  app.put<{ Params: { id: string }; Body: { projectIds?: string[] | null } }>(
    "/admin/users/:id/projects",
    async (request, reply) => {
      const admin = deps.admin;
      if (admin === undefined) return fail(reply, 404, NOT_FOUND);

      const target = Number(request.params.id);
      if (!Number.isInteger(target)) {
        return fail(reply, 400, { error: "bad id", code: "bad_request" });
      }

      const ids = request.body?.projectIds;
      admin.setProjects(target, Array.isArray(ids) ? ids : undefined);
      return reply.code(204).send();
    },
  );

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send(NOT_FOUND);
  });

  return app;
}
