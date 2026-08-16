import {
  Bot,
  GrammyError,
  InlineKeyboard,
  session,
  type Context,
  type SessionFlavor,
} from "grammy";
import { sequentialize } from "@grammyjs/runner";
import type {
  AccessRequest,
  AdminUser,
  AdminWing,
  Member,
  NoteKind,
  Project,
} from "@mempalace-bot/contract";
import {
  adminHomeView,
  adminLockedView,
  publishPromptView,
  requestsView,
  unpublishConfirmView,
  userProjectsView,
  usersView,
  wingsView,
} from "./adminViews.ts";
import { GatewayError, type GatewayClient } from "./gateway/client.ts";
import {
  addresseeView,
  answerPages,
  answerView,
  noteKindView,
  notePromptView,
  noteSavedView,
  notesListView,
  projectEnteredView,
  projectListView,
  type View,
} from "./views.ts";

/**
 * Telegram wiring. Everything here is transport and presentation: parse the
 * update, call a view, reply. No access rules — the gateway owns those, and the
 * bot could not enforce them correctly even if it tried, because it never
 * learns what a wing is.
 *
 * Session is in-memory on purpose. "Which project am I browsing" is ephemeral;
 * losing it on restart costs one tap, and persisting it would put a copy of who
 * may see what outside the gateway, which is exactly the leak to avoid.
 */

type SessionData = {
  /** The list the user was last shown; callback indices resolve against it. */
  projects: Project[];
  currentProjectId: string | undefined;
  pages: string[];
  synthesized: boolean;
  /**
   * When set, the next text message is filed as a note of this kind instead of
   * being treated as a question. Cleared as soon as it is consumed, so a second
   * message never lands as a note by accident.
   */
  awaitingNote: NoteKind | undefined;
  /** Set while an admin session is open; the gateway is still the authority. */
  adminExpiresAt: string | undefined;
  /** Last rendered admin lists — callback indices resolve against these. */
  adminUsers: AdminUser[];
  adminProjects: Project[];
  adminRequests: AccessRequest[];
  adminWings: AdminWing[];
  /** Set while an admin is being asked for a project title. */
  awaitingPublishWing: string | undefined;
  /** Addressee chosen for a message, pending the text. */
  awaitingTo: number | undefined;
  /** People in the current project, for the addressee picker. */
  members: Member[];
};

type BotContext = Context & SessionFlavor<SessionData>;

function freshSession(): SessionData {
  return {
    projects: [],
    currentProjectId: undefined,
    pages: [],
    synthesized: false,
    awaitingNote: undefined,
    adminExpiresAt: undefined,
    adminUsers: [],
    adminProjects: [],
    adminRequests: [],
    adminWings: [],
    awaitingPublishWing: undefined,
    awaitingTo: undefined,
    members: [],
  };
}

/**
 * Shows a view, editing the current message or sending a new one.
 *
 * The reason this is a function rather than a repeated pair of lines: Telegram
 * rejects an edit whose result is identical to what is already on screen, with
 * a 400. Tapping the same button twice does exactly that, and the rejection was
 * surfacing to the person as a failure — the screen they asked for, followed by
 * a message saying it could not be fetched. An edit that changes nothing has
 * succeeded as far as anyone looking at the screen is concerned.
 */
async function render(
  ctx: BotContext,
  view: View,
  edit: boolean,
): Promise<void> {
  const options = {
    parse_mode: "HTML" as const,
    reply_markup: toKeyboard(view),
  };

  if (!edit) {
    await ctx.reply(view.text, options);
    return;
  }

  try {
    await ctx.editMessageText(view.text, options);
  } catch (error) {
    if (!isNotModified(error)) throw error;
  }
}

function isNotModified(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    error.description.includes("message is not modified")
  );
}

function toKeyboard(view: View): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const row of view.buttons) {
    for (const button of row) keyboard.text(button.text, button.data);
    keyboard.row();
  }
  return keyboard;
}

function excuse(error: unknown): string {
  if (error instanceof GatewayError) {
    switch (error.kind) {
      case "forbidden":
        return "У вас нет доступа к боту. За доступом — к администратору.";
      case "not_found":
        return "Такого проекта нет.";
      case "rate_limited":
        return error.retryAfterSeconds === undefined
          ? "Слишком часто. Подождите немного."
          : `Слишком часто. Попробуйте через ${error.retryAfterSeconds} с.`;
      case "busy":
        return "Предыдущий вопрос ещё обрабатывается — ответ придёт сам.";
      case "unavailable":
        return "Хранилище сейчас недоступно. Попробуйте через минуту.";
    }
  }
  return "Что-то пошло не так. Попробуйте ещё раз.";
}

export type BotDeps = {
  token: string;
  gateway: GatewayClient;
};

export function buildBot(deps: BotDeps): Bot<BotContext> {
  const bot = new Bot<BotContext>(deps.token);

  /**
   * Concurrency, and why both halves are needed.
   *
   * grammY's built-in polling handles updates strictly one at a time — its own
   * source says "handle updates sequentially (!)". A search takes half a minute
   * because a model runs, so with the built-in loop one person's question
   * freezes the bot for everybody else, including /start.
   *
   * The runner (wired in index.ts) processes updates concurrently. That alone
   * would introduce the opposite problem: two updates from the SAME chat could
   * interleave around the session read-modify-write, so tapping "записать" and
   * then sending the text could race and lose the pending state.
   *
   * sequentialize by chat id gives both properties: different people never wait
   * on each other, and one person's updates stay in order.
   */
  bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));
  bot.use(session({ initial: freshSession }));

  async function showProjects(ctx: BotContext, edit: boolean): Promise<void> {
    const userId = ctx.from?.id;
    if (userId === undefined) return;

    const state = await deps.gateway.projects(userId);
    ctx.session.projects = state.projects;
    ctx.session.currentProjectId = undefined;
    ctx.session.pages = [];

    const view = projectListView({
      projects: state.projects,
      isAdmin: state.isAdmin,
      ...(state.pendingRequests === undefined
        ? {}
        : { pendingRequests: state.pendingRequests }),
    });
    await render(ctx, view, edit);
  }

  function displayName(ctx: BotContext): string {
    const from = ctx.from;
    if (from === undefined) return "";
    const name = [from.first_name, from.last_name].filter(Boolean).join(" ");
    return from.username === undefined ? name : `${name} (@${from.username})`;
  }

  bot.command("start", async (ctx) => {
    try {
      await showProjects(ctx, false);
    } catch (error) {
      // A stranger's first contact becomes a request an admin can act on,
      // rather than a dead end they have to chase up out of band.
      if (error instanceof GatewayError && error.kind === "forbidden") {
        const userId = ctx.from?.id;
        if (userId !== undefined) {
          await deps.gateway
            .requestAccess(userId, displayName(ctx))
            .catch(() => undefined);
        }
        await ctx.reply(
          "Заявка на доступ отправлена. Администратор её увидит.\n\n" +
            `Ваш ID: <code>${userId ?? "?"}</code>`,
          { parse_mode: "HTML" },
        );
        return;
      }
      await ctx.reply(excuse(error));
    }
  });

  // ---- admin ----

  async function showAdminHome(ctx: BotContext, edit: boolean): Promise<void> {
    const userId = ctx.from?.id;
    if (userId === undefined) return;

    const state = await deps.gateway.adminState(userId);
    ctx.session.adminUsers = state.users;
    ctx.session.adminProjects = state.projects;
    ctx.session.adminRequests = state.requests;
    // The gateway slides the session on every admin call, so take its word for
    // the expiry rather than trusting the one captured at unlock.
    if (state.sessionExpiresAt !== undefined) {
      ctx.session.adminExpiresAt = state.sessionExpiresAt;
    }

    const view = adminHomeView(state, ctx.session.adminExpiresAt ?? "");
    await render(ctx, view, edit);
  }

  bot.command("admin", async (ctx) => {
    const userId = ctx.from?.id;
    const secret = ctx.match.trim();

    // Delete first, whatever happens next: the secret is now in a chat log that
    // outlives this conversation, and on a shared or forwarded screen it is the
    // whole key. Deleting can fail (no rights, too old) — that is not a reason
    // to skip trying.
    await ctx.deleteMessage().catch(() => undefined);

    if (userId === undefined || secret === "") {
      await ctx.reply(adminLockedView().text, { parse_mode: "HTML" });
      return;
    }

    try {
      const opened = await deps.gateway.openAdminSession(userId, secret);
      ctx.session.adminExpiresAt = opened.expiresAt;
      await showAdminHome(ctx, false);
    } catch (error) {
      // Three different failures used to share one message, which sent whoever
      // hit it looking in the wrong place. A missing ADMIN_SECRET_HASH is a
      // server-side omission and is safe to name — the gateway answers 404 for
      // that regardless of who asked, so saying so reveals nothing about the
      // caller. A wrong phrase and "not an admin" stay deliberately identical.
      const kind = error instanceof GatewayError ? error.kind : "unavailable";
      await ctx.reply(
        kind === "not_found"
          ? "Админский вход не настроен на сервере: в .env пуст ADMIN_SECRET_HASH.\n\n" +
              "Сгенерируйте: npm run admin -- hash, вставьте строку целиком, " +
              "затем pm2 restart mempalace-gateway --update-env"
          : kind === "forbidden"
            ? "Фраза не подошла."
            : "Фасад сейчас недоступен. Попробуйте через минуту.",
      );
    }
  });

  async function adminGuard(ctx: BotContext): Promise<boolean> {
    const expiresAt = ctx.session.adminExpiresAt;
    if (expiresAt === undefined) {
      await ctx.reply(adminLockedView().text, { parse_mode: "HTML" });
      return false;
    }
    // Checked against the clock, not merely for presence. Saying "the session
    // expired" is a different piece of news from "you never opened one", and
    // the second is what the admin used to be told after fifteen quiet minutes.
    if (new Date(expiresAt).getTime() <= Date.now()) {
      ctx.session.adminExpiresAt = undefined;
      await ctx.reply(
        "Сессия истекла. Откройте заново: /admin ваша фраза",
      );
      return false;
    }
    return true;
  }

  bot.callbackQuery("adm:enter", async (ctx) => {
    await ctx.answerCallbackQuery();

    // An open session goes straight in; otherwise the secret is asked for. The
    // button exists either way, so an admin never has to remember that the
    // entrance is a slash command.
    if (ctx.session.adminExpiresAt !== undefined) {
      await showAdminHome(ctx, true).catch(async () => {
        ctx.session.adminExpiresAt = undefined;
        await ctx.reply(adminLockedView().text, { parse_mode: "HTML" });
      });
      return;
    }
    await ctx.reply(adminLockedView().text, { parse_mode: "HTML" });
  });

  bot.callbackQuery("adm:home", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await adminGuard(ctx))) return;
    await showAdminHome(ctx, true).catch(async () => {
      ctx.session.adminExpiresAt = undefined;
      await ctx.reply("Сессия истекла. Откройте заново: /admin ваш-секрет");
    });
  });

  bot.callbackQuery("adm:close", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.adminExpiresAt = undefined;
    await render(ctx, { text: "Сессия закрыта.", buttons: [] }, true);
  });

  bot.callbackQuery("adm:requests", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await adminGuard(ctx))) return;

    const view = requestsView(ctx.session.adminRequests);
    await render(ctx, view, true);
  });

  bot.callbackQuery(/^adm:(yes|no):(\d+)$/, async (ctx) => {
    if (!(await adminGuard(ctx))) return;

    const approve = ctx.match?.[1] === "yes";
    const target = Number(ctx.match?.[2]);
    const userId = ctx.from.id;

    try {
      await deps.gateway.decideRequest(userId, target, approve);
      await ctx.answerCallbackQuery(approve ? "Одобрено" : "Отклонено");
      // Tell the person, but only on approval: a denial delivered by bot is
      // worse than silence, and the admin may want to explain it themselves.
      if (approve) {
        await ctx.api
          .sendMessage(target, "Доступ открыт. Наберите /start.")
          .catch(() => undefined);
      }
      await showAdminHome(ctx, true);
    } catch {
      await ctx.answerCallbackQuery("Не получилось");
    }
  });

  bot.callbackQuery("adm:users", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await adminGuard(ctx))) return;

    const view = usersView(ctx.session.adminUsers);
    await render(ctx, view, true);
  });

  async function showUserProjects(ctx: BotContext, target: number): Promise<void> {
    const user = ctx.session.adminUsers.find(
      (candidate) => candidate.telegramUserId === target,
    );
    if (user === undefined) {
      await ctx.reply("Список устарел. Откройте /admin заново.");
      return;
    }
    const view = userProjectsView(user, ctx.session.adminProjects);
    await render(ctx, view, true);
  }

  bot.callbackQuery(/^adm:user:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await adminGuard(ctx))) return;
    await showUserProjects(ctx, Number(ctx.match?.[1]));
  });

  bot.callbackQuery(/^adm:tgl:(\d+):(.+)$/, async (ctx) => {
    if (!(await adminGuard(ctx))) return;

    const target = Number(ctx.match?.[1]);
    const projectId = ctx.match?.[2] ?? "";
    const user = ctx.session.adminUsers.find(
      (candidate) => candidate.telegramUserId === target,
    );
    if (user === undefined) {
      await ctx.answerCallbackQuery("Список устарел");
      return;
    }

    // Toggling from the unrestricted state starts from "everything", so the
    // first tap removes one project rather than silently dropping the rest.
    const current = user.restricted
      ? new Set(user.projectIds)
      : new Set(ctx.session.adminProjects.map((project) => project.id));
    if (current.has(projectId)) current.delete(projectId);
    else current.add(projectId);

    const next = [...current];
    try {
      await deps.gateway.setUserProjects(ctx.from.id, target, next);
      user.restricted = true;
      user.projectIds = next;
      await ctx.answerCallbackQuery();
      await showUserProjects(ctx, target);
    } catch {
      await ctx.answerCallbackQuery("Не получилось");
    }
  });

  async function showWings(ctx: BotContext): Promise<void> {
    const wings = await deps.gateway.adminWings(ctx.from?.id ?? 0);
    ctx.session.adminWings = wings;

    const view = wingsView(wings);
    await render(ctx, view, true);
  }

  bot.callbackQuery("adm:projects", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await adminGuard(ctx))) return;
    await showWings(ctx).catch(async () => {
      await ctx.reply("Не получилось получить список крыльев.");
    });
  });

  bot.callbackQuery(/^adm:wing:(\d+)$/, async (ctx) => {
    if (!(await adminGuard(ctx))) return;

    const entry = ctx.session.adminWings[Number(ctx.match?.[1])];
    if (entry === undefined) {
      await ctx.answerCallbackQuery("Список устарел");
      return;
    }
    await ctx.answerCallbackQuery();

    if (entry.published) {
      await render(ctx, unpublishConfirmView(entry), true);
      return;
    }

    // Publishing needs a human-facing name, so ask for one instead of
    // defaulting to the wing name — people see this, agents wrote that.
    ctx.session.awaitingPublishWing = entry.wing;
    const view = publishPromptView(entry.wing);
    await render(ctx, view, true);
  });

  bot.callbackQuery(/^adm:unpub:(.+)$/, async (ctx) => {
    if (!(await adminGuard(ctx))) return;

    try {
      await deps.gateway.unpublishProject(ctx.from.id, ctx.match?.[1] ?? "");
      await ctx.answerCallbackQuery("Снято");
      await showWings(ctx);
    } catch {
      await ctx.answerCallbackQuery("Не получилось");
    }
  });

  bot.callbackQuery(/^adm:all:(\d+)$/, async (ctx) => {
    if (!(await adminGuard(ctx))) return;

    const target = Number(ctx.match?.[1]);
    const user = ctx.session.adminUsers.find(
      (candidate) => candidate.telegramUserId === target,
    );
    if (user === undefined) {
      await ctx.answerCallbackQuery("Список устарел");
      return;
    }

    try {
      await deps.gateway.setUserProjects(ctx.from.id, target, null);
      user.restricted = false;
      user.projectIds = [];
      await ctx.answerCallbackQuery("Видит все проекты");
      await showUserProjects(ctx, target);
    } catch {
      await ctx.answerCallbackQuery("Не получилось");
    }
  });

  bot.callbackQuery("back", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await showProjects(ctx, true);
    } catch (error) {
      await ctx.reply(excuse(error));
    }
  });

  bot.callbackQuery(/^open:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const index = Number(ctx.match?.[1]);
    const project = ctx.session.projects[index];
    if (project === undefined) {
      await ctx.reply("Список устарел. Наберите /start.");
      return;
    }

    ctx.session.currentProjectId = project.id;
    ctx.session.pages = [];
    ctx.session.awaitingNote = undefined;

    const view = projectEnteredView(project);
    await render(ctx, view, true);
  });

  bot.callbackQuery("note", async (ctx) => {
    await ctx.answerCallbackQuery();
    const projectId = ctx.session.currentProjectId;
    if (projectId === undefined) {
      await ctx.reply("Сначала выберите проект — /start.");
      return;
    }

    ctx.session.members = await deps.gateway
      .members(ctx.from.id, projectId)
      .catch(() => []);

    const view = noteKindView(ctx.session.members.length > 0);
    await render(ctx, view, true);
  });

  bot.callbackQuery(/^kind:(thought|plan)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const kind = ctx.match?.[1] as NoteKind | undefined;
    if (kind === undefined) return;

    ctx.session.awaitingNote = kind;
    ctx.session.awaitingTo = undefined;
    const view = notePromptView(kind);
    await render(ctx, view, true);
  });

  bot.callbackQuery("kind:message", async (ctx) => {
    await ctx.answerCallbackQuery();

    const view = addresseeView(ctx.session.members);
    await render(ctx, view, true);
  });

  bot.callbackQuery(/^to:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const member = ctx.session.members[Number(ctx.match?.[1])];
    if (member === undefined) {
      await ctx.reply("Список устарел. Наберите /start.");
      return;
    }

    ctx.session.awaitingNote = "message";
    ctx.session.awaitingTo = member.id;
    const view = notePromptView("message");
    await render(ctx, view, true);
  });

  bot.callbackQuery("cancel", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.awaitingNote = undefined;

    const project = ctx.session.projects.find(
      (candidate) => candidate.id === ctx.session.currentProjectId,
    );
    if (project === undefined) {
      await ctx.reply("Наберите /start.");
      return;
    }

    const view = projectEnteredView(project);
    await render(ctx, view, true);
  });

  bot.callbackQuery("notes", async (ctx) => {
    await ctx.answerCallbackQuery();

    const userId = ctx.from.id;
    const projectId = ctx.session.currentProjectId;
    if (projectId === undefined) {
      await ctx.reply("Сначала выберите проект — /start.");
      return;
    }

    try {
      const view = notesListView(
        await deps.gateway.notes(userId, projectId),
        userId,
      );
      await render(ctx, view, true);
    } catch (error) {
      await ctx.reply(excuse(error));
    }
  });

  bot.callbackQuery(/^page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const page = Number(ctx.match?.[1]);
    const view = answerView(ctx.session.pages, page, {
      synthesized: ctx.session.synthesized,
    });
    await render(ctx, view, true);
  });

  bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id;

    // Publishing is checked FIRST, before the "pick a project" guard, because
    // it is not project-scoped: an admin naming a new project has not entered
    // one. With the guard first, the title was always rejected and publishing
    // from the bot could never work.
    const publishing = ctx.session.awaitingPublishWing;
    if (publishing !== undefined) {
      ctx.session.awaitingPublishWing = undefined;
      try {
        await deps.gateway.publishProject(userId, publishing, ctx.message.text);
        await ctx.reply(`✓ Опубликовано: ${ctx.message.text}`);
        await showAdminHome(ctx, false);
      } catch (error) {
        await ctx.reply(excuse(error));
      }
      return;
    }

    const projectId = ctx.session.currentProjectId;
    if (projectId === undefined) {
      await ctx.reply("Сначала выберите проект — /start.");
      return;
    }

    const kind = ctx.session.awaitingNote;
    if (kind !== undefined) {
      // Cleared before the call, not after: if the write fails, the next
      // message should be a question again rather than silently retrying as a
      // note the person thought they had already sent.
      ctx.session.awaitingNote = undefined;
      const to = ctx.session.awaitingTo;
      ctx.session.awaitingTo = undefined;

      try {
        const note = await deps.gateway.writeNote(userId, projectId, {
          text: ctx.message.text,
          kind,
          ...(kind === "message" && to !== undefined ? { to } : {}),
        });

        // Delivery is the bot's job because only the bot holds a Telegram
        // token — deliberately, so the gateway cannot message anyone. It is
        // attempted after the write, never instead of it: the note is in the
        // project either way, and someone who has not started the bot will
        // find it when they next open the room.
        let delivered = true;
        if (kind === "message" && to !== undefined) {
          delivered = await ctx.api
            .sendMessage(
              to,
              `📬 Вам записали в проекте:\n\n${ctx.message.text}`,
            )
            .then(() => true)
            .catch(() => false);
        }

        const view = noteSavedView(note);
        await ctx.reply(
          delivered
            ? view.text
            : `${view.text}\n\n<i>Уведомление не доставлено — человек ещё не открывал бота. Запись он увидит в комнате проекта.</i>`,
          { parse_mode: "HTML", reply_markup: toKeyboard(view) },
        );
      } catch (error) {
        await ctx.reply(excuse(error));
      }
      return;
    }

    // A model round trip takes tens of seconds. Without a sign of life people
    // retype the question, which starts a second run behind the first.
    const thinking = await ctx.reply("Ищу…");
    const typing = setInterval(() => {
      void ctx.replyWithChatAction("typing").catch(() => undefined);
    }, 5000);

    try {
      const result = await deps.gateway.search(
        userId,
        projectId,
        ctx.message.text,
      );
      ctx.session.pages = answerPages(result);
      ctx.session.synthesized = result.synthesized;

      const view = answerView(ctx.session.pages, 0, {
        synthesized: result.synthesized,
      });
      await ctx.api.editMessageText(
        thinking.chat.id,
        thinking.message_id,
        view.text,
        { parse_mode: "HTML", reply_markup: toKeyboard(view) },
      );
    } catch (error) {
      await ctx.api
        .editMessageText(thinking.chat.id, thinking.message_id, excuse(error))
        .catch(() => ctx.reply(excuse(error)));
    } finally {
      clearInterval(typing);
    }
  });

  bot.catch((err) => {
    console.error("bot error:", err.message);
  });

  return bot;
}
