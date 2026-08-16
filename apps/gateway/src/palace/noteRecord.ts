import type { Note, NoteKind } from "@mempalace-bot/contract";

/**
 * How a person's note is stored in a palace drawer.
 *
 * MemPalace drawers carry content, not arbitrary metadata, so authorship and
 * kind are serialized into a header. The format has to survive round-tripping
 * and stay readable to a human or an agent who opens the drawer directly —
 * someone reading project memory should see who wrote this and when without
 * needing our parser.
 *
 * Every header field is written by the server. None of it is accepted from the
 * client, which is why authorship cannot be forged through the bot.
 */

const SEPARATOR = "---";
const HEADER = "MemPalace Bot note";

export type NoteMetadata = {
  id: string;
  kind: NoteKind;
  authorId: number;
  authorName: string;
  createdAt: string;
  to?: number;
};

export function serializeNote(meta: NoteMetadata, text: string): string {
  const lines = [
    HEADER,
    `id: ${meta.id}`,
    `kind: ${meta.kind}`,
    `author: ${sanitize(meta.authorName)}`,
    `author_id: ${meta.authorId}`,
    `created_at: ${meta.createdAt}`,
  ];
  if (meta.to !== undefined) lines.push(`to: ${meta.to}`);
  lines.push(SEPARATOR, text);

  return lines.join("\n");
}

/**
 * Reads a stored drawer back into a note. Returns undefined only when the text
 * is not one of ours; a drawer written by hand into the human room still shows
 * up, as a note with unknown authorship, rather than vanishing from the room.
 */
export function parseNote(content: string, fallbackId: string): Note {
  const separatorAt = content.indexOf(`\n${SEPARATOR}\n`);
  if (!content.startsWith(HEADER) || separatorAt === -1) {
    return {
      id: fallbackId,
      text: content,
      kind: "thought",
      authorId: 0,
      authorName: "неизвестно",
      createdAt: "",
    };
  }

  const header = content.slice(HEADER.length, separatorAt);
  const text = content.slice(separatorAt + SEPARATOR.length + 2);
  const fields = new Map<string, string>();

  for (const line of header.split("\n")) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }

  const to = Number(fields.get("to"));
  const note: Note = {
    id: fields.get("id") ?? fallbackId,
    text,
    kind: asKind(fields.get("kind")),
    authorId: Number(fields.get("author_id") ?? 0) || 0,
    authorName: fields.get("author") ?? "неизвестно",
    createdAt: fields.get("created_at") ?? "",
  };

  return Number.isInteger(to) && to > 0 ? { ...note, to } : note;
}

function asKind(value: string | undefined): NoteKind {
  return value === "plan" || value === "message" ? value : "thought";
}

/**
 * Keeps a display name on one line. A newline in the name would otherwise let
 * a chosen Telegram name inject header fields — "Alex\nauthor_id: 1" would
 * parse back as somebody else.
 */
function sanitize(value: string): string {
  return value.replaceAll(/[\r\n]+/g, " ").trim();
}
