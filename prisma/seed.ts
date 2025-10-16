import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const professions = [
    { code: "DataAnalyst", title: "Аналитик данных", description: "Работает с данными, дашбордами и SQL." },
    { code: "BackendDev", title: "Бэкенд-разработчик", description: "Пишет серверную логику и API." },
    { code: "FrontendDev", title: "Фронтенд-разработчик", description: "Создаёт UI в браузере." },
    { code: "PM", title: "Проектный менеджер", description: "Управляет проектами и коммуникациями." }
  ];

  for (const p of professions) {
    await prisma.profession.upsert({ where: { code: p.code }, update: {}, create: p });
  }

  const qAndA = [
    { text: "Что вам ближе?", answers: [
      { text: "Работа с таблицами и метриками", weights: { DataAnalyst: 2 } },
      { text: "Проектирование API", weights: { BackendDev: 2 } },
      { text: "Создание интерфейсов", weights: { FrontendDev: 2 } },
      { text: "Организация людей и процессов", weights: { PM: 2 } }
    ] },
    { text: "Какую задачу выберете?", answers: [
      { text: "Написать SQL отчёт", weights: { DataAnalyst: 2, BackendDev: 1 } },
      { text: "Сделать REST endpoint", weights: { BackendDev: 2 } },
      { text: "Сверстать форму", weights: { FrontendDev: 2 } },
      { text: "Составить план релиза", weights: { PM: 2 } }
    ] },
    { text: "Что вызывает интерес?", answers: [
      { text: "BI и аналитика", weights: { DataAnalyst: 2 } },
      { text: "Базы данных и микросервисы", weights: { BackendDev: 2 } },
      { text: "UX и компоненты", weights: { FrontendDev: 2 } },
      { text: "Коммуникации с командой", weights: { PM: 2 } }
    ] },
    { text: "Какие навыки хотите прокачать?", answers: [
      { text: "Статистика и SQL", weights: { DataAnalyst: 2 } },
      { text: "Архитектура серверов", weights: { BackendDev: 2 } },
      { text: "Дизайн-системы", weights: { FrontendDev: 2 } },
      { text: "Управление рисками", weights: { PM: 2 } }
    ] },
    { text: "В чём комфортнее работать?", answers: [
      { text: "Данные и отчёты", weights: { DataAnalyst: 2 } },
      { text: "Сервер и логика", weights: { BackendDev: 2 } },
      { text: "Браузер и UI", weights: { FrontendDev: 2 } },
      { text: "Люди и сроки", weights: { PM: 2 } }
    ] }
  ];

  await prisma.testAnswer.deleteMany();
  await prisma.testSession.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.question.deleteMany();

  for (let i = 0; i < qAndA.length; i++) {
    const q = qAndA[i];
    const createdQ = await prisma.question.create({ data: { text: q.text, order: i + 1 } });
    for (const a of q.answers) {
      await prisma.answer.create({ data: { text: a.text, questionId: createdQ.id, weightsJson: a.weights as any } });
    }
  }
}

main().then(async () => { await prisma.$disconnect(); }).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
