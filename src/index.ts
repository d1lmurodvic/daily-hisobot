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

type FlowStep =
  | "category"
  | "amount"
  | "customAmount"
  | "description"
  | "date"
  | "deleteDate"
  | "editDate"
  | "editAmount"
  | "editDescription"
  | "dailyLimit";

interface SessionData {
  step?: FlowStep;
  amount?: number;
  category?: string;
  editingExpenseId?: number;
  editAmount?: number;
}

interface BotContext extends Context {
  session: SessionData;
}

type ExpenseItem = {
  id: number;
  telegramId: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  createdAt: Date;
};

type UserSetting = {
  telegramId: string;
  dailyLimit: number | null;
};

const timeZone = "Asia/Tashkent";
const amounts = [5000, 10000, 20000, 50000, 100000, 200000];
const categoryConfigs = [
  { name: "🍔 Ovqat", stickerEnv: "STICKER_OVQAT" },
  { name: "🚕 Transport", stickerEnv: "STICKER_TRANSPORT" },
  { name: "🏠 Uy", stickerEnv: "STICKER_UY" },
  { name: "💊 Sog'liq", stickerEnv: "STICKER_SOGLIQ" },
  { name: "📚 Ta'lim", stickerEnv: "STICKER_TALIM" },
  { name: "✨ Boshqa", stickerEnv: "STICKER_BOSHQA" },
];
const categories = categoryConfigs.map((category) => category.name);
const categoryStickerEnv = new Map(
  categoryConfigs.map((category) => [category.name, category.stickerEnv]),
);
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

const helpText = [
  "👋 Salom! Men Kunlik Sarf Botman.",
  "",
  "Men sizga pul qayerga ketayotganini ko'rishga yordam beraman:",
  "➕ xarajat qo'shaman",
  "🏷️ kategoriyaga ajrataman",
  "📅 kunlik va haftalik hisobot chiqaraman",
  "📊 oylik hisobot va top kategoriya ko'rsataman",
  "🎯 kunlik limit qo'yaman",
  "✏️ xarajatni tahrirlash va 🗑️ o'chirishga yordam beraman",
  "📤 CSV export beraman",
  "",
  "Boshlash uchun pastdagi tugmalardan birini tanlang.",
].join("\n");

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

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "UserSetting" (
      "telegramId" TEXT NOT NULL PRIMARY KEY,
      "dailyLimit" INTEGER
    )
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

function parseStoredDate(value: string) {
  const [day, month, year] = value.split("/").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
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

function parseAmount(text: string) {
  const amount = Number(text.replace(/[^\d]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null;
}

function getTelegramId(ctx: BotContext) {
  return String(ctx.from?.id);
}

function mainKeyboard() {
  return Markup.keyboard([
    ["➕ Xarajat qo'shish"],
    ["📋 Hisobotlar", "📊 Oylik hisobot"],
    ["🎯 Limit", "⚙️ Boshqarish"],
    ["ℹ️ Bot haqida"],
  ]).resize();
}

function amountKeyboard() {
  const rows = [];

  for (let i = 0; i < amounts.length; i += 2) {
    rows.push([
      Markup.button.callback(`💸 ${money(amounts[i])} so'm`, `amount_${amounts[i]}`),
      Markup.button.callback(`💸 ${money(amounts[i + 1])} so'm`, `amount_${amounts[i + 1]}`),
    ]);
  }

  rows.push([Markup.button.callback("✍️ Boshqa summa", "custom_amount")]);
  rows.push([Markup.button.callback("❌ Bekor qilish", "cancel")]);

  return Markup.inlineKeyboard(rows);
}

function categoryKeyboard() {
  const rows = [];

  for (let i = 0; i < categories.length; i += 2) {
    rows.push(
      categories.slice(i, i + 2).map((category) => Markup.button.callback(category, `category_${category}`)),
    );
  }

  rows.push([Markup.button.callback("❌ Bekor qilish", "cancel")]);
  return Markup.inlineKeyboard(rows);
}

function reportKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📅 Bugungi sarf", "today")],
    [Markup.button.callback("🗓️ Boshqa kun", "other_day")],
    [Markup.button.callback("📆 Haftalik hisobot", "weekly")],
    [Markup.button.callback("🏆 Top kategoriya", "top_category")],
    [Markup.button.callback("📤 CSV export", "export_csv")],
  ]);
}

function manageKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✏️ Xarajatni tahrirlash", "edit_expense")],
    [Markup.button.callback("🗑️ Xarajatni o'chirish", "delete_expense")],
    [Markup.button.callback("❌ Bekor qilish", "cancel")],
  ]);
}

function monthKeyboard() {
  const rows = [];

  for (let i = 0; i < months.length; i += 3) {
    rows.push(months.slice(i, i + 3).map((month) => Markup.button.callback(`📊 ${month}`, `month_${month}`)));
  }

  return Markup.inlineKeyboard(rows);
}

function expenseActionKeyboard(expenses: ExpenseItem[], action: "delete" | "edit") {
  return Markup.inlineKeyboard(
    expenses.map((expense) => [
      Markup.button.callback(
        `${action === "delete" ? "🗑️" : "✏️"} #${expense.id} - ${money(expense.amount)} so'm`,
        `${action}_${expense.id}`,
      ),
    ]),
  );
}

function renderExpenses(title: string, expenses: Array<{ amount: number; category: string; description: string }>) {
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const list = expenses
    .map((expense) => `• ${money(expense.amount)} so'm | ${expense.category} | ${expense.description}`)
    .join("\n");

  return `${title}\n\n${list}\n\n💰 Umumiy: ${money(total)} so'm`;
}

function renderExpensesWithIds(title: string, expenses: ExpenseItem[]) {
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const list = expenses
    .map(
      (expense) =>
        `#${expense.id} • ${money(expense.amount)} so'm | ${expense.category} | ${expense.description}`,
    )
    .join("\n");

  return `${title}\n\n${list}\n\n💰 Umumiy: ${money(total)} so'm`;
}

async function getExpensesForUser(telegramId: string) {
  return prisma.expense.findMany({
    where: { telegramId },
    orderBy: { createdAt: "desc" },
  });
}

async function getSetting(telegramId: string) {
  const rows = await prisma.$queryRaw<UserSetting[]>`
    SELECT "telegramId", "dailyLimit" FROM "UserSetting" WHERE "telegramId" = ${telegramId}
  `;

  return rows[0] || null;
}

async function setDailyLimit(telegramId: string, dailyLimit: number) {
  await prisma.$executeRaw`
    INSERT INTO "UserSetting" ("telegramId", "dailyLimit")
    VALUES (${telegramId}, ${dailyLimit})
    ON CONFLICT("telegramId") DO UPDATE SET "dailyLimit" = ${dailyLimit}
  `;
}

async function getTodayTotal(telegramId: string) {
  const today = formatDate();
  const result = await prisma.expense.aggregate({
    where: { telegramId, date: today },
    _sum: { amount: true },
  });

  return result._sum.amount || 0;
}

async function getLimitNotice(telegramId: string) {
  const setting = await getSetting(telegramId);

  if (!setting?.dailyLimit) return "";

  const total = await getTodayTotal(telegramId);
  const left = setting.dailyLimit - total;

  if (left >= 0) {
    return `\n\n🎯 Bugungi limit: ${money(setting.dailyLimit)} so'm\n✅ Qolgan: ${money(left)} so'm`;
  }

  return `\n\n🎯 Bugungi limit: ${money(setting.dailyLimit)} so'm\n⚠️ Limitdan oshdingiz: ${money(Math.abs(left))} so'm`;
}

async function showToday(ctx: BotContext) {
  const telegramId = getTelegramId(ctx);
  const today = formatDate();
  const expenses = await prisma.expense.findMany({
    where: { telegramId, date: today },
    orderBy: { createdAt: "desc" },
  });

  if (!expenses.length) {
    return ctx.reply("📭 Bugun hali xarajat qo'shilmagan.");
  }

  const notice = await getLimitNotice(telegramId);
  return ctx.reply(`${renderExpenses(`📅 Bugungi xarajatlar (${today})`, expenses)}${notice}`);
}

async function showWeekly(ctx: BotContext) {
  const telegramId = getTelegramId(ctx);
  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 6);
  const expenses = await getExpensesForUser(telegramId);
  const filtered = expenses.filter((expense) => parseStoredDate(expense.date) >= start);

  if (!filtered.length) {
    return ctx.reply("📭 Oxirgi 7 kunda xarajat topilmadi.");
  }

  return ctx.reply(renderExpenses("📆 Oxirgi 7 kunlik hisobot", filtered));
}

async function showTopCategory(ctx: BotContext) {
  const expenses = await getExpensesForUser(getTelegramId(ctx));

  if (!expenses.length) {
    return ctx.reply("📭 Hali xarajat yo'q. Avval bittasini qo'shib ko'ring.");
  }

  const totals = new Map<string, number>();

  for (const expense of expenses) {
    totals.set(expense.category, (totals.get(expense.category) || 0) + expense.amount);
  }

  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const lines = sorted.map(([category, total], index) => `${index + 1}. ${category}: ${money(total)} so'm`);

  return ctx.reply(`🏆 Eng ko'p pul ketgan kategoriyalar:\n\n${lines.join("\n")}`);
}

async function exportCsv(ctx: BotContext) {
  const expenses = await getExpensesForUser(getTelegramId(ctx));

  if (!expenses.length) {
    return ctx.reply("📭 Export uchun xarajat topilmadi.");
  }

  const csv = [
    "id,date,category,amount,description",
    ...expenses.map((expense) =>
      [
        expense.id,
        expense.date,
        `"${expense.category.replace(/"/g, '""')}"`,
        expense.amount,
        `"${expense.description.replace(/"/g, '""')}"`,
      ].join(","),
    ),
  ].join("\n");

  return ctx.replyWithDocument({
    source: Buffer.from(csv, "utf8"),
    filename: `xarajatlar-${formatDate().replace(/\//g, "-")}.csv`,
  });
}

async function sendCategorySticker(ctx: BotContext, category: string) {
  const envName = categoryStickerEnv.get(category);
  const stickerId = envName ? process.env[envName] : undefined;

  if (!stickerId) return;

  try {
    await ctx.replyWithSticker(stickerId);
  } catch (error) {
    console.warn(`Sticker yuborilmadi: ${category}`, error);
  }
}

async function setupBotProfile() {
  await bot.telegram.setMyCommands([
    { command: "start", description: "🚀 Botni boshlash" },
    { command: "menu", description: "🏠 Asosiy menyu" },
    { command: "help", description: "ℹ️ Bot imkoniyatlari" },
    { command: "cancel", description: "❌ Amalni bekor qilish" },
  ]);

  await bot.telegram.setMyShortDescription(
    "💸 Xarajatlarni yozing, limit qo'ying, hisobot oling.",
  );

  await bot.telegram.setMyDescription(
    "💸 Kunlik Sarf Bot xarajatlaringizni kategoriyaga ajratadi, kunlik/haftalik/oylik hisobot beradi, limitdan oshsangiz ogohlantiradi va CSV export qiladi.",
  );
}

bot.start(async (ctx) => {
  ctx.session = {};
  await ctx.reply(`🚀 Kunlik Sarf Botiga xush kelibsiz!\n\n${helpText}`, mainKeyboard());
});

bot.command("menu", async (ctx) => {
  ctx.session = {};
  await ctx.reply("🏠 Asosiy menyu:", mainKeyboard());
});

bot.command("cancel", async (ctx) => {
  ctx.session = {};
  await ctx.reply("❌ Amal bekor qilindi.", mainKeyboard());
});

bot.command("help", async (ctx) => {
  await ctx.reply(helpText, mainKeyboard());
});

bot.hears("ℹ️ Bot haqida", async (ctx) => {
  await ctx.reply(helpText, mainKeyboard());
});

bot.hears("➕ Xarajat qo'shish", async (ctx) => {
  ctx.session = { step: "category" };
  await ctx.reply("🏷️ Xarajat kategoriyasini tanlang:", categoryKeyboard());
});

bot.hears("📋 Hisobotlar", async (ctx) => {
  await ctx.reply("📋 Qaysi hisobot kerak?", reportKeyboard());
});

bot.hears("📊 Oylik hisobot", async (ctx) => {
  await ctx.reply("📊 Oyni tanlang:", monthKeyboard());
});

bot.hears("🎯 Limit", async (ctx) => {
  const setting = await getSetting(getTelegramId(ctx));
  const current = setting?.dailyLimit ? `${money(setting.dailyLimit)} so'm` : "hali qo'yilmagan";

  ctx.session = { step: "dailyLimit" };
  await ctx.reply(`🎯 Hozirgi kunlik limit: ${current}\n\nYangi limitni kiriting. Masalan: 100000`);
});

bot.hears("⚙️ Boshqarish", async (ctx) => {
  await ctx.reply("⚙️ Nima qilamiz?", manageKeyboard());
});

bot.action(/category_(.+)/, async (ctx) => {
  const category = ctx.match[1];

  ctx.session.category = category;
  ctx.session.step = "amount";

  await ctx.answerCbQuery();
  await sendCategorySticker(ctx, category);
  await ctx.reply(`✅ Kategoriya: ${category}\n💸 Summani tanlang:`, amountKeyboard());
});

bot.action(/amount_(\d+)/, async (ctx) => {
  ctx.session.amount = Number(ctx.match[1]);
  ctx.session.step = "description";

  await ctx.answerCbQuery();
  await ctx.reply("📝 Nimaga ishlatdingiz? Qisqa izoh yozing.");
});

bot.action("custom_amount", async (ctx) => {
  ctx.session.step = "customAmount";

  await ctx.answerCbQuery();
  await ctx.reply("✍️ Aniq summani kiriting. Masalan: 12500");
});

bot.action("cancel", async (ctx) => {
  ctx.session = {};

  await ctx.answerCbQuery("Bekor qilindi");
  await ctx.reply("❌ Amal bekor qilindi.", mainKeyboard());
});

bot.action("today", async (ctx) => {
  await ctx.answerCbQuery();
  await showToday(ctx);
});

bot.action("other_day", async (ctx) => {
  ctx.session = { step: "date" };

  await ctx.answerCbQuery();
  await ctx.reply(`🗓️ Sanani kiriting. Masalan: ${formatDate()}`);
});

bot.action("weekly", async (ctx) => {
  await ctx.answerCbQuery();
  await showWeekly(ctx);
});

bot.action("top_category", async (ctx) => {
  await ctx.answerCbQuery();
  await showTopCategory(ctx);
});

bot.action("export_csv", async (ctx) => {
  await ctx.answerCbQuery();
  await exportCsv(ctx);
});

bot.action("delete_expense", async (ctx) => {
  ctx.session = { step: "deleteDate" };

  await ctx.answerCbQuery();
  await ctx.reply(`🗑️ Qaysi kundagi xarajatni o'chiramiz? Sana kiriting. Masalan: ${formatDate()}`);
});

bot.action("edit_expense", async (ctx) => {
  ctx.session = { step: "editDate" };

  await ctx.answerCbQuery();
  await ctx.reply(`✏️ Qaysi kundagi xarajatni tahrirlaymiz? Sana kiriting. Masalan: ${formatDate()}`);
});

bot.action(/delete_(\d+)/, async (ctx) => {
  const id = Number(ctx.match[1]);
  const result = await prisma.expense.deleteMany({
    where: {
      id,
      telegramId: getTelegramId(ctx),
    },
  });

  await ctx.answerCbQuery();

  if (!result.count) {
    return ctx.reply("🤔 Bu xarajat topilmadi yoki sizga tegishli emas.", mainKeyboard());
  }

  return ctx.reply("🗑️ Xarajat o'chirildi.", mainKeyboard());
});

bot.action(/edit_(\d+)/, async (ctx) => {
  const id = Number(ctx.match[1]);
  const expense = await prisma.expense.findFirst({
    where: {
      id,
      telegramId: getTelegramId(ctx),
    },
  });

  await ctx.answerCbQuery();

  if (!expense) {
    return ctx.reply("🤔 Bu xarajat topilmadi yoki sizga tegishli emas.", mainKeyboard());
  }

  ctx.session = { step: "editAmount", editingExpenseId: id };
  return ctx.reply(
    `✏️ Tahrirlash: ${expense.category} | ${money(expense.amount)} so'm | ${expense.description}\n\nYangi summani kiriting:`,
  );
});

bot.action(/month_(.+)/, async (ctx) => {
  const selectedMonth = ctx.match[1];
  const expenses = await getExpensesForUser(getTelegramId(ctx));
  const filtered = expenses.filter((expense) => getMonthName(expense.date) === selectedMonth);

  await ctx.answerCbQuery();

  if (!filtered.length) {
    return ctx.reply("📭 Bu oy uchun ma'lumot topilmadi.");
  }

  return ctx.reply(renderExpenses(`📊 ${selectedMonth} hisoboti`, filtered));
});

bot.on("text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  const telegramId = getTelegramId(ctx);

  if (ctx.session.step === "customAmount") {
    const amount = parseAmount(text);

    if (!amount) {
      return ctx.reply("❌ To'g'ri summa kiriting. Masalan: 12500");
    }

    ctx.session.amount = amount;
    ctx.session.step = "description";

    return ctx.reply("📝 Nimaga ishlatdingiz? Qisqa izoh yozing.");
  }

  if (ctx.session.step === "description") {
    if (!ctx.session.amount || !ctx.session.category) {
      ctx.session = {};
      return ctx.reply("🔄 Xarajatni saqlash uchun boshidan boshlang.", mainKeyboard());
    }

    const date = formatDate();
    const expense = await prisma.expense.create({
      data: {
        telegramId,
        amount: ctx.session.amount,
        category: ctx.session.category,
        description: text.slice(0, 300),
        date,
      },
    });

    ctx.session = {};

    await sendCategorySticker(ctx, expense.category);

    const notice = await getLimitNotice(telegramId);

    return ctx.reply(
      `✅ Xarajat saqlandi!\n\n📅 Sana: ${date}\n🏷️ Kategoriya: ${expense.category}\n💸 Summa: ${money(expense.amount)} so'm\n📝 Izoh: ${expense.description}${notice}`,
      mainKeyboard(),
    );
  }

  if (ctx.session.step === "date") {
    const date = normalizeDateInput(text);

    if (!date) {
      return ctx.reply("❌ Sana noto'g'ri. Masalan: 17/05/2026");
    }

    const expenses = await prisma.expense.findMany({
      where: { telegramId, date },
      orderBy: { createdAt: "desc" },
    });

    ctx.session = {};

    if (!expenses.length) {
      return ctx.reply("📭 Bu sana uchun ma'lumot topilmadi.", mainKeyboard());
    }

    return ctx.reply(renderExpenses(`🗓️ ${date} kuni xarajatlaringiz`, expenses), mainKeyboard());
  }

  if (ctx.session.step === "deleteDate" || ctx.session.step === "editDate") {
    const date = normalizeDateInput(text);

    if (!date) {
      return ctx.reply("❌ Sana noto'g'ri. Masalan: 17/05/2026");
    }

    const expenses = await prisma.expense.findMany({
      where: { telegramId, date },
      orderBy: { createdAt: "desc" },
    });

    if (!expenses.length) {
      ctx.session = {};
      return ctx.reply("📭 Bu sana uchun ma'lumot topilmadi.", mainKeyboard());
    }

    const action = ctx.session.step === "deleteDate" ? "delete" : "edit";
    ctx.session = {};

    return ctx.reply(
      renderExpensesWithIds(
        action === "delete" ? "🗑️ O'chirish uchun xarajatni tanlang" : "✏️ Tahrirlash uchun xarajatni tanlang",
        expenses,
      ),
      expenseActionKeyboard(expenses, action),
    );
  }

  if (ctx.session.step === "editAmount") {
    const amount = parseAmount(text);

    if (!amount || !ctx.session.editingExpenseId) {
      return ctx.reply("❌ To'g'ri summa kiriting. Masalan: 12500");
    }

    ctx.session.editAmount = amount;
    ctx.session.step = "editDescription";

    return ctx.reply("📝 Yangi izohni kiriting:");
  }

  if (ctx.session.step === "editDescription") {
    if (!ctx.session.editingExpenseId || !ctx.session.editAmount) {
      ctx.session = {};
      return ctx.reply("🔄 Tahrirlashni qaytadan boshlang.", mainKeyboard());
    }

    const result = await prisma.expense.updateMany({
      where: {
        id: ctx.session.editingExpenseId,
        telegramId,
      },
      data: {
        amount: ctx.session.editAmount,
        description: text.slice(0, 300),
      },
    });

    ctx.session = {};

    if (!result.count) {
      return ctx.reply("🤔 Xarajat topilmadi yoki sizga tegishli emas.", mainKeyboard());
    }

    return ctx.reply("✅ Xarajat yangilandi.", mainKeyboard());
  }

  if (ctx.session.step === "dailyLimit") {
    const amount = parseAmount(text);

    if (!amount) {
      return ctx.reply("❌ To'g'ri limit kiriting. Masalan: 100000");
    }

    await setDailyLimit(telegramId, amount);
    ctx.session = {};

    return ctx.reply(`🎯 Kunlik limit saqlandi: ${money(amount)} so'm`, mainKeyboard());
  }

  return next();
});

bot.catch((error, ctx) => {
  console.error("Bot error:", error);
  ctx.reply("😕 Xatolik yuz berdi. /menu ni bosib qayta urinib ko'ring.").catch(console.error);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

async function main() {
  await ensureDatabase();
  await setupBotProfile();
  await bot.launch();
  console.log("Bot ishga tushdi");
}

main().catch(async (error) => {
  console.error("Startup error:", error);
  await prisma.$disconnect();
  process.exit(1);
});
