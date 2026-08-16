import type {
  AdminSessionResponse,
  AdminStateResponse,
  AdminWing,
  AdminWingsResponse,
  CreateNoteRequest,
  ListNotesResponse,
  Member,
  MembersResponse,
  Note,
  ProjectsResponse,
  SearchResponse,
} from "@mempalace-bot/contract";

/**
 * The bot's view of the Palace Gateway. Note the shape of every call: a user id
 * and a project id, never a wing. The bot cannot express a palace location, and
 * takes no access decision — it asks, and the gateway decides.
 */
export interface GatewayClient {
  projects(userId: number): Promise<ProjectsResponse>;
  search(
    userId: number,
    projectId: string,
    query: string,
  ): Promise<SearchResponse>;
  notes(userId: number, projectId: string): Promise<Note[]>;
  members(userId: number, projectId: string): Promise<Member[]>;
  requestAccess(userId: number, displayName: string): Promise<void>;
  openAdminSession(userId: number, secret: string): Promise<AdminSessionResponse>;
  adminState(userId: number): Promise<AdminStateResponse>;
  decideRequest(userId: number, target: number, approve: boolean): Promise<void>;
  setUserProjects(
    userId: number,
    target: number,
    projectIds: string[] | null,
  ): Promise<void>;
  adminWings(userId: number): Promise<AdminWing[]>;
  publishProject(userId: number, wing: string, title: string): Promise<void>;
  unpublishProject(userId: number, projectId: string): Promise<void>;
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
export type GatewayFailure =
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "busy"
  | "unavailable";

export class GatewayError extends Error {
  readonly kind: GatewayFailure;
  readonly retryAfterSeconds: number | undefined;

  constructor(kind: GatewayFailure, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "GatewayError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
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
    method: "GET" | "POST" | "PUT" | "DELETE",
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
    if (response.status === 429) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        retryAfterSeconds?: number;
      };
      // "Already working on it" and "you have used your allowance" deserve
      // different words: one resolves itself, the other needs waiting.
      return Promise.reject(
        new GatewayError(
          body.error === "in_flight" ? "busy" : "rate_limited",
          body.error ?? "rate limited",
          body.retryAfterSeconds,
        ),
      );
    }
    if (!response.ok) {
      throw new GatewayError("unavailable", `gateway said ${response.status}`);
    }

    // 204 and 202 carry no body; asking for JSON would throw on success.
    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  async projects(userId: number): Promise<ProjectsResponse> {
    return this.get<ProjectsResponse>("/projects", userId);
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

  async members(userId: number, projectId: string): Promise<Member[]> {
    const body = await this.get<MembersResponse>(
      `/projects/${encodeURIComponent(projectId)}/members`,
      userId,
    );
    return body.members;
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

  async requestAccess(userId: number, displayName: string): Promise<void> {
    await this.request<void>("POST", "/access-requests", userId, { displayName });
  }

  async openAdminSession(
    userId: number,
    secret: string,
  ): Promise<AdminSessionResponse> {
    return this.request<AdminSessionResponse>("POST", "/admin/session", userId, {
      secret,
    });
  }

  async adminState(userId: number): Promise<AdminStateResponse> {
    return this.request<AdminStateResponse>("GET", "/admin/state", userId);
  }

  async decideRequest(
    userId: number,
    target: number,
    approve: boolean,
  ): Promise<void> {
    await this.request<void>("POST", `/admin/requests/${target}`, userId, {
      approve,
    });
  }

  async setUserProjects(
    userId: number,
    target: number,
    projectIds: string[] | null,
  ): Promise<void> {
    await this.request<void>("PUT", `/admin/users/${target}/projects`, userId, {
      projectIds,
    });
  }

  async adminWings(userId: number): Promise<AdminWing[]> {
    const body = await this.request<AdminWingsResponse>(
      "GET",
      "/admin/wings",
      userId,
    );
    return body.wings;
  }

  async publishProject(
    userId: number,
    wing: string,
    title: string,
  ): Promise<void> {
    await this.request<void>("POST", "/admin/projects", userId, { wing, title });
  }

  async unpublishProject(userId: number, projectId: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/admin/projects/${encodeURIComponent(projectId)}`,
      userId,
    );
  }
}
