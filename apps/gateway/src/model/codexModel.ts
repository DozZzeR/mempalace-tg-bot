import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ModelUnavailableError, type ModelPort, type ModelRequest } from "./port.ts";

/**
 * Codex CLI as a reasoning layer. Adapted from the provider in DozerClaw, which
 * has been running this shape in production.
 *
 * The invocation carries three deliberate flags:
 *   --sandbox read-only   the model cannot touch the filesystem
 *   --ephemeral           no session persists between calls
 *   --output-schema       the answer must be JSON of a known shape
 *
 * No MCP configuration is passed, so the model has no tools at all. Palace
 * content reaches it only as text inside the prompt, and its output is parsed
 * against a schema before anything is done with it.
 */

export type CodexOptions = {
  model: string;
  timeoutMs: number;
  /**
   * Where Codex runs. It MUST be outside this repository. Codex walks the
   * working directory for AGENTS.md and `.agents/skills`, and inside the repo
   * it loads our coding-agent instructions into the context of the model that
   * answers people — sixteen thousand tokens of the wrong instructions, and a
   * YAML parse error on a skill file for good measure.
   */
  projectRoot: string;
  tmpDirectory: string;
  /** Serialises runs. Codex is heavy and this box hosts other services. */
  maxConcurrency?: number;
  /** Binary to spawn. Absolute path avoids depending on the caller's PATH. */
  command?: string;
  /**
   * Extra attempts on a process-level failure. One by default, because this
   * CLI fails intermittently: when its model cache goes stale it refetches the
   * model list, and the current API response contains a reasoning level
   * ("max") that codex-cli 0.147.0 — the latest published — cannot parse. The
   * run dies, a later one succeeds once some refresh lands. Nothing on our
   * side can fix that; a retry is what makes it survivable.
   */
  retries?: number;
};

type JsonEvent = {
  type?: string;
  item?: { type?: string; text?: string };
  error?: { message?: string };
};

const MAX_DIAGNOSTIC_BYTES = 8192;

export class CodexModel implements ModelPort {
  readonly #options: CodexOptions;
  readonly #maxConcurrency: number;
  #active = 0;
  readonly #waiting: Array<() => void> = [];

  constructor(options: CodexOptions) {
    this.#options = options;
    this.#maxConcurrency = Math.max(1, options.maxConcurrency ?? 1);
  }

  async runStructured<T>(request: ModelRequest): Promise<T> {
    await this.#acquire();
    try {
      const attempts = 1 + Math.max(0, this.#options.retries ?? 1);
      let last: unknown;

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          return parseStructured<T>(await this.#run(request), request.purpose);
        } catch (error) {
          // Only process-level failures are worth another go. A schema the
          // model keeps missing will keep missing it.
          if (!(error instanceof ModelUnavailableError)) throw error;
          last = error;
        }
      }
      throw last;
    } finally {
      this.#release();
    }
  }

  async #run(request: ModelRequest): Promise<string> {
    const { tmpDirectory, projectRoot, model, timeoutMs } = this.#options;
    await mkdir(tmpDirectory, { recursive: true });
    await mkdir(projectRoot, { recursive: true });

    const stem = `codex-${Date.now()}-${randomUUID()}`;
    const outputFile = join(tmpDirectory, `${stem}.txt`);
    const schemaFile = join(tmpDirectory, `${stem}.schema.json`);
    await writeFile(schemaFile, JSON.stringify(request.schema));

    const args = [
      "exec",
      "--json",
      "--ephemeral",
      "--sandbox",
      "read-only",
      // Codex refuses to run outside a git repository unless told to. Without
      // this the only working directory it accepts is one inside a repo — and
      // inside ours it loads AGENTS.md and .agents/skills into the context of
      // the model that answers people. The flag is what lets the working
      // directory be a plain, empty, instruction-free folder.
      "--skip-git-repo-check",
      "-C",
      projectRoot,
      "-m",
      model,
      "-o",
      outputFile,
      "--output-schema",
      schemaFile,
      buildPrompt(request),
    ];

    return new Promise<string>((resolve, reject) => {
      let finalText = "";
      let diagnostics = "";
      let stdoutTail = "";
      let settled = false;
      let timedOut = false;

      const child = spawn(this.#options.command ?? "codex", args, {
        cwd: projectRoot,
        // A named allow-list, not the inherited environment: our own holds the
        // Telegram token, the gateway secret and the palace credential, none of
        // which the model process has any use for.
        //
        // HOME is a deliberate exception. Codex keeps its credentials and its
        // model cache under ~/.codex, and without HOME it cannot authenticate
        // and falls back to refreshing the model list over the network — which
        // then fails on a response field this CLI version does not know. The
        // symptom is an opaque "unknown variant" error nowhere near the cause.
        // The sandbox is read-only, so reaching HOME does not let it write.
        env: pick(["PATH", "HOME", "TMPDIR"]),
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000).unref();
      }, timeoutMs);

      const note = (text: string): void => {
        if (diagnostics.length < MAX_DIAGNOSTIC_BYTES) diagnostics += text;
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutTail += chunk.toString("utf8");
        const lines = stdoutTail.split("\n");
        stdoutTail = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === "") continue;
          try {
            const event = JSON.parse(trimmed) as JsonEvent;
            if (
              event.type === "item.completed" &&
              event.item?.type === "agent_message" &&
              typeof event.item.text === "string"
            ) {
              finalText = event.item.text;
            }
            if (event.type === "error") note(`\n${event.error?.message ?? "error"}`);
            if (event.type === "turn.failed") note("\nturn failed");
          } catch {
            note(`\nunparsed: ${trimmed.slice(0, 200)}`);
          }
        }
      });

      child.stderr.on("data", (chunk: Buffer) => note(chunk.toString("utf8")));

      child.on("error", (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void cleanup();
        reject(
          error.code === "ENOENT"
            ? new ModelUnavailableError("codex is not installed or not on PATH")
            : error,
        );
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        void (async () => {
          if (finalText === "") {
            finalText = await readFile(outputFile, "utf8").catch(() => "");
          }
          await cleanup();

          if (timedOut) {
            reject(new ModelUnavailableError(`codex timed out after ${timeoutMs}ms`));
            return;
          }
          if (code !== 0 && finalText.trim() === "") {
            // Whole diagnostic, newlines flattened: Codex puts the actual cause
            // on the second stderr line ("Reading additional input from
            // stdin..." comes first and means nothing), and a one-line log that
            // drops it sends you chasing the wrong thing.
            const detail = diagnostics.trim().replaceAll(/\s*\n+\s*/g, " | ");
            reject(
              new ModelUnavailableError(
                `codex exited with ${code}: ${detail || "no output"}`,
              ),
            );
            return;
          }
          resolve(finalText.trim());
        })();
      });

      const cleanup = async (): Promise<void> => {
        await Promise.all([
          rm(outputFile, { force: true }).catch(() => undefined),
          rm(schemaFile, { force: true }).catch(() => undefined),
        ]);
      };
    });
  }

  async #acquire(): Promise<void> {
    if (this.#active < this.#maxConcurrency) {
      this.#active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.#waiting.push(resolve));
    this.#active += 1;
  }

  #release(): void {
    this.#active -= 1;
    this.#waiting.shift()?.();
  }
}

/** Copies only the named variables through to the child process. */
function pick(names: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function buildPrompt(request: ModelRequest): string {
  return [
    `Purpose: ${request.purpose}`,
    "",
    request.input,
    "",
    "Return only JSON matching the provided schema. No prose, no code fences.",
  ].join("\n");
}

/**
 * Codex is asked for bare JSON, but a model can still wrap it in a fence. Strip
 * one if present rather than failing the whole request on formatting.
 */
export function parseStructured<T>(raw: string, purpose: string): T {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(raw.trim());
  const body = fenced?.[1] ?? raw.trim();

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new ModelUnavailableError(
      `${purpose}: model did not return valid JSON (${body.slice(0, 200)})`,
    );
  }
}
