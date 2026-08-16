import { Bot, InlineKeyboard, session, type Context, type SessionFlavor } from "grammy";
import type { Project } from "@mempalace-bot/contract";
import { GatewayError, type GatewayClient } from "./gateway/client.ts";
import {
  answerView,
  paginate,
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
};

type BotContext = Context & SessionFlavor<SessionData>;

function freshSession(): SessionData {
  return {
    projects: [],
    currentProjectId: undefined,
    pages: [],
    synthesized: false,
  };
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

  bot.use(session({ initial: freshSession }));

  async function showProjects(ctx: BotContext, edit: boolean): Promise<void> {
    const userId = ctx.from?.id;
    if (userId === undefined) return;

    const projects = await deps.gateway.projects(userId);
    ctx.session.projects = projects;
    ctx.session.currentProjectId = undefined;
    ctx.session.pages = [];

    const view = projectListView(projects);
    const options = {
      parse_mode: "HTML" as const,
      reply_markup: toKeyboard(view),
    };

    if (edit) {
      await ctx.editMessageText(view.text, options);
    } else {
      await ctx.reply(view.text, options);
    }
  }

  bot.command("start", async (ctx) => {
    try {
      await showProjects(ctx, false);
    } catch (error) {
      await ctx.reply(excuse(error));
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

    const view = projectEnteredView(project);
    await ctx.editMessageText(view.text, {
      parse_mode: "HTML",
      reply_markup: toKeyboard(view),
    });
  });

  bot.callbackQuery(/^page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const page = Number(ctx.match?.[1]);
    const view = answerView(ctx.session.pages, page, {
      synthesized: ctx.session.synthesized,
    });
    await ctx.editMessageText(view.text, {
      parse_mode: "HTML",
      reply_markup: toKeyboard(view),
    });
  });

  bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id;
    const projectId = ctx.session.currentProjectId;

    if (projectId === undefined) {
      await ctx.reply("Сначала выберите проект — /start.");
      return;
    }

    try {
      const result = await deps.gateway.search(
        userId,
        projectId,
        ctx.message.text,
      );
      ctx.session.pages = paginate(result.fragments);
      ctx.session.synthesized = result.synthesized;

      const view = answerView(ctx.session.pages, 0, {
        synthesized: result.synthesized,
      });
      await ctx.reply(view.text, {
        parse_mode: "HTML",
        reply_markup: toKeyboard(view),
      });
    } catch (error) {
      await ctx.reply(excuse(error));
    }
  });

  bot.catch((err) => {
    console.error("bot error:", err.message);
  });

  return bot;
}
