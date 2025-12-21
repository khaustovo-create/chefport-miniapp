'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const https = require('https');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const {
  BOT_TOKEN,
  WEBAPP_URL,
  TELEGRAM_ADMIN_CHAT_ID,
  MOYSKLAD_TOKEN,
  FRONT_DIR,
} = process.env;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');
if (!WEBAPP_URL) throw new Error('WEBAPP_URL is required');
if (!MOYSKLAD_TOKEN) throw new Error('MOYSKLAD_TOKEN is required');

const { getFrontendProductsWithStock, createCustomerOrder } = require('./moysklad');

// -------------------- EXPRESS (MiniApp + API) --------------------
const app = express();
app.use(express.json({ limit: '2mb' }));

// ---- FRONT: auto-detect public/ ----
const candidates = [
  FRONT_DIR ? path.resolve(FRONT_DIR) : null,
  path.join(__dirname, 'public'),
  path.join(__dirname, 'webapp'),
].filter(Boolean);

let FRONT = null;
let INDEX = null;

for (const dir of candidates) {
  const idx = path.join(dir, 'index.html');
  if (fs.existsSync(dir) && fs.existsSync(idx)) {
    FRONT = dir;
    INDEX = idx;
    break;
  }
}

if (!FRONT) {
  console.log('❌ Frontend НЕ найден. Ожидаю index.html в public/ или webapp/');
} else {
  console.log('✅ Frontend найден:');
  console.log('   FRONT_DIR =', FRONT);
  console.log('   INDEX     =', INDEX);

  app.use(express.static(FRONT));
  app.get('/', (req, res) => res.sendFile(INDEX));
}

// healthcheck
app.get('/healthz', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// API: products
app.get('/api/products', async (req, res) => {
  try {
    const data = await getFrontendProductsWithStock();
    res.json({
      ok: true,
      products: data.products || [],
      categories: data.categories || [],
      updatedAt: data.updatedAt,
    });
  } catch (e) {
    const status = e?.response?.status;
    const msBody = e?.response?.data;
    console.error('GET /api/products error:', status || '', e.message, msBody || '');
    res.status(500).json({
      ok: false,
      error: status ? `МойСклад ${status}: ${JSON.stringify(msBody)}` : e.message,
    });
  }
});

// API: order
app.post('/api/order', async (req, res) => {
  try {
    const body = req.body || {};
    const { items, customer, comment } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'Empty items' });
    }

    const order = await createCustomerOrder({ items, customer, comment });

    // уведомление админу
    if (TELEGRAM_ADMIN_CHAT_ID) {
      const lines = [];
      lines.push('🧾 Новый заказ (MiniApp)');
      if (customer?.name) lines.push(`👤 ${customer.name}`);
      if (customer?.phone) lines.push(`📞 ${customer.phone}`);
      if (customer?.address) lines.push(`📍 ${customer.address}`);
      if (comment) lines.push(`💬 ${comment}`);
      lines.push('');
      lines.push('🛒 Состав:');
      for (const it of items) {
        const qty = Number(it.qty || 0);
        const price = Number(it.price || 0);
        lines.push(`• ${it.name} — ${qty} × ${price} = ${qty * price}`);
      }
      lines.push('');
      lines.push(`✅ МойСклад: ${order?.name || order?.id || 'OK'}`);

      // бот объявим ниже, но сюда дойдём после его создания — ок
      try { bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID, lines.join('\n')); } catch (_) {}
    }

    res.json({ ok: true, order });
  } catch (e) {
    const status = e?.response?.status;
    const msBody = e?.response?.data;
    console.error('POST /api/order error:', status || '', e.message, msBody || '');
    res.status(500).json({
      ok: false,
      error: status ? `МойСклад ${status}: ${JSON.stringify(msBody)}` : e.message,
    });
  }
});

// API: image proxy (можно оставить, но если не нужно — не критично)
const IMG_TIMEOUT_MS = 60000;
const IMG_MAX_BYTES = 8 * 1024 * 1024;

const imgAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

app.get('/api/image', async (req, res) => {
  try {
    const src = String(req.query.src || '');
    if (!src.startsWith('https://api.moysklad.ru/')) return res.status(400).send('bad src');

    const r = await axios.get(src, {
      headers: { Authorization: `Bearer ${MOYSKLAD_TOKEN}` },
      responseType: 'arraybuffer',
      timeout: IMG_TIMEOUT_MS,
      maxContentLength: IMG_MAX_BYTES,
      maxBodyLength: IMG_MAX_BYTES,
      httpsAgent: imgAgent,
    });

    res.setHeader('Content-Type', r.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(Buffer.from(r.data));
  } catch (e) {
    console.error('image error:', e.message);
    return res.status(504).send('image timeout');
  }
});

// ---- start server (ВАЖНО: host 0.0.0.0) ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ HTTP сервер запущен');
  console.log(`   Local: http://localhost:${PORT}`);
  console.log(`   WEBAPP_URL: ${WEBAPP_URL}`);
});

// -------------------- TELEGRAM BOT (WebApp button) --------------------
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function mainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🛒 Открыть магазин', web_app: { url: WEBAPP_URL } }],
        [{ text: '📦 Каталог' }, { text: '🛒 Корзина' }],
        [{ text: '✅ Оформить' }, { text: '🧹 Очистить корзину' }],
      ],
      resize_keyboard: true,
    }
  };
}

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  await bot.sendMessage(
    chatId,
    'ШефПорт 👇\nНажми кнопку, откроется мини-апп с каталогом и корзиной.',
    mainKeyboard()
  );

  // Дублируем inline-кнопкой (иногда удобнее)
  await bot.sendMessage(chatId, 'Или так:', {
    reply_markup: {
      inline_keyboard: [[{ text: '🛒 Открыть магазин (Mini App)', web_app: { url: WEBAPP_URL } }]],
    },
  });
});

bot.on('polling_error', (e) => {
  console.error('polling_error:', e.message);
});

console.log('✅ Telegram bot started (webapp button)');