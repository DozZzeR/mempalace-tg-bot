import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  PalaceAdapter,
  PalaceDrawer,
  PalaceFragment,
} from "./adapter.ts";
import type { Wing } from "./noteTarget.ts";

/**
 * MemPalace over MCP. The transport is a constructor argument, so HTTP and
 * stdio are two factories rather than two copies of the normalization logic.
 *
 * The wing filter is passed to the palace *and* re-applied to whatever comes
 * back. That is not belt-and-braces paranoia: the adapter contract says results
 * never exceed the requested scope, and every layer above trusts it. If the
 * palace ever widens a filter — a changed default, a renamed argument, a bug —
 * this is the line that keeps the promise.
 */

type ToolResult = {
  content?: Array<{ type: string; text?: string }>;
};

// The SDK's Transport type collides with exactOptionalPropertyTypes; keeping the
// looseness at this one seam preserves strictness everywhere else.
type SdkTransport = Parameters<Client["connect"]>[0];

export class McpPalaceAdapter implements PalaceAdapter {
  private client: Client | undefined;
  private readonly makeTransport: () => SdkTransport;

  constructor(makeTransport: () => SdkTransport) {
    this.makeTransport = makeTransport;
  }

  private async connected(): Promise<Client> {
    if (this.client !== undefined) return this.client;

    const client = new Client(
      { name: "mempalace-bot-gateway", version: "0.0.0" },
      { capabilities: {} },
    );
    await client.connect(this.makeTransport());
    this.client = client;
    return client;
  }

  private async call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const client = await this.connected();
    const result = (await client.callTool({
      name,
      arguments: args,
    })) as ToolResult;

    const text = result.content?.find((part) => part.type === "text")?.text;
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  async search(
    wing: Wing,
    query: string,
    limit: number,
  ): Promise<PalaceFragment[]> {
    const payload = await this.call("mempalace_search", { query, wing, limit });

    return readArray(payload, "results")
      .filter((entry) => readString(entry, "wing") === wing)
      .map((entry) => ({
        text: readString(entry, "text") ?? "",
        hall: readString(entry, "hall") ?? "unknown",
        room: readString(entry, "room") ?? "unknown",
        createdAt: readString(entry, "created_at") ?? "",
        score: readNumber(entry, "similarity") ?? 0,
      }))
      .filter((fragment) => fragment.text !== "");
  }

  async drawer(wing: Wing, key: string): Promise<PalaceDrawer | undefined> {
    const payload = await this.call("mempalace_get_drawer", {
      drawer_id: key,
      wing,
    });
    if (payload === null || typeof payload !== "object") return undefined;

    // A drawer fetched by id must still belong to the requested wing; a stale
    // or guessed id must not become a way to read another project.
    if (readString(payload, "wing") !== wing) return undefined;

    const text = readString(payload, "content") ?? readString(payload, "text");
    if (text === undefined) return undefined;

    return {
      key,
      text,
      hall: readString(payload, "hall") ?? "unknown",
      room: readString(payload, "room") ?? "unknown",
      createdAt: readString(payload, "created_at") ?? "",
    };
  }

  async listWings(): Promise<string[]> {
    const payload = await this.call("mempalace_list_wings", {});
    if (payload === null || typeof payload !== "object") return [];
    const wings = (payload as Record<string, unknown>)["wings"];
    if (wings === null || typeof wings !== "object") return [];
    return Object.keys(wings as Record<string, unknown>);
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
  }
}

/**
 * The palace on another host, over HTTPS. Needs a credential, and the
 * credential's scope is then the palace's business as much as ours.
 */
export function httpPalace(options: {
  url: string;
  authorization: string;
}): McpPalaceAdapter {
  return new McpPalaceAdapter(
    () =>
      new StreamableHTTPClientTransport(new URL(options.url), {
        requestInit: {
          headers: { Authorization: options.authorization },
        },
      }) as unknown as SdkTransport,
  );
}

/**
 * The palace as a child process on the same host — the shape to prefer once the
 * gateway sits next to MemPalace on Hetzner. No port, no token, nothing to
 * leak; the connection's scope is set by how the process is launched (env such
 * as MEMPALACE_ACCESS_PROFILE) rather than by a bearer string.
 */
export function stdioPalace(options: {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}): McpPalaceAdapter {
  return new McpPalaceAdapter(
    () =>
      new StdioClientTransport({
        command: options.command,
        args: options.args ?? [],
        // Inheriting the gateway's whole environment would hand the child every
        // secret the gateway holds, including the Telegram token. Pass only
        // what was asked for.
        env: options.env ?? {},
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      }) as unknown as SdkTransport,
  );
}

function readArray(payload: unknown, key: string): unknown[] {
  if (payload === null || typeof payload !== "object") return [];
  const value = (payload as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}

function readString(entry: unknown, key: string): string | undefined {
  if (entry === null || typeof entry !== "object") return undefined;
  const value = (entry as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(entry: unknown, key: string): number | undefined {
  if (entry === null || typeof entry !== "object") return undefined;
  const value = (entry as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}
