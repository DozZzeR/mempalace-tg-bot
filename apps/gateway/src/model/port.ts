/**
 * The reasoning layer, behind an interface.
 *
 * Note what this port cannot do: it takes text and a schema and returns
 * structured data. It has no tools, no palace access, and no way to act. That
 * is the whole design — the model supplies judgment and language, the
 * application performs every action. A model that is confused, wrong, or
 * actively subverted by text it read still cannot reach anything.
 */
export interface ModelPort {
  runStructured<T>(request: ModelRequest): Promise<T>;
}

export type ModelRequest = {
  /** Short label for the task, used in the prompt and in logs. */
  purpose: string;
  /** The material the model reasons over. Treated as data, never instructions. */
  input: string;
  /** JSON Schema the answer must conform to. */
  schema: Record<string, unknown>;
};

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelUnavailableError";
  }
}
