import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type {
  DrawerResponse,
  ErrorResponse,
  ProjectsResponse,
  SearchResponse,
} from "@mempalace-bot/contract";
import type { Registry, Caller } from "./access/registry.ts";
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
      const wing = deps.registry.resolveWingFor(caller.id, request.params.id);
      if (wing === undefined) return fail(reply, 404, NOT_FOUND);

      const fragments = await deps.palace.search(wing, query, SEARCH_LIMIT);
      const body: SearchResponse = {
        projectId: request.params.id,
        query,
        synthesized: false,
        fragments: fragments.map((fragment) => ({
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

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send(NOT_FOUND);
  });

  return app;
}
