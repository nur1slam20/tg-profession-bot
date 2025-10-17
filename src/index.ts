import "dotenv/config";
import { Bot, Keyboard } from "grammy";
import { PrismaClient } from "@prisma/client";
import express from "express";

const prisma = new PrismaClient();
const bot = new Bot(process.env.BOT_TOKEN!);

type Step = "idle"|"askFirstName"|"askLastName"|"askPhone"|"testing";
const userState = new Map<string, { step: Step, sessionId?: number, currentOrder?: number, scores?: Record<string, number>, firstName?: string, lastName?: string }>();

bot.command("start", async (ctx) => {
  const tgId = String(ctx.from?.id);
  userState.set(tgId, { step: "askFirstName" });
  await ctx.reply("Привет! Давай зарегистрируемся. Как тебя зовут? Введи имя.");
});

bot.on("message:text", async (ctx) => {
  const tgId = String(ctx.from?.id);
  const state = userState.get(tgId) || { step: "idle" as Step };

  if (state.step === "askFirstName") {
    state.firstName = ctx.message.text?.trim() || "";
    state.step = "askLastName";
    userState.set(tgId, state);
    return ctx.reply("Отлично. Теперь фамилия:");
  }

  if (state.step === "askLastName") {
    state.lastName = ctx.message.text?.trim() || "";
    state.step = "askPhone";
    userState.set(tgId, state);
    const kb = new Keyboard().requestContact("Поделиться контактом").oneTime().resized();
    return ctx.reply("Укажи номер телефона (можешь поделиться контактом кнопкой):", { reply_markup: kb });
  }

  if (state.step === "askPhone") {
    const phone = ctx.message.text?.trim();
    if (!phone) return ctx.reply("Введи номер текстом или поделись контактом.");
    await upsertUser(tgId, state.firstName!, state.lastName!, phone);
    await ctx.reply("Регистрация завершена. Напиши /test чтобы пройти тест.");
    state.step = "idle";
    userState.set(tgId, state);
    return;
  }

  if (ctx.message.text === "/test") return handleTestStart(ctx);
  if (ctx.message.text === "/history") return handleHistory(ctx);

  if (state.step === "idle") return ctx.reply("Доступные команды: /test — пройти тест, /history — история.");
});

bot.on("message:contact", async (ctx) => {
  const tgId = String(ctx.from?.id);
  const state = userState.get(tgId) || { step: "idle" as Step };
  if (state.step === "askPhone" && ctx.message.contact?.phone_number) {
    await upsertUser(tgId, state.firstName!, state.lastName!, ctx.message.contact.phone_number);
    await ctx.reply("Регистрация завершена. Напиши /test чтобы пройти тест.");
    state.step = "idle";
    userState.set(tgId, state);
  }
});

bot.on("callback_query:data", async (ctx) => {
  const tgId = String(ctx.from?.id);
  const state = userState.get(tgId);
  if (!state || state.step !== "testing" || !state.sessionId) { await ctx.answerCallbackQuery(); return; }

  const data = String(ctx.callbackQuery.data);
  const parts = data.split(":");
  const kind = parts[0];
  const answerIdStr = parts[1];
  if (kind !== "ans") { await ctx.answerCallbackQuery(); return; }
  const answerId = Number(answerIdStr);

  const answer = await prisma.answer.findUnique({ where: { id: answerId }});
  if (!answer) { await ctx.answerCallbackQuery(); return; }

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
    if (prof) await ctx.editMessageText(`Готово!\nВам больше всего подходит профессия: ${prof.title}\n\n${prof.description}`);
    else await ctx.editMessageText(`Готово! Итог: ${result ?? "не определено"}`);
    state.step = "idle"; userState.set(tgId, state); await ctx.answerCallbackQuery(); return;
  }

  state.currentOrder = nextOrder; userState.set(tgId, state);
  await ctx.editMessageText(formatQuestion(nextQ.text, nextOrder), { reply_markup: { inline_keyboard: chunk(nextQ.answers.map(a => ({ text: a.text, callback_data: `ans:${a.id}` })), 2) } });
  await ctx.answerCallbackQuery();
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
  await prisma.user.upsert({ where: { tgId }, update: { firstName, lastName, phone }, create: { tgId, firstName, lastName, phone } });
}

async function handleTestStart(ctx: any) {
  const tgId = String(ctx.from?.id);
  const user = await prisma.user.findUnique({ where: { tgId } });
  if (!user) { userState.set(tgId, { step: "askFirstName" }); return ctx.reply("Сначала зарегистрируйся. Введи имя:"); }

  const session = await prisma.testSession.create({ data: { userId: user.id } });
  const firstQ = await prisma.question.findFirst({ include: { answers: true }, orderBy: { order: "asc" } });
  if (!firstQ) return ctx.reply("Вопросы не найдены. Обратись к администратору.");

  userState.set(tgId, { step: "testing", sessionId: session.id, currentOrder: firstQ.order, scores: {} });
  return ctx.reply(formatQuestion(firstQ.text, firstQ.order), { reply_markup: { inline_keyboard: chunk(firstQ.answers.map(a => ({ text: a.text, callback_data: `ans:${a.id}` })), 2) } });
}

async function handleHistory(ctx: any) {
  const tgId = String(ctx.from?.id);
  const user = await prisma.user.findUnique({ where: { tgId } });
  if (!user) return ctx.reply("Сначала зарегистрируйся: /start");

  const sessions = await prisma.testSession.findMany({ where: { userId: user.id }, orderBy: { startedAt: "desc" }, take: 10 });
  if (sessions.length === 0) return ctx.reply("История пуста.");

  const lines = await Promise.all(sessions.map(async (s) => { const prof = s.resultProfession ? await prisma.profession.findUnique({ where: { code: s.resultProfession } }) : null; const title = prof?.title ?? s.resultProfession ?? "не определено"; return `• ${new Date(s.startedAt).toLocaleString()} — ${title}`; }));
  return ctx.reply(`Последние результаты:\n${lines.join("\n")}`);
}

const app = express();
app.get("/stats", async (_req, res) => { const users = await prisma.user.count(); const sessions = await prisma.testSession.count(); res.json({ users, sessions }); });

const port = Number(process.env.PORT || 3000);
app.listen(port, () => { console.log(`Admin stats at http://localhost:${port}/stats`); });

bot.start();
console.log("Bot started. Use /start in Telegram.");
