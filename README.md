# Kunlik Sarf Telegram Bot

Professional Telegram expense tracker bot built with:
- Node.js
- TypeScript
- Telegraf
- Prisma
- SQLite

## Features

- Add daily expenses
- Quick amount buttons
- Custom amount support
- Daily expense reports
- Specific date reports
- Monthly statistics
- Category support

## Run locally

```bash
npm install
npm run build
```

Create a local `.env` file:

```env
BOT_TOKEN=your_new_botfather_token_here
DATABASE_URL="file:./dev.db"
```

Then run:

```bash
npm start
```

For development with auto-restart:

```bash
npm run dev
```

## Railway Deploy

1. Upload project to GitHub
2. Connect repo to Railway
3. Add environment variables:
   - BOT_TOKEN
   - DATABASE_URL
4. Deploy
