import type {
  Fragment,
  Member,
  Note,
  NoteKind,
  Project,
} from "@mempalace-bot/contract";

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

export function projectListView(input: {
  projects: Project[];
  isAdmin?: boolean;
  pendingRequests?: number;
}): View {
  const admin: Button[][] = [];
  if (input.isAdmin === true) {
    const waiting = input.pendingRequests ?? 0;
    admin.push([
      {
        // The count rides on the button itself. A separate notice is something
        // to dismiss; a number on the way in is something you act on.
        text: waiting > 0 ? `⚙️ Админ · 📥 ${waiting}` : "⚙️ Админ",
        data: "adm:enter",
      },
    ]);
  }

  if (input.projects.length === 0) {
    return {
      text:
        "Вам пока не открыт ни один проект.\n\n" +
        "Это не ошибка — доступ выдаёт администратор.",
      buttons: admin,
    };
  }

  const waiting = input.pendingRequests ?? 0;
  const notice =
    input.isAdmin === true && waiting > 0
      ? `\n\n📥 <b>Ждут решения: ${waiting}</b> — загляните в Админ.`
      : "";

  return {
    text: `Выберите проект:${notice}`,
    buttons: [
      // Index rather than id: callback_data is capped at 64 bytes, and project
      // ids are free-form. The index is resolved against the same list stored
      // in the session, so it cannot address anything the user was not shown.
      ...input.projects.map((project, index) => [
        { text: project.title, data: `open:${index}` },
      ]),
      ...admin,
    ],
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

export function noteKindView(canMessage: boolean): View {
  const buttons: Button[][] = [
    [
      { text: "💭 Мысль", data: "kind:thought" },
      { text: "🗺 План", data: "kind:plan" },
    ],
  ];
  // Offered only when there is somebody to address; a button that leads to an
  // empty list is worse than no button.
  if (canMessage) {
    buttons.push([{ text: "✉️ Сообщение участнику", data: "kind:message" }]);
  }
  buttons.push([{ text: "← Отмена", data: "cancel" }]);

  return { text: "Что записываем?", buttons };
}

export function addresseeView(members: Member[]): View {
  return {
    text:
      "Кому?\n\n" +
      "<i>Сообщение ляжет в общую комнату проекта — его увидят и остальные. " +
      "Это запись с адресатом, а не личная переписка.</i>",
    buttons: [
      ...members.slice(0, 20).map((member, index) => [
        {
          text: member.displayName || `id ${member.id}`,
          data: `to:${index}`,
        },
      ]),
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

export function notesListView(notes: Note[], readerId?: number): View {
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
      // A message addressed to the reader is the one thing in this list they
      // must not scroll past, so it is marked rather than left to be spotted.
      const mine =
        note.kind === "message" && readerId !== undefined && note.to === readerId;
      const mark = mine ? "📬 <b>вам</b> — " : "";
      return `${mark}<b>${escapeHtml(KIND_LABEL[note.kind])}</b> — ${head}\n${escapeHtml(clip(note.text, 400))}`;
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
/**
 * Splits a result into the composed answer and the passages behind it.
 *
 * They are kept apart because they live in different messages. Paging used to
 * overwrite the prose with the sources — destroying the half-minute of model
 * work the person was reading — and the prose is the part they came for.
 */
export function answerParts(input: {
  answer?: string | undefined;
  fragments: Fragment[];
}): { prose?: string; sources: string[] } {
  const sources = paginate(input.fragments);
  const answer = input.answer?.trim() ?? "";
  if (answer === "") return { sources };

  return {
    prose:
      `${escapeHtml(answer)}\n\n` +
      `<i>Собрано моделью из ${input.fragments.length} записей проекта.</i>`,
    sources,
  };
}

/** The answer itself. Static: nothing rewrites this message. */
export function proseView(prose: string, sourceCount: number): View {
  return {
    text: `<i>✨ Ответ собран моделью</i>\n\n${prose}`,
    buttons: [
      [{ text: `📄 Источники (${sourceCount})`, data: "sources" }],
      [{ text: "← К списку проектов", data: "back" }],
    ],
  };
}

/**
 * The passages themselves. No "composed by a model" marker here — this view
 * shows records, and labelling them as model output would misrepresent them.
 * The marker belongs on the prose, which now lives in its own message.
 */
export function sourcesView(pages: string[], pageIndex: number): View {
  if (pages.length === 0) {
    return {
      text:
        "По этой теме в проекте ничего не записано.\n\n" +
        "Попробуйте другие слова — поиск идёт по смыслу, но опирается на то, что есть.",
      buttons: [[{ text: "← К списку проектов", data: "back" }]],
    };
  }

  const index = Math.min(Math.max(pageIndex, 0), pages.length - 1);
  const counter =
    pages.length > 1 ? `\n\n<i>Страница ${index + 1} из ${pages.length}</i>` : "";

  const navigation: Button[] = [];
  if (index > 0) navigation.push({ text: "◀", data: `page:${index - 1}` });
  if (index < pages.length - 1)
    navigation.push({ text: "▶", data: `page:${index + 1}` });

  const buttons: Button[][] = [];
  if (navigation.length > 0) buttons.push(navigation);
  buttons.push([{ text: "← К списку проектов", data: "back" }]);

  return { text: `${pages[index] ?? ""}${counter}`, buttons };
}
