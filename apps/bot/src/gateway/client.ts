import type {
  CreateNoteRequest,
  ListNotesResponse,
  Note,
  Project,
  ProjectsResponse,
  SearchResponse,
} from "@mempalace-bot/contract";

/**
 * The bot's view of the Palace Gateway. Note the shape of every call: a user id
 * and a project id, never a wing. The bot cannot express a palace location, and
 * takes no access decision — it asks, and the gateway decides.
 */
export interface GatewayClient {
  projects(userId: number): Promise<Project[]>;
  search(
    userId: number,
    projectId: string,
    query: string,
  ): Promise<SearchResponse>;
  notes(userId: number, projectId: string): Promise<Note[]>;
  /**
   * Files a note. Note the arguments: what to say, never where it goes. The
   * gateway derives the destination, so there is nothing here for the bot to
   * get wrong.
   */
  writeNote(
    userId: number,
    projectId: string,
    note: CreateNoteRequest,
  ): Promise<Note>;
}

/** Why a call failed, in terms the bot can turn into something a person reads. */
export type GatewayFailure = "forbidden" | "not_found" | "unavailable";

export class GatewayError extends Error {
  readonly kind: GatewayFailure;

  constructor(kind: GatewayFailure, message: string) {
    super(message);
    this.name = "GatewayError";
    this.kind = kind;
  }
}

export type HttpGatewayOptions = {
  baseUrl: string;
  token: string;
  /** Injected so tests need no socket. Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
};

export class HttpGatewayClient implements GatewayClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly doFetch: typeof globalThis.fetch;

  constructor(options: HttpGatewayOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.doFetch = options.fetch ?? globalThis.fetch;
  }

  private async get<T>(path: string, userId: number): Promise<T> {
    return this.request<T>("GET", path, userId);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    userId: number,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.doFetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          "x-telegram-user-id": String(userId),
          ...(body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      throw new GatewayError(
        "unavailable",
        cause instanceof Error ? cause.message : "gateway unreachable",
      );
    }

    if (response.status === 403 || response.status === 401) {
      throw new GatewayError("forbidden", "not allowed");
    }
    if (response.status === 404) {
      throw new GatewayError("not_found", "no such project");
    }
    if (!response.ok) {
      throw new GatewayError("unavailable", `gateway said ${response.status}`);
    }

    return (await response.json()) as T;
  }

  async projects(userId: number): Promise<Project[]> {
    const body = await this.get<ProjectsResponse>("/projects", userId);
    return body.projects;
  }

  async search(
    userId: number,
    projectId: string,
    query: string,
  ): Promise<SearchResponse> {
    const path = `/projects/${encodeURIComponent(projectId)}/search?q=${encodeURIComponent(query)}`;
    return this.get<SearchResponse>(path, userId);
  }

  async notes(userId: number, projectId: string): Promise<Note[]> {
    const body = await this.get<ListNotesResponse>(
      `/projects/${encodeURIComponent(projectId)}/notes`,
      userId,
    );
    return body.notes;
  }

  async writeNote(
    userId: number,
    projectId: string,
    note: CreateNoteRequest,
  ): Promise<Note> {
    return this.request<Note>(
      "POST",
      `/projects/${encodeURIComponent(projectId)}/notes`,
      userId,
      note,
    );
  }
}
