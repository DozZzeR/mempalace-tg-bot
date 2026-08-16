import type { ModelPort, ModelRequest } from "./port.ts";

/**
 * A scripted model for tests. Records what it was asked, so a test can assert
 * on the prompt as well as on the outcome — the prompt is where the boundary
 * between instructions and palace data lives, and it deserves assertions.
 */
export class FakeModel implements ModelPort {
  readonly requests: ModelRequest[] = [];
  #responses: unknown[];

  constructor(responses: unknown[] = []) {
    this.#responses = [...responses];
  }

  async runStructured<T>(request: ModelRequest): Promise<T> {
    this.requests.push(request);
    const next = this.#responses.shift();
    if (next === undefined) {
      throw new Error(`FakeModel has no scripted response for ${request.purpose}`);
    }
    return next as T;
  }
}
