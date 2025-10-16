# Telegram Profession Bot (TS + PostgreSQL + Prisma)

## Setup
1. Create .env from .env.example and fill values.
2. Install deps: npm i
3. Prisma: npx prisma generate && npx prisma migrate dev --name init && npm run db:seed
4. Run bot (dev): npm run dev

## Commands
- /start — registration (name, surname, phone)
- /test — start test
- /history — last results

## Algorithm
Weighted scoring per answer: weightsJson sums by profession, pick max.
