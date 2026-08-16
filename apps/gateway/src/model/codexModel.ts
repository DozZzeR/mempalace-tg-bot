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
  projectRoot: string;
  tmpDirectory: string;
  /** Serialises runs. Codex is heavy and this box hosts other services. */
  maxConcurrency?: number;
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
      const raw = await this.#run(request);
      return parseStructured<T>(raw, request.purpose);
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

      const child = spawn("codex", args, {
        cwd: projectRoot,
        // Only PATH and TMPDIR. Inheriting our environment would hand the model
        // process the Telegram token, the gateway secret and the palace
        // credential — none of which it has any use for.
        env: {
          ...(process.env["PATH"] === undefined
            ? {}
            : { PATH: process.env["PATH"] }),
          ...(process.env["TMPDIR"] === undefined
            ? {}
            : { TMPDIR: process.env["TMPDIR"] }),
        },
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
            reject(
              new ModelUnavailableError(
                `codex exited with ${code}: ${diagnostics.trim() || "no output"}`,
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
