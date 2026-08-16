import type { Fragment, Project } from "@mempalace-bot/contract";

/**
 * Pure presentation. Given data, produce what the user should see — no network,
 * no grammY, no session mutation. Handlers stay thin wiring around these, which
 * is what makes the behaviour testable without a Telegram token.
 *
 * Buttons are plain data here and become an InlineKeyboard at the edge, so
 * these functions can be asserted on directly.
 */

export type Button = { text: string; data: string };
export type View = { text: string; buttons: Button[][] };

/** Telegram rejects messages over 4096 characters; leave room for the footer. */
const PAGE_BUDGET = 3400;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function projectListView(projects: Project[]): View {
  if (projects.length === 0) {
    return {
      text:
        "Вам пока не открыт ни один проект.\n\n" +
        "Это не ошибка — доступ выдаёт администратор.",
      buttons: [],
    };
  }

  return {
    text: "Выберите проект:",
    // Index rather than id: callback_data is capped at 64 bytes, and project
    // ids are free-form. The index is resolved against the same list stored in
    // the session, so it cannot address anything the user was not just shown.
    buttons: projects.map((project, index) => [
      { text: project.title, data: `open:${index}` },
    ]),
  };
}

export function projectEnteredView(project: Project): View {
  const description =
    project.description === undefined ? "" : `\n\n${escapeHtml(project.description)}`;

  return {
    text:
      `<b>${escapeHtml(project.title)}</b>${description}\n\n` +
      "Напишите, что вас интересует — отвечу тем, что записано в проекте.",
    buttons: [[{ text: "← К списку проектов", data: "back" }]],
  };
}

/**
 * Splits fragments into pages that fit a Telegram message. Fragments are never
 * cut mid-way across a page boundary unless one alone exceeds the budget, in
 * which case it is truncated with a marker — a silently shortened answer is
 * worse than one that says it was shortened.
 */
export function paginate(fragments: Fragment[]): string[] {
  if (fragments.length === 0) return [];

  const pages: string[] = [];
  let current = "";

  for (const fragment of fragments) {
    const block = renderFragment(fragment);

    if (block.length > PAGE_BUDGET) {
      if (current !== "") {
        pages.push(current);
        current = "";
      }
      pages.push(`${block.slice(0, PAGE_BUDGET)}\n\n<i>…фрагмент сокращён</i>`);
      continue;
    }

    const candidate = current === "" ? block : `${current}\n\n${block}`;
    if (candidate.length > PAGE_BUDGET) {
      pages.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }

  if (current !== "") pages.push(current);
  return pages;
}

function renderFragment(fragment: Fragment): string {
  const { hall, room, createdAt } = fragment.provenance;
  const date = createdAt.slice(0, 10);
  const source = date === "" ? `${hall}/${room}` : `${hall}/${room} · ${date}`;

  return `${escapeHtml(fragment.text)}\n<i>${escapeHtml(source)}</i>`;
}

export function answerView(
  pages: string[],
  pageIndex: number,
  options: { synthesized: boolean },
): View {
  if (pages.length === 0) {
    return {
      text:
        "По этой теме в проекте ничего не записано.\n\n" +
        "Попробуйте другие слова — поиск идёт по смыслу, но опирается на то, что есть.",
      buttons: [[{ text: "← К списку проектов", data: "back" }]],
    };
  }

  const index = Math.min(Math.max(pageIndex, 0), pages.length - 1);
  const header = options.synthesized
    ? "<i>Ответ собран моделью. Исходные фрагменты — ниже.</i>\n\n"
    : "";
  const counter =
    pages.length > 1 ? `\n\n<i>Страница ${index + 1} из ${pages.length}</i>` : "";

  const navigation: Button[] = [];
  if (index > 0) navigation.push({ text: "◀", data: `page:${index - 1}` });
  if (index < pages.length - 1)
    navigation.push({ text: "▶", data: `page:${index + 1}` });

  const buttons: Button[][] = [];
  if (navigation.length > 0) buttons.push(navigation);
  buttons.push([{ text: "← К списку проектов", data: "back" }]);

  return { text: `${header}${pages[index] ?? ""}${counter}`, buttons };
}
