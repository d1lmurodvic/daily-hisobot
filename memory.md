# Kunlik Hisobot Bot — Memory (project memory)

YANGILANADI: har bir tugallangan taskdan keyin fayl yangilanadi.

## Loyiha haqida

- Loyiha: **Kunlik Sarf / Kunlik Hisobot** Telegram bobi — xarajat kuzatuvchi
- Bot: **@asistent_kunlikhisobot_bot** ("Kunlik Hisobot Asistent")
- Uchun: **Ilhombek** (porject: `real-projects/withIlhombek/dailyHisobot`)
- Til: O'zbek (uz)
- Maqsad: kundalik xarajatlarni kategoriyalarga ajratib hisobot berish

## Texnologik stack

- Node.js v24.18.0
- TypeScript 5.x (tsconfig: ES2020, CommonJS, strict: false)
- **Telegraf 4.16.3** (Telegram bot framework)
- **Prisma 5.22.0** + **SQLite** (`prisma/dev.db`)
- ts-node-dev 2.0.0 (dev: auto-restart)
- Hosting tayyor: Railway (`railway.json`)

## Muhim fayllar

| Fayl | Vazifa |
|---|---|
| `src/index.ts` | BARCHA bot logikasi (yagona fayl, ~1134 qator) |
| `prisma/schema.prisma` | Ma'lumot bazasi modeli (Expense, UserSetting) |
| `.env` | Secret — **git'ga chiqarmaslik kerak!** |
| `.env.example` | Namuna (nusxadan `.env` yaratiladi) |
| `package.json` | Scriptlar va bog'liqliklar |
| `railway.json` | Railway deploy sozlamasi |
| `bot.log` / `bot.pid` | Ishlayotgan jarayon izlari (avtomatik, .gitignore'ga qo'shish tavsiya) |

## Secret / Data (muhim!)

- `BOT_TOKEN` — `.env` faylida. Bu maxfiy — README/commits/git'ga YOZILMAYDI.
- `DATABASE_URL="file:./dev.db"` — SQLite fayl `prisma/dev.db`
- Stickerlar: `STICKER_OVQAT/TRANSPORT/UY/SOGLIQ/TALIM/BOSHQA` (.env da, ixtiyoriy)

## Buyruqlar

```bash
npm install                 # bog'liqliklar (+ postinstall: prisma generate)
npm run dev                 # dev, auto-restart (ts-node-dev)
npm run build               # tsc -> dist/
npm start                   # node dist/index.js
npm run migrate             # prisma db push (SQLite baza yaratish)
npm run prisma:generate     # prisma generate
```

## Ma'lumotlar bazasi (Prisma modellari)

- **Expense:** id, telegramId, amount(Int), category(String), description, date("DD/MM/YYYY" string), createdAt
  - index: (telegramId, date)
- **UserSetting:** telegramId(PK), dailyLimit?, reminderEnabled(Bool, def true), reminderHour(Int, def 21), lastReminderDate?, goalName?, goalTarget?, goalSaved(Int, def 0)

## Bot oqimi (screens / menyular)

Asosiy reply-keyboard: "➕ Xarajat qo'shish", "📋 Hisobotlar", "📊 Oylik hisobot", "📈 Grafik hisobot", "⏰ Eslatma", "🎯 Limit", "🏦 Maqsad", "⚙️ Boshqarish", "ℹ️ Bot haqida"

- **Xarajat qo'shish oqimi:** kategoriya(6) -> suma(tez tugmalar yoki maxsus) -> izoh -> saqlash
- **Hisobotlar:** bugun / boshqa sana / haftalik / grafik(SVG) / top kategoriya / CSV export
- **Oylik:** oy tanlash -> hisoboti
- **Eslatma:** yoqish/o'chirish, soatlar 20/21/22, har daqiqada `sendDueReminders` (Toshkent vaqti)
- **Limit:** kunlik limit kiriting (masalan 100000)
- **Maqsad:** nom -> maqsad -> yig'ma; holat/oust; progress bari
- **Boshqarish:** tahrirlash / o'chirish (sana -> ro'yxat -> #id tanlanadi)

Session state mashinasi (`FlowStep`): category, amount, customAmount, description, date, deleteDate, editDate, editAmount, editDescription, dailyLimit, goalName, goalTarget, goalSaving.

## Bot jarayoni boshqaruvi (shu kompyuterda)

- Ikkita bir xil token bilan ishlagan jarayon Telegram'da `409 Conflict` beradi — bot javob bermaydi.
- Toza start: eski node jarayonlarini o'ldirish, keyin bitta nusxani ishga tushirish.
- Falg: log `bot.log`, PID `bot.pid` (Start-Process + cmd redirect).

## Paydo bo'lgan muammolar / yechimlar

- **07.09.2026 — BOT_TOKEN .env'ga qaramasdan BOSHQA botga ulanishi (eng katta bug!).**
  Sabab: Windows'larda `BOT_TOKEN` **user/machine env o'zgaruvchisi** sifatida global o'rnatilgan bo'lsa, `dotenv` buni **ustun qolib** `.env`ni O'QIY olmaydi (dotenv faqat bo'sh bo'lmagan o'zgaruvchilarni yozmaydi). Bot har doim `@BlackPhonix_bot` (8710720130...) ga ulanib, asistent bot ga kelgan /start ga javob bermay qolgan.
  Yechim (muhim!): `dotenv.config({ override: true })` qilish — `src/index.ts` boshida. Endi `.env` Boshqa hamma narsani USTIN bo'ladi. (Railway'da .env yo'q, env var ishlayveradi — xavfsiz.)

- **07.09.2026 — Bot /start ga javob bermasligi.** Sabab: bitta BOT_TOKEN bilan IKKITA node jarayoni polling qilgan (biri eski, `node src/index.js`, 5:53; ikkinchisi `npm run dev`, 6:03) → Telegram `409 Conflict`, bot javob bermay qolgan.
  Yechim: `Stop-Process` bilan BARCHA node jarayonlarini o'ldirish → bitta nusxani toza ishga tushirish → `getWebhookInfo` da `pending_update_count: 0`.
  Qoida: bitta token faqat BIRTA jarayonga tegishli.

- **07.09.2026 — BUG: `startReminderScheduler()` va "Bot ishga tushdi" umuman ishga tushmagan.**
  Buning sababi: Telegraf 4 `polling.loop()` — cheksiz `for await` loop, HECh QACHON resolve bo'lmaydi. Shuning uchun `await bot.launch()` dan keyingi kod hech qachon bajarilmaydi.
  Yechim: scheduler va log `bot.launch()`dan OLDIN ko'chirildi (`src/index.ts:1131`):
  ```
  await ensureDatabase();
  await setupBotProfile();
  startReminderScheduler();
  console.log("Bot ishga tushdi");
  await bot.launch();   // hech qachon resolve bo'lmaydi — oxirida turishi kerak
  ```

- **Diagnostika usullari (debug):**
  - `getMe` — token ishlaydimi
  - `getWebhookInfo` — `pending_update_count` (teskari: bot poll qilmasa bu raqam o'sadi)
  - `getUpdates` — DIQQAT: offset'siz chaqirsangiz bot pollini buzasiz (409). Faqat offset bilan, tekshirish uchun.
  - `Get-NetTCPConnection -OwningProcess <appPID>` — Telegram`ga `Established` ulanish bor yo'qligi