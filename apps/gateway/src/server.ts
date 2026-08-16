import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type {
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
  /** Vitest wants silence; production wants logs. */
  logger?: boolean;
};

const SEARCH_LIMIT = 8;

declare module "fastify" {
  interface FastifyRequest {
    caller?: Caller;
  }
}

function fail(reply: FastifyReply, status: number, body: ErrorResponse): void {
  void reply.code(status).send(body);
}

const NOT_FOUND: ErrorResponse = { error: "not found", code: "not_found" };

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

    const caller = deps.registry.caller(userId);
    if (caller === undefined) {
      // Not on the allowlist: the bot answers such people not at all.
      fail(reply, 403, { error: "forbidden", code: "forbidden" });
      return;
    }
    request.caller = caller;
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

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send(NOT_FOUND);
  });

  return app;
}
