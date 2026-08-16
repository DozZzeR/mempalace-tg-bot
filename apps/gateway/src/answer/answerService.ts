import type { ProjectSession } from "../access/projectSession.ts";
import type { PalaceFragment } from "../palace/adapter.ts";
import { ModelUnavailableError, type ModelPort } from "../model/port.ts";
import {
  ANSWER_SCHEMA,
  QUERY_SCHEMA,
  answerPrompt,
  queryPrompt,
  type AnswerDraft,
  type QueryPlan,
} from "./prompts.ts";

/**
 * The search loop. The model decides WHAT to look for; this code performs the
 * lookups through a ProjectSession that is already bound to one project.
 *
 * That split is the design: the intelligence of the search is the model's, the
 * reach is not. There is no arrangement of words the model can emit that
 * queries another project, because it never holds the search tool — it returns
 * strings, and this function decides what to do with them.
 */

export type Answer = {
  fragments: PalaceFragment[];
  /** Prose composed by the model, when one was produced. */
  answer?: string;
  synthesized: boolean;
};

export type AnswerOptions = {
  /** What language to reply in. The palace stores English; people do not. */
  language?: string;
  perQueryLimit?: number;
  maxFragments?: number;
};

/** Reports a degradation. Silent fallback makes "off" and "broken" identical. */
export type DegradeLogger = (stage: string, reason: string) => void;

export class AnswerService {
  readonly #model: ModelPort | undefined;
  readonly #onDegrade: DegradeLogger;

  constructor(model?: ModelPort, onDegrade?: DegradeLogger) {
    this.#model = model;
    this.#onDegrade =
      onDegrade ??
      ((stage, reason) => console.warn(`model degraded at ${stage}: ${reason}`));
  }

  async answer(
    session: ProjectSession,
    projectTitle: string,
    question: string,
    options: AnswerOptions = {},
  ): Promise<Answer> {
    const perQuery = options.perQueryLimit ?? 6;
    const maxFragments = options.maxFragments ?? 10;

    // Without a model the bot still works, just literally: the question goes
    // to the palace as typed. Degrading to verbatim search is much better than
    // failing, and it keeps the model an enhancement rather than a dependency.
    if (this.#model === undefined) {
      return {
        fragments: await session.search(question, maxFragments),
        synthesized: false,
      };
    }

    let fragments: PalaceFragment[];
    try {
      const plan = await this.#model.runStructured<QueryPlan>({
        purpose: "plan search queries",
        input: queryPrompt({ question, projectTitle }),
        schema: QUERY_SCHEMA,
      });
      fragments = await this.#gather(session, plan.queries, perQuery, maxFragments);
    } catch (error) {
      if (!(error instanceof ModelUnavailableError)) throw error;
      this.#onDegrade("query planning", error.message);
      fragments = await session.search(question, maxFragments);
    }

    if (fragments.length === 0) {
      return { fragments, synthesized: false };
    }

    try {
      const draft = await this.#model.runStructured<AnswerDraft>({
        purpose: "answer from recorded material",
        input: answerPrompt({
          question,
          language: options.language ?? "Russian",
          fragments,
        }),
        schema: ANSWER_SCHEMA,
      });

      // An ungrounded answer is dropped rather than shown with a caveat. The
      // fragments are still returned, so the person sees the raw record and
      // judges for themselves — which beats prose that hedges.
      if (!draft.grounded || draft.answer.trim() === "") {
        this.#onDegrade("synthesis", "model reported the material ungrounded");
        return { fragments, synthesized: false };
      }
      return { fragments, answer: draft.answer.trim(), synthesized: true };
    } catch (error) {
      if (!(error instanceof ModelUnavailableError)) throw error;
      this.#onDegrade("synthesis", error.message);
      return { fragments, synthesized: false };
    }
  }

  /** Runs each planned query and merges results, best score first. */
  async #gather(
    session: ProjectSession,
    queries: string[],
    perQuery: number,
    max: number,
  ): Promise<PalaceFragment[]> {
    const seen = new Map<string, PalaceFragment>();

    for (const query of queries.slice(0, 4)) {
      const trimmed = query.trim();
      if (trimmed === "") continue;

      for (const fragment of await session.search(trimmed, perQuery)) {
        const existing = seen.get(fragment.text);
        // The same passage often surfaces for several queries; keep the best
        // score rather than counting it twice.
        if (existing === undefined || fragment.score > existing.score) {
          seen.set(fragment.text, fragment);
        }
      }
    }

    return [...seen.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, max);
  }
}
