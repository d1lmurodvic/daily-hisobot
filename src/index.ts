import { Telegraf, Markup, session, Context } from "telegraf";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN || "");
const prisma = new PrismaClient();

interface SessionData {
  amount?: number;
  category?: string;
  waitingCustomAmount?: boolean;
  waitingDescription?: boolean;
  waitingDate?: boolean;
  waitingMonth?: boolean;
}

interface BotContext extends Context {
  session: SessionData;
  match: RegExpExecArray;
}

bot.use(session({ defaultSession: (): SessionData => ({}) }));

const amounts = [5000, 10000, 20000, 50000, 100000, 200000];
const months = [
  "Yanvar","Fevral","Mart","Aprel","May","Iyun",
  "Iyul","Avgust","Sentabr","Oktabr","Noyabr","Dekabr"
];

function formatDate(date = new Date()) {
  return date.toLocaleDateString("en-GB");
}

function getMonthName(date: string) {
  const monthIndex = Number(date.split('/')[1]) - 1;
  return months[monthIndex] || "Noma'lum";
}

bot.start(async (ctx: BotContext) => {
  ctx.session = {};

  await ctx.reply(
    "💰 Kunlik Sarf Botiga xush kelibsiz!",
    Markup.keyboard([
      ["➕ Ishlatilgan pul qo'shish"],
      ["📋 Ishlatilgan pulni ko'rish"],
      ["📊 Oylik Hisobot"]
    ]).resize()
  );
});

bot.hears("➕ Ishlatilgan pul qo'shish", async (ctx: BotContext) => {
  const rows: any[] = [];

  for (let i = 0; i < amounts.length; i += 2) {
    rows.push([
      Markup.button.callback(`💸 ${amounts[i].toLocaleString()} so'm`, `amount_${amounts[i]}`),
      Markup.button.callback(`💸 ${amounts[i + 1].toLocaleString()} so'm`, `amount_${amounts[i + 1]}`)
    ]);
  }

  rows.push([Markup.button.callback("✍️ Boshqa summa", "custom_amount")]);

  await ctx.reply(
    `📅 Sana: ${formatDate()}\n\nIshlatilgan summani tanlang:`,
    Markup.inlineKeyboard(rows)
  );
});

bot.action(/amount_(.+)/, async (ctx: BotContext) => {
  ctx.session.amount = Number(ctx.match[1]);

  await ctx.reply("📝 Nimaga ishlatdingiz?");
  ctx.session.waitingDescription = true;
});

bot.action("custom_amount", async (ctx: BotContext) => {
  ctx.session.waitingCustomAmount = true;
  await ctx.reply("✍️ Aniq summani kiriting:");
});

bot.on("text", async (ctx: BotContext, next) => {
  if (!ctx.session) ctx.session = {};

  if (ctx.session.waitingCustomAmount) {
    const amount = Number(ctx.message.text.replace(/\s/g, ""));

    if (isNaN(amount)) {
      return ctx.reply("❌ To'g'ri summa kiriting.");
    }

    ctx.session.amount = amount;
    ctx.session.waitingCustomAmount = false;
    ctx.session.waitingDescription = true;

    return ctx.reply("📝 Nimaga ishlatdingiz?");
  }

  if (ctx.session.waitingDescription) {
    await prisma.expense.create({
      data: {
        telegramId: String(ctx.from?.id),
        amount: ctx.session.amount || 0,
        category: "General",
        description: ctx.message.text,
        date: formatDate()
      }
    });

    const amount = ctx.session.amount?.toLocaleString();
    const date = formatDate();

    ctx.session = {};

    return ctx.reply(
      `✅ Xarajat saqlandi!\n\n📅 Sana: ${date}\n💸 Summa: ${amount} so'm\n📝 Izoh: ${ctx.message.text}`
    );
  }

  if (ctx.session.waitingDate) {
    const expenses = await prisma.expense.findMany({
      where: {
        telegramId: String(ctx.from?.id),
        date: ctx.message.text
      }
    });

    ctx.session.waitingDate = false;

    if (!expenses.length) {
      return ctx.reply("❌ Bu sana uchun ma'lumot topilmadi.");
    }

    let total = 0;

    const list = expenses.map((e) => {
      total += e.amount;
      return `💸 ${e.amount.toLocaleString()} so'm -> ${e.description}`;
    }).join("\n");

    return ctx.reply(
      `📅 ${ctx.message.text} kuni xarajatlaringiz:\n\n${list}\n\n💹 Umumiy: ${total.toLocaleString()} so'm`
    );
  }

  if (ctx.session.waitingMonth) {
    const selectedMonth = ctx.message.text;

    const expenses = await prisma.expense.findMany({
      where: {
        telegramId: String(ctx.from?.id)
      }
    });

    const filtered = expenses.filter((e) => getMonthName(e.date) === selectedMonth);

    ctx.session.waitingMonth = false;

    if (!filtered.length) {
      return ctx.reply("❌ Bu oy uchun ma'lumot topilmadi.");
    }

    let total = 0;

    const result = filtered.map((e) => {
      total += e.amount;
      return `💸 ${e.amount.toLocaleString()} so'm -> ${e.description}`;
    }).join("\n");

    return ctx.reply(
      `📊 ${selectedMonth} hisoboti:\n\n${result}\n\n💰 Umumiy: ${total.toLocaleString()} so'm`
    );
  }

  return next();
});

bot.hears("📋 Ishlatilgan pulni ko'rish", async (ctx: BotContext) => {
  await ctx.reply(
    "📂 Kerakli bo'limni tanlang:",
    Markup.inlineKeyboard([
      [Markup.button.callback("📅 Bugungi sarf", "today")],
      [Markup.button.callback("🗓 Boshqa kun", "other")]
    ])
  );
});

bot.action("today", async (ctx: BotContext) => {
  const today = formatDate();

  const expenses = await prisma.expense.findMany({
    where: {
      telegramId: String(ctx.from?.id),
      date: today
    }
  });

  if (!expenses.length) {
    return ctx.reply("❌ Bugun hali xarajat qo'shilmagan.");
  }

  let total = 0;

  const list = expenses.map((e) => {
    total += e.amount;
    return `💸 ${e.amount.toLocaleString()} so'm -> ${e.description}`;
  }).join("\n");

  await ctx.reply(
    `📅 Bugungi xarajatlar:\n\n${list}\n\n💰 Umumiy: ${total.toLocaleString()} so'm`
  );
});

bot.action("other", async (ctx: BotContext) => {
  ctx.session.waitingDate = true;
  await ctx.reply("📅 Sanani kiriting: 17/05/2026");
});

bot.hears("📊 Oylik Hisobot", async (ctx: BotContext) => {
  ctx.session.waitingMonth = true;

  await ctx.reply(
    "📆 Oyni tanlang:",
    Markup.keyboard([
      ["Yanvar", "Fevral", "Mart"],
      ["Aprel", "May", "Iyun"],
      ["Iyul", "Avgust", "Sentabr"],
      ["Oktabr", "Noyabr", "Dekabr"]
    ]).resize()
  );
});

bot.launch();

console.log("✅ Bot ishga tushdi");
