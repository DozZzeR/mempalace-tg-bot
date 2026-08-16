import type {
  AccessRequest,
  AdminStateResponse,
  AdminUser,
  Project,
} from "@mempalace-bot/contract";
import { escapeHtml, type Button, type View } from "./views.ts";

/**
 * Admin screens. Same rule as the rest of the presentation layer: these decide
 * what is shown, never who may see it — the gateway refuses admin routes to
 * anyone without an open session, so a rendering mistake here cannot grant
 * anything.
 */

export function adminHomeView(state: AdminStateResponse, expiresAt: string): View {
  const waiting = state.requests.length;
  const until = expiresAt.slice(11, 16);

  return {
    text:
      `<b>Администрирование</b>\n` +
      `Сессия открыта до ${escapeHtml(until)} UTC.\n\n` +
      (waiting === 0
        ? "Заявок нет."
        : `Заявок ожидает: <b>${waiting}</b>.`),
    buttons: [
      [{ text: `📥 Заявки (${waiting})`, data: "adm:requests" }],
      [{ text: `👥 Пользователи (${state.users.length})`, data: "adm:users" }],
      [{ text: "🔒 Закрыть сессию", data: "adm:close" }],
    ],
  };
}

export function requestsView(requests: AccessRequest[]): View {
  if (requests.length === 0) {
    return {
      text: "Никто не ждёт решения.",
      buttons: [[{ text: "← Назад", data: "adm:home" }]],
    };
  }

  const buttons: Button[][] = requests.slice(0, 10).flatMap((request) => [
    [
      {
        text: `✅ ${short(request.displayName || String(request.telegramUserId))}`,
        data: `adm:yes:${request.telegramUserId}`,
      },
      { text: "❌", data: `adm:no:${request.telegramUserId}` },
    ],
  ]);
  buttons.push([{ text: "← Назад", data: "adm:home" }]);

  const list = requests
    .slice(0, 10)
    .map(
      (request) =>
        `• <b>${escapeHtml(request.displayName || "без имени")}</b> ` +
        `<code>${request.telegramUserId}</code> — ${escapeHtml(request.requestedAt.slice(0, 16).replace("T", " "))}`,
    )
    .join("\n");

  return {
    text:
      `<b>Заявки на доступ</b>\n\n${list}\n\n` +
      "<i>Одобренный видит все опубликованные проекты. Сузить — в разделе «Пользователи».</i>",
    buttons,
  };
}

export function usersView(users: AdminUser[]): View {
  if (users.length === 0) {
    return {
      text: "Пользователей нет.",
      buttons: [[{ text: "← Назад", data: "adm:home" }]],
    };
  }

  const buttons: Button[][] = users.slice(0, 20).map((user) => [
    {
      text: `${user.isAdmin ? "★ " : ""}${short(user.displayName || String(user.telegramUserId))}` +
        ` — ${user.restricted ? `${user.projectIds.length} проект.` : "все"}`,
      data: `adm:user:${user.telegramUserId}`,
    },
  ]);
  buttons.push([{ text: "← Назад", data: "adm:home" }]);

  return { text: "<b>Пользователи</b>\nВыберите, чтобы настроить доступ.", buttons };
}

export function userProjectsView(
  user: AdminUser,
  projects: Project[],
): View {
  const granted = new Set(user.projectIds);
  const all = !user.restricted;

  const buttons: Button[][] = projects.slice(0, 20).map((project) => [
    {
      // When unrestricted, everything is on — showing them unticked would
      // misrepresent what the person can actually see right now.
      text: `${all || granted.has(project.id) ? "☑" : "☐"} ${short(project.title)}`,
      data: `adm:tgl:${user.telegramUserId}:${project.id}`,
    },
  ]);

  buttons.push([
    {
      text: all ? "• Видит все (по умолчанию)" : "↺ Вернуть «все проекты»",
      data: `adm:all:${user.telegramUserId}`,
    },
  ]);
  buttons.push([{ text: "← К пользователям", data: "adm:users" }]);

  return {
    text:
      `<b>${escapeHtml(user.displayName || String(user.telegramUserId))}</b> ` +
      `<code>${user.telegramUserId}</code>\n\n` +
      (all
        ? "Видит <b>все опубликованные</b> проекты. Отметьте нужные, чтобы ограничить."
        : `Ограничен: <b>${user.projectIds.length}</b> из ${projects.length}.`),
    buttons,
  };
}

export function adminLockedView(): View {
  return {
    text:
      "Для админских действий нужна открытая сессия.\n\n" +
      "Отправьте <code>/admin ваш-секрет</code> — сообщение будет удалено сразу.",
    buttons: [],
  };
}

function short(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 23)}…`;
}
