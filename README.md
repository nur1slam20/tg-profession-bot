#  Telegram Profession Bot

Бот для профориентации на TypeScript с PostgreSQL и Prisma.

##  Быстрый старт

### 1. Настройка окружения

#### Вариант A: PostgreSQL (рекомендуется для продакшна)
```bash
# Установите PostgreSQL (macOS)
brew install postgresql
brew services start postgresql

# Создайте базу данных
createdb tg_profession_bot

# Создайте .env файл
cp .env.example .env
# Заполните переменные:
# BOT_TOKEN=your_telegram_bot_token
# DATABASE_URL=postgresql://username:password@localhost:5432/tg_profession_bot
# PORT=3000
```

#### Вариант B: SQLite (для быстрого тестирования)
```bash
# Создайте .env файл
cp .env.example .env
# Заполните переменные:
# BOT_TOKEN=your_telegram_bot_token
# DATABASE_URL=file:./dev.db
# PORT=3000
```

### 2. Установка зависимостей
```bash
npm install
```

### 3. Настройка базы данных
```bash
# Генерация Prisma клиента
npx prisma generate

# Создание миграций
npx prisma migrate dev --name init

# Заполнение тестовыми данными
npm run db:seed
```

### 4. Запуск

#### Быстрый старт с SQLite (для тестирования)
```bash
# Автоматическая настройка с SQLite
npm run dev:sqlite
```

#### Обычный запуск
```bash
# Режим разработки
npm run dev

# Продакшн
npm run build
npm start
```

> **Важно**: Не забудьте заменить `your_bot_token_here` в .env на реальный токен от @BotFather!

##  Команды бота

- `/start` — регистрация (имя, фамилия, телефон)
- `/test` — пройти тест на профориентацию
- `/history` — посмотреть историю тестов

##  Алгоритм тестирования

1. **Взвешенная система**: каждый ответ имеет веса для разных профессий
2. **Подсчет баллов**: веса суммируются по каждой профессии
3. **Результат**: выбирается профессия с максимальным баллом

##  Архитектура

- **Backend**: Node.js + Express
- **Database**: PostgreSQL + Prisma ORM
- **Bot Framework**: Grammy (Telegram Bot API)
- **Language**: TypeScript

##  API Endpoints

- `GET /stats` — статистика пользователей и тестов
- `GET /health` — проверка состояния сервера

##  Профессии

- **DataAnalyst** — Аналитик данных
- **BackendDev** — Бэкенд-разработчик  
- **FrontendDev** — Фронтенд-разработчик
- **PM** — Проектный менеджер

##  Разработка

```bash
# Просмотр базы данных
npx prisma studio

# Сброс базы данных
npx prisma migrate reset

# Генерация нового seed
npm run db:seed
```

##  Структура проекта

```
src/
├── index.ts          # Основной файл бота
prisma/
├── schema.prisma     # Схема базы данных
├── seed.ts          # Тестовые данные
└── migrations/      # Миграции БД
```

##  Деплой

1. Настройте переменные окружения на сервере
2. Запустите миграции: `npx prisma migrate deploy`
3. Заполните данные: `npm run db:seed`
4. Запустите: `npm start`
