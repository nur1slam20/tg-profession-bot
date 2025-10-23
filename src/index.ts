import "dotenv/config";
import { Bot, Keyboard } from "grammy";
import { PrismaClient } from "@prisma/client";
import express from "express";

const prisma = new PrismaClient();
const bot = new Bot(process.env.BOT_TOKEN!);

type Step = "idle"|"askFirstName"|"askLastName"|"askPhone"|"testing";
const userState = new Map<string, { step: Step, sessionId?: number, currentOrder?: number, scores?: Record<string, number>, firstName?: string, lastName?: string }>();

bot.command("start", async (ctx) => {
  try {
    const tgId = String(ctx.from?.id);
    userState.set(tgId, { step: "askFirstName" });
    await ctx.reply("👋 Привет! Добро пожаловать в бот профориентации!\n\nДавай зарегистрируемся. Как тебя зовут? Введи имя:");
  } catch (error) {
    console.error("Error in start command:", error);
    await ctx.reply("Произошла ошибка. Попробуйте позже.");
  }
});

bot.on("message:text", async (ctx) => {
  try {
    const tgId = String(ctx.from?.id);
    const state = userState.get(tgId) || { step: "idle" as Step };

    if (state.step === "askFirstName") {
      const firstName = ctx.message.text?.trim();
      if (!firstName || firstName.length < 2) {
        return ctx.reply("❌ Пожалуйста, введите корректное имя (минимум 2 символа):");
      }
      state.firstName = firstName;
      state.step = "askLastName";
      userState.set(tgId, state);
      return ctx.reply(`✅ Отлично, ${firstName}! Теперь введите фамилию:`);
    }

    if (state.step === "askLastName") {
      const lastName = ctx.message.text?.trim();
      if (!lastName || lastName.length < 2) {
        return ctx.reply("❌ Пожалуйста, введите корректную фамилию (минимум 2 символа):");
      }
      state.lastName = lastName;
      state.step = "askPhone";
      userState.set(tgId, state);
      const kb = new Keyboard().requestContact("📱 Поделиться контактом").oneTime().resized();
      return ctx.reply("📞 Укажите номер телефона (можете поделиться контактом кнопкой):", { reply_markup: kb });
    }

    if (state.step === "askPhone") {
      const phone = ctx.message.text?.trim();
      if (!phone || phone.length < 10) {
        return ctx.reply("❌ Пожалуйста, введите корректный номер телефона или поделитесь контактом.");
      }
      await upsertUser(tgId, state.firstName!, state.lastName!, phone);
      await ctx.reply("🎉 Регистрация завершена!\n\nТеперь вы можете пройти тест на профориентацию. Напишите /test чтобы начать.");
      state.step = "idle";
      userState.set(tgId, state);
      return;
    }

    if (ctx.message.text === "/test") return handleTestStart(ctx);
    if (ctx.message.text === "/history") return handleHistory(ctx);

    if (state.step === "idle") {
      return ctx.reply("📋 Доступные команды:\n/test — пройти тест на профориентацию\n/history — посмотреть историю тестов");
    }
  } catch (error) {
    console.error("Error in message handler:", error);
    await ctx.reply("Произошла ошибка. Попробуйте позже.");
  }
});

bot.on("message:contact", async (ctx) => {
  try {
    const tgId = String(ctx.from?.id);
    const state = userState.get(tgId) || { step: "idle" as Step };
    if (state.step === "askPhone" && ctx.message.contact?.phone_number) {
      await upsertUser(tgId, state.firstName!, state.lastName!, ctx.message.contact.phone_number);
      await ctx.reply("🎉 Регистрация завершена!\n\nТеперь вы можете пройти тест на профориентацию. Напишите /test чтобы начать.");
      state.step = "idle";
      userState.set(tgId, state);
    }
  } catch (error) {
    console.error("Error in contact handler:", error);
    await ctx.reply("Произошла ошибка. Попробуйте позже.");
  }
});

bot.on("callback_query:data", async (ctx) => {
  try {
    const tgId = String(ctx.from?.id);
    const state = userState.get(tgId);
    if (!state || state.step !== "testing" || !state.sessionId) { 
      await ctx.answerCallbackQuery(); 
      return; 
    }

    const data = String(ctx.callbackQuery.data);
    const parts = data.split(":");
    const kind = parts[0];
    const answerIdStr = parts[1];
    if (kind !== "ans") { 
      await ctx.answerCallbackQuery(); 
      return; 
    }
    const answerId = Number(answerIdStr);

    const answer = await prisma.answer.findUnique({ where: { id: answerId }});
    if (!answer) { 
      await ctx.answerCallbackQuery(); 
      return; 
    }

    await prisma.testAnswer.create({ data: { sessionId: state.sessionId, questionId: answer.questionId, answerId } });

    const weights = answer.weightsJson as Record<string, number>;
    state.scores = state.scores || {};
    for (const prof of Object.keys(weights)) {
      const w = weights[prof] || 0;
      state.scores[prof] = (state.scores[prof] || 0) + w;
    }

    const nextOrder = (state.currentOrder || 1) + 1;
    const nextQ = await prisma.question.findFirst({ where: { order: nextOrder }, include: { answers: true }, orderBy: { order: "asc" } });

    if (!nextQ) {
      const result = pickBestProfession(state.scores || {});
      await prisma.testSession.update({ where: { id: state.sessionId }, data: { finishedAt: new Date(), resultProfession: result } });
      const prof = result ? await prisma.profession.findUnique({ where: { code: result } }) : null;
      
      if (prof) {
        await ctx.editMessageText(`🎯 Тест завершен!\n\nВам больше всего подходит профессия:\n\n💼 ${prof.title}\n\n📝 ${prof.description}\n\nНапишите /test чтобы пройти тест снова или /history чтобы посмотреть историю.`);
      } else {
        await ctx.editMessageText(`🎯 Тест завершен!\n\nРезультат: ${result ?? "не определено"}\n\nНапишите /test чтобы пройти тест снова.`);
      }
      state.step = "idle"; 
      userState.set(tgId, state); 
      await ctx.answerCallbackQuery(); 
      return;
    }

    state.currentOrder = nextOrder; 
    userState.set(tgId, state);
    await ctx.editMessageText(formatQuestion(nextQ.text, nextOrder), { 
      reply_markup: { 
        inline_keyboard: chunk(nextQ.answers.map(a => ({ text: a.text, callback_data: `ans:${a.id}` })), 2) 
      } 
    });
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error("Error in callback handler:", error);
    await ctx.answerCallbackQuery();
    await ctx.reply("Произошла ошибка. Попробуйте начать тест заново: /test");
  }
});

function pickBestProfession(scores: Record<string, number>): string | null {
  let best: string | null = null; let bestScore = -Infinity;
  for (const code of Object.keys(scores)) {
    const score = scores[code];
    if (score > bestScore) { bestScore = score; best = code; }
  }
  return best;
}

function formatQuestion(text: string, order: number) { return `Вопрос ${order}:\n${text}`; }
function chunk<T>(arr: T[], n: number): T[][] { const out: T[][] = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

async function upsertUser(tgId: string, firstName: string, lastName: string, phone: string) {
  try {
    await prisma.user.upsert({ 
      where: { tgId }, 
      update: { firstName, lastName, phone }, 
      create: { tgId, firstName, lastName, phone } 
    });
  } catch (error) {
    console.error("Error upserting user:", error);
    throw new Error("Не удалось сохранить данные пользователя");
  }
}

async function handleTestStart(ctx: any) {
  try {
    const tgId = String(ctx.from?.id);
    const user = await prisma.user.findUnique({ where: { tgId } });
    if (!user) { 
      userState.set(tgId, { step: "askFirstName" }); 
      return ctx.reply("❌ Сначала нужно зарегистрироваться. Введите имя:"); 
    }

    const session = await prisma.testSession.create({ data: { userId: user.id } });
    const firstQ = await prisma.question.findFirst({ include: { answers: true }, orderBy: { order: "asc" } });
    if (!firstQ) {
      return ctx.reply("❌ Вопросы не найдены. Обратитесь к администратору.");
    }

    userState.set(tgId, { step: "testing", sessionId: session.id, currentOrder: firstQ.order, scores: {} });
    return ctx.reply(
      `🧠 Тест на профориентацию\n\n${formatQuestion(firstQ.text, firstQ.order)}\n\nВыберите наиболее подходящий вариант:`, 
      { reply_markup: { inline_keyboard: chunk(firstQ.answers.map(a => ({ text: a.text, callback_data: `ans:${a.id}` })), 2) } }
    );
  } catch (error) {
    console.error("Error in handleTestStart:", error);
    await ctx.reply("Произошла ошибка при запуске теста. Попробуйте позже.");
  }
}

async function handleHistory(ctx: any) {
  try {
    const tgId = String(ctx.from?.id);
    const user = await prisma.user.findUnique({ where: { tgId } });
    if (!user) {
      return ctx.reply("❌ Сначала зарегистрируйтесь: /start");
    }

    const sessions = await prisma.testSession.findMany({ 
      where: { userId: user.id }, 
      orderBy: { startedAt: "desc" }, 
      take: 10 
    });
    
    if (sessions.length === 0) {
      return ctx.reply("📋 История тестов пуста.\n\nНапишите /test чтобы пройти первый тест!");
    }

    const lines = await Promise.all(sessions.map(async (s) => { 
      const prof = s.resultProfession ? await prisma.profession.findUnique({ where: { code: s.resultProfession } }) : null; 
      const title = prof?.title ?? s.resultProfession ?? "не определено"; 
      const status = s.finishedAt ? "✅" : "⏳";
      return `${status} ${new Date(s.startedAt).toLocaleString("ru-RU")} — ${title}`; 
    }));
    
    return ctx.reply(`📊 История ваших тестов:\n\n${lines.join("\n")}\n\nНапишите /test чтобы пройти новый тест!`);
  } catch (error) {
    console.error("Error in handleHistory:", error);
    await ctx.reply("Произошла ошибка при получении истории. Попробуйте позже.");
  }
}

const app = express();

app.get("/stats", async (req, res) => {
  try {
    const users = await prisma.user.count();
    const sessions = await prisma.testSession.count();
    const finishedSessions = await prisma.testSession.count({ where: { finishedAt: { not: null } } });
    
    res.json({ 
      users, 
      sessions, 
      finishedSessions,
      completionRate: sessions > 0 ? Math.round((finishedSessions / sessions) * 100) : 0
    });
  } catch (error) {
    console.error("Error getting stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => { 
  console.log(`🚀 Server started on port ${port}`);
  console.log(`📊 Admin stats: http://localhost:${port}/stats`);
  console.log(`❤️ Health check: http://localhost:${port}/health`);
});

bot.start();
console.log("🤖 Telegram bot started successfully!");
console.log("💬 Use /start in Telegram to begin registration");
