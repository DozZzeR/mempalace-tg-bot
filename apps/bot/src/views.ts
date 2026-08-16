import type { Fragment, Note, NoteKind, Project } from "@mempalace-bot/contract";

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
      "Напишите, что вас интересует — отвечу тем, что записано в проекте.\n" +
      "Или оставьте свою запись кнопкой ниже.",
    buttons: [
      [
        { text: "✍ Записать", data: "note" },
        { text: "📋 Записи", data: "notes" },
      ],
      [{ text: "← К списку проектов", data: "back" }],
    ],
  };
}

const KIND_LABEL: Record<NoteKind, string> = {
  thought: "мысль",
  plan: "план",
  message: "сообщение",
};

export function noteKindView(): View {
  return {
    text: "Что записываем?",
    buttons: [
      [
        { text: "💭 Мысль", data: "kind:thought" },
        { text: "🗺 План", data: "kind:plan" },
      ],
      [{ text: "← Отмена", data: "cancel" }],
    ],
  };
}

export function notePromptView(kind: NoteKind): View {
  return {
    text:
      `Напишите ${KIND_LABEL[kind]} одним сообщением.\n\n` +
      "<i>Запись попадёт в комнату проекта, её увидят другие участники.</i>",
    buttons: [[{ text: "← Отмена", data: "cancel" }]],
  };
}

export function noteSavedView(note: Note): View {
  return {
    text:
      `✓ Записано как ${escapeHtml(KIND_LABEL[note.kind])}.\n\n` +
      `<blockquote>${escapeHtml(clip(note.text, 300))}</blockquote>`,
    buttons: [
      [
        { text: "✍ Ещё", data: "note" },
        { text: "📋 Записи", data: "notes" },
      ],
      [{ text: "← К списку проектов", data: "back" }],
    ],
  };
}

export function notesListView(notes: Note[]): View {
  const buttons: Button[][] = [
    [{ text: "✍ Записать", data: "note" }],
    [{ text: "← К списку проектов", data: "back" }],
  ];

  if (notes.length === 0) {
    return {
      text: "В этом проекте ещё никто ничего не записал. Будете первым?",
      buttons,
    };
  }

  const body = notes
    .slice(0, 10)
    .map((note) => {
      const date = note.createdAt.slice(0, 10);
      const who = escapeHtml(note.authorName);
      const head = date === "" ? who : `${who} · ${date}`;
      return `<b>${escapeHtml(KIND_LABEL[note.kind])}</b> — ${head}\n${escapeHtml(clip(note.text, 400))}`;
    })
    .join("\n\n");

  return { text: body, buttons };
}

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
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

/**
 * Builds the pages of an answer: the model's prose first, when there is one,
 * then the passages it drew on.
 *
 * The prose never replaces the record. A composed answer is a translation of
 * English fragments into the reader's language, and the reader has to be able
 * to check it — so the sources are always one tap away, never dropped.
 */
export function answerPages(input: {
  answer?: string | undefined;
  fragments: Fragment[];
}): string[] {
  const fragmentPages = paginate(input.fragments);
  if (input.answer === undefined || input.answer.trim() === "") {
    return fragmentPages;
  }

  const lead =
    `${escapeHtml(input.answer.trim())}\n\n` +
    `<i>Собрано моделью из ${input.fragments.length} записей проекта. ` +
    `Дальше — сами записи.</i>`;

  return [lead, ...fragmentPages];
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
  // The synthesised marker belongs on the composed page only. Putting it on
  // the source pages would label the record itself as model output.
  const header =
    options.synthesized && index === 0
      ? "<i>✨ Ответ собран моделью</i>\n\n"
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
