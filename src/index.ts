import { Context, Markup, Telegraf, session } from "telegraf";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const token = process.env.BOT_TOKEN;

if (!token) {
  throw new Error("BOT_TOKEN is missing. Copy .env.example to .env and add your Telegram bot token.");
}

const bot = new Telegraf<BotContext>(token);
const prisma = new PrismaClient();

type FlowStep = "category" | "amount" | "customAmount" | "description" | "date";

interface SessionData {
  step?: FlowStep;
  amount?: number;
  category?: string;
}

interface BotContext extends Context {
  session: SessionData;
}

const timeZone = "Asia/Tashkent";
const amounts = [5000, 10000, 20000, 50000, 100000, 200000];
const categories = ["Ovqat", "Transport", "Uy", "Sog'liq", "Ta'lim", "Boshqa"];
const months = [
  "Yanvar",
  "Fevral",
  "Mart",
  "Aprel",
  "May",
  "Iyun",
  "Iyul",
  "Avgust",
  "Sentabr",
  "Oktabr",
  "Noyabr",
  "Dekabr",
];

bot.use(session({ defaultSession: (): SessionData => ({}) }));

async function ensureDatabase() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "Expense" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "telegramId" TEXT NOT NULL,
      "amount" INTEGER NOT NULL,
      "category" TEXT NOT NULL,
      "description" TEXT NOT NULL,
      "date" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "Expense_telegramId_date_idx"
    ON "Expense" ("telegramId", "date")
  `;
}

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).format(date);
}

function normalizeDateInput(value: string) {
  const match = value.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function getMonthName(date: string) {
  const monthIndex = Number(date.split("/")[1]) - 1;
  return months[monthIndex] || "Noma'lum";
}

function money(amount: number) {
  return amount.toLocaleString("uz-UZ");
}

function mainKeyboard() {
  return Markup.keyboard([
    ["Xarajat qo'shish"],
    ["Xarajatlarni ko'rish"],
    ["Oylik hisobot"],
  ]).resize();
}

function amountKeyboard() {
  const rows = [];

  for (let i = 0; i < amounts.length; i += 2) {
    rows.push([
      Markup.button.callback(`${money(amounts[i])} so'm`, `amount_${amounts[i]}`),
      Markup.button.callback(`${money(amounts[i + 1])} so'm`, `amount_${amounts[i + 1]}`),
    ]);
  }

  rows.push([Markup.button.callback("Boshqa summa", "custom_amount")]);
  rows.push([Markup.button.callback("Bekor qilish", "cancel")]);

  return Markup.inlineKeyboard(rows);
}

function categoryKeyboard() {
  const rows = [];

  for (let i = 0; i < categories.length; i += 2) {
    rows.push(
      categories.slice(i, i + 2).map((category) => Markup.button.callback(category, `category_${category}`)),
    );
  }

  rows.push([Markup.button.callback("Bekor qilish", "cancel")]);
  return Markup.inlineKeyboard(rows);
}

function monthKeyboard() {
  const rows = [];

  for (let i = 0; i < months.length; i += 3) {
    rows.push(months.slice(i, i + 3).map((month) => Markup.button.callback(month, `month_${month}`)));
  }

  return Markup.inlineKeyboard(rows);
}

function renderExpenses(title: string, expenses: Array<{ amount: number; category: string; description: string }>) {
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const list = expenses
    .map((expense) => `- ${money(expense.amount)} so'm | ${expense.category} | ${expense.description}`)
    .join("\n");

  return `${title}\n\n${list}\n\nUmumiy: ${money(total)} so'm`;
}

async function showToday(ctx: BotContext) {
  const today = formatDate();
  const expenses = await prisma.expense.findMany({
    where: {
      telegramId: String(ctx.from?.id),
      date: today,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!expenses.length) {
    return ctx.reply("Bugun hali xarajat qo'shilmagan.");
  }

  return ctx.reply(renderExpenses(`Bugungi xarajatlar (${today})`, expenses));
}

bot.start(async (ctx) => {
  ctx.session = {};

  await ctx.reply(
    "Kunlik Sarf Botiga xush kelibsiz! Xarajatlaringizni tez yozib boring.",
    mainKeyboard(),
  );
});

bot.command("menu", async (ctx) => {
  ctx.session = {};
  await ctx.reply("Asosiy menyu:", mainKeyboard());
});

bot.command("cancel", async (ctx) => {
  ctx.session = {};
  await ctx.reply("Amal bekor qilindi.", mainKeyboard());
});

bot.hears("Xarajat qo'shish", async (ctx) => {
  ctx.session = { step: "category" };
  await ctx.reply("Xarajat kategoriyasini tanlang:", categoryKeyboard());
});

bot.action(/category_(.+)/, async (ctx) => {
  const category = ctx.match[1];

  ctx.session.category = category;
  ctx.session.step = "amount";

  await ctx.answerCbQuery();
  await ctx.reply(`Kategoriya: ${category}\nSummani tanlang:`, amountKeyboard());
});

bot.action(/amount_(\d+)/, async (ctx) => {
  ctx.session.amount = Number(ctx.match[1]);
  ctx.session.step = "description";

  await ctx.answerCbQuery();
  await ctx.reply("Nimaga ishlatdingiz? Qisqa izoh yozing.");
});

bot.action("custom_amount", async (ctx) => {
  ctx.session.step = "customAmount";

  await ctx.answerCbQuery();
  await ctx.reply("Aniq summani kiriting. Masalan: 12500");
});

bot.action("cancel", async (ctx) => {
  ctx.session = {};

  await ctx.answerCbQuery("Bekor qilindi");
  await ctx.reply("Amal bekor qilindi.", mainKeyboard());
});

bot.hears("Xarajatlarni ko'rish", async (ctx) => {
  await ctx.reply(
    "Qaysi hisobot kerak?",
    Markup.inlineKeyboard([
      [Markup.button.callback("Bugungi sarf", "today")],
      [Markup.button.callback("Boshqa kun", "other_day")],
    ]),
  );
});

bot.action("today", async (ctx) => {
  await ctx.answerCbQuery();
  await showToday(ctx);
});

bot.action("other_day", async (ctx) => {
  ctx.session = { step: "date" };

  await ctx.answerCbQuery();
  await ctx.reply(`Sanani kiriting. Masalan: ${formatDate()}`);
});

bot.hears("Oylik hisobot", async (ctx) => {
  await ctx.reply("Oyni tanlang:", monthKeyboard());
});

bot.action(/month_(.+)/, async (ctx) => {
  const selectedMonth = ctx.match[1];
  const expenses = await prisma.expense.findMany({
    where: {
      telegramId: String(ctx.from?.id),
    },
    orderBy: {
      createdAt: "desc",
    },
  });
  const filtered = expenses.filter((expense) => getMonthName(expense.date) === selectedMonth);

  await ctx.answerCbQuery();

  if (!filtered.length) {
    return ctx.reply("Bu oy uchun ma'lumot topilmadi.");
  }

  return ctx.reply(renderExpenses(`${selectedMonth} hisoboti`, filtered));
});

bot.on("text", async (ctx, next) => {
  const text = ctx.message.text.trim();

  if (ctx.session.step === "customAmount") {
    const amount = Number(text.replace(/\s/g, ""));

    if (!Number.isFinite(amount) || amount <= 0) {
      return ctx.reply("To'g'ri summa kiriting. Masalan: 12500");
    }

    ctx.session.amount = Math.round(amount);
    ctx.session.step = "description";

    return ctx.reply("Nimaga ishlatdingiz? Qisqa izoh yozing.");
  }

  if (ctx.session.step === "description") {
    if (!ctx.session.amount || !ctx.session.category) {
      ctx.session = {};
      return ctx.reply("Xarajatni saqlash uchun boshidan boshlang.", mainKeyboard());
    }

    const date = formatDate();
    const expense = await prisma.expense.create({
      data: {
        telegramId: String(ctx.from?.id),
        amount: ctx.session.amount,
        category: ctx.session.category,
        description: text.slice(0, 300),
        date,
      },
    });

    ctx.session = {};

    return ctx.reply(
      `Xarajat saqlandi!\n\nSana: ${date}\nKategoriya: ${expense.category}\nSumma: ${money(expense.amount)} so'm\nIzoh: ${expense.description}`,
      mainKeyboard(),
    );
  }

  if (ctx.session.step === "date") {
    const date = normalizeDateInput(text);

    if (!date) {
      return ctx.reply("Sana noto'g'ri. Masalan: 17/05/2026");
    }

    const expenses = await prisma.expense.findMany({
      where: {
        telegramId: String(ctx.from?.id),
        date,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    ctx.session = {};

    if (!expenses.length) {
      return ctx.reply("Bu sana uchun ma'lumot topilmadi.", mainKeyboard());
    }

    return ctx.reply(renderExpenses(`${date} kuni xarajatlaringiz`, expenses), mainKeyboard());
  }

  return next();
});

bot.catch((error, ctx) => {
  console.error("Bot error:", error);
  ctx.reply("Xatolik yuz berdi. /menu ni bosib qayta urinib ko'ring.").catch(console.error);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

async function main() {
  await ensureDatabase();
  await bot.launch();
  console.log("Bot ishga tushdi");
}

main().catch(async (error) => {
  console.error("Startup error:", error);
  await prisma.$disconnect();
  process.exit(1);
});
