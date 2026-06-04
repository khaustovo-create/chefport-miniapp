# ШефПорт — Telegram Mini App

Магазин рыбы и морепродуктов внутри Telegram. Каталог товаров подтягивается из МойСклад, заказы уходят туда же.

---

## Архитектура

```
Telegram (пользователь)
        │
        │  /start → кнопка открыть магазин
        ▼
┌─────────────────────────────────────────┐
│               bot.js                    │
│                                         │
│  Telegram Bot (polling)                 │
│  Express 5 HTTP-сервер                  │
│                                         │
│  GET  /api/products  ──► moysklad.js ──►  МойСклад API
│  POST /api/order     ──► moysklad.js ──►  МойСклад API
│  GET  /api/image     ──► proxy         ──►  МойСклад CDN
│  POST /api/visit     ──► db.js         ──►  stats.db (SQLite)
│  GET  /              ──► public/             
└─────────────────────────────────────────┘
        │
        │  уведомление о заказе
        ▼
Telegram (админ)
```

Бот и веб-сервер — **один процесс**, запускается командой `node bot.js`.

---

## Стек

| Слой | Технология |
|---|---|
| Среда | Node.js (CommonJS) |
| HTTP | Express 5 |
| Telegram | node-telegram-bot-api (polling) |
| БД | better-sqlite3 (SQLite, WAL) |
| МойСклад | REST API v1.2 через axios |
| Изображения | sharp + in-memory proxy |
| Фронтенд | Vanilla HTML/CSS/JS |

---

## Структура проекта

```
chefport-miniapp/
├── bot.js              # Точка входа: Express + Telegram bot
├── moysklad.js         # Интеграция с МойСклад (каталог, заказы)
├── db.js               # SQLite: логирование визитов и заказов
├── public/
│   ├── index.html      # SPA — интерфейс Mini App
│   └── app.js          # Фронтенд: каталог, корзина, оформление заказа
├── cache/
│   └── images/         # Кэш изображений товаров (.webp)
├── .env                # Переменные окружения (не в git)
├── .gitignore
└── package.json
```

---

## Переменные окружения

Создать файл `.env` в корне проекта:

```env
BOT_TOKEN=                   # Токен Telegram-бота (@BotFather)
WEBAPP_URL=                  # Публичный URL Mini App (https://...)
MOYSKLAD_TOKEN=              # Bearer-токен МойСклад
MOYSKLAD_WAREHOUSE_ID=       # UUID склада
MOYSKLAD_ORGANIZATION_ID=    # UUID организации
TELEGRAM_ADMIN_CHAT_ID=      # chat_id для уведомлений о заказах (опционально)
PORT=3000                    # Порт сервера (опционально, по умолчанию 3000)
```

---

## Запуск

```bash
# 1. Установить зависимости
npm install

# 2. Создать и заполнить .env (см. выше)

# 3. Запустить
node bot.js
```

Сервер поднимется на `http://localhost:3000`. Mini App будет доступен по `WEBAPP_URL`.

---

## Команды бота

| Команда | Кто | Описание |
|---|---|---|
| `/start` | все | Открывает кнопку с Mini App |
| `/stats` | админ | Статистика визитов и заказов за сегодня / неделю / месяц |
| `/buyer <телефон>` | админ | История заказов по номеру телефона |

---

## API

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/healthz` | Health check |
| `GET` | `/api/products` | Каталог товаров с остатками (кэш 60 с) |
| `POST` | `/api/order` | Создать заказ в МойСклад |
| `POST` | `/api/visit` | Зафиксировать визит пользователя |
| `GET` | `/api/image?src=` | Прокси изображений из МойСклад |
