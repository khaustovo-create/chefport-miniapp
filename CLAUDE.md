# CLAUDE.md — правила работы с проектом

## Суть проекта

ШефПорт — Telegram Mini App для рыбного магазина. Один Node.js-процесс (`bot.js`) совмещает Telegram-бота и Express-сервер. Каталог и заказы синхронизируются с МойСклад через REST API. Аналитика хранится локально в SQLite.

---

## Архитектура: файл за файлом

| Файл | Роль |
|---|---|
| `bot.js` | Точка входа. Express-сервер + Telegram bot (polling). Все API-роуты. |
| `moysklad.js` | Интеграция с МойСклад: каталог, остатки, создание заказов, контрагенты. |
| `db.js` | SQLite-слой. Две таблицы: `visits`, `orders`. Только запись и чтение статистики. |
| `public/index.html` | HTML-оболочка SPA. Подключает Telegram WebApp SDK и `app.js`. |
| `public/app.js` | Весь фронтенд: состояние, каталог, корзина, форма заказа, запросы к API. |
| `cache/images/` | Физический кэш `.webp`-изображений товаров. Не трогать руками. |

---

## Связи компонентов

```
bot.js
 ├── require('./moysklad')
 │    ├── getFrontendProductsWithStock()  ← GET /api/products
 │    └── createCustomerOrder()          ← POST /api/order
 │
 ├── require('./db')
 │    ├── logVisit()                     ← POST /api/visit
 │    ├── logOrder()                     ← POST /api/order
 │    ├── getStats()                     ← /stats (bot command)
 │    ├── getTopProducts()               ← /stats (bot command)
 │    └── getOrdersByPhone()             ← /buyer (bot command)
 │
 └── express.static('./public')          ← GET /

public/app.js  (браузер)
 ├── fetch('/api/products')  →  bot.js → moysklad.js → МойСклад API
 ├── fetch('/api/visit')     →  bot.js → db.js → stats.db
 └── fetch('/api/order')     →  bot.js → moysklad.js → МойСклад API
                                       → db.js → stats.db
                                       → bot.sendMessage() → Telegram (админ)
```

---

## Правила работы

**Нельзя без теста:**
- Менять логику `buildShowcase()` в `moysklad.js` — она собирает каталог из трёх отдельных запросов к МойСклад.
- Менять `extractAssortmentMetaFromRow()` — от неё зависит корректность `assortmentHref` в заказе.
- Менять структуру таблиц в `db.js` — нет миграций, изменение сломает существующий `stats.db`.

**Хрупкие места:**
- `bot.sendMessage()` в обработчике `/api/order` вызывается до объявления переменной `bot` в файле — работает только потому, что `bot` объявлен в той же области видимости ниже по коду (JavaScript hoisting не применим к `const`, но вызов происходит асинхронно, к тому времени `bot` уже инициализирован).
- `FRONT_DIR` — опциональная переменная окружения для кастомного пути к фронтенду. Если задана, используется вместо `public/`.

**Не трогать:**
- `cache/images/` — управляется автоматически.
- `stats.db`, `stats.db-shm`, `stats.db-wal` — рабочая база, в git не входит.

---

## Особенности МойСклад API

- **Изображения в list-запросах**: `expand=images` возвращает только `images.meta` (с `size`), но не `rows` с `downloadHref`. Поэтому `moysklad.js` делает отдельный запрос `GET /entity/{type}/{id}/images` для каждого товара с изображением.
- **Конкурентность изображений**: батчи по 5 запросов с задержкой 200 мс между батчами (`IMG_CONCURRENCY = 5`, `IMG_BATCH_DELAY_MS = 200`) — иначе МойСклад возвращает 429.
- **Пагинация остатков**: `GET /report/stock/all` возвращает максимум 1000 строк. `getStockForWarehouseFast()` итерирует по offset до конца.
- **Цены**: МойСклад хранит цены в копейках. Конвертация: `rubFromKopeks(v) = Math.round(v) / 100`. При создании заказа — обратно: `priceKopeks = Math.round(priceRub * 100)`.
- **Контрагент**: при создании заказа сначала ищем контрагента по телефону (`ensureCounterparty`), если не найден — создаём нового.
- **Кэш каталога**: in-memory, TTL 60 секунд (`CACHE_TTL_MS = 60 * 1000`). При рестарте сбрасывается.

---

## Особенности Telegram Bot

- **Режим**: polling (не webhook). Не нужен публичный URL для бота, только для Mini App (`WEBAPP_URL`).
- **Admin guard**: команды `/stats` и `/buyer` проверяют `String(msg.chat.id) === String(TELEGRAM_ADMIN_CHAT_ID)`. Без `TELEGRAM_ADMIN_CHAT_ID` в `.env` команды молча игнорируются.
- **Уведомление о заказе**: `bot.sendMessage()` вызывается fire-and-forget внутри `try/catch` — ошибка отправки не роняет API-ответ клиенту.
- **Mini App кнопка**: передаётся через `web_app: { url: WEBAPP_URL }` — как reply keyboard, так и inline keyboard.

---

## SQLite

**WAL-режим** включён (`PRAGMA journal_mode = WAL`) — безопасно для конкурентных записей.

**Таблица `visits`:**
| Поле | Тип | Описание |
|---|---|---|
| `id` | INTEGER PK | Автоинкремент |
| `user_id` | TEXT | Telegram user ID (может быть null) |
| `username` | TEXT | @username |
| `first_name` | TEXT | Имя пользователя |
| `opened_at` | TEXT | UTC timestamp |

**Таблица `orders`:**
| Поле | Тип | Описание |
|---|---|---|
| `id` | INTEGER PK | Автоинкремент |
| `ms_order_name` | TEXT | Номер заказа в МойСклад |
| `user_id` | TEXT | Telegram user ID |
| `customer_name` | TEXT | Имя покупателя из формы |
| `customer_phone` | TEXT | Телефон (индекс для `/buyer`) |
| `total_sum` | REAL | Сумма заказа в рублях |
| `items_json` | TEXT | JSON-массив позиций заказа |
| `created_at` | TEXT | UTC timestamp |

---

## Обязательные переменные окружения

Без этих переменных процесс упадёт при старте:

| Переменная | Где используется |
|---|---|
| `BOT_TOKEN` | `bot.js` — создание Telegram bot |
| `WEBAPP_URL` | `bot.js` — URL кнопки Mini App |
| `MOYSKLAD_TOKEN` | `moysklad.js` — Bearer-авторизация |
| `MOYSKLAD_WAREHOUSE_ID` | `moysklad.js` — фильтр остатков и создание заказа |
| `MOYSKLAD_ORGANIZATION_ID` | `moysklad.js` — создание заказа |

---

## Визуальный спек — ASCII-схемы

**Где добавлять схемы в документации:**
- Архитектура системы (сервисы, связи, направления данных)
- Структура проекта (дерево папок)
- User flow (путь пользователя через функцию)
- Связи компонентов (импорты, вызовы между модулями)

Правило: если структуру или поток проще нарисовать, чем объяснить текстом — рисовать.

**Перед новым функционалом:**

1. Сначала нарисовать ASCII-схему: все шаги, ветвления, куда сохраняются данные.
2. Показать схему и ждать подтверждения.
3. Только после подтверждения — писать код.

Код без согласованной схемы не писать.

---

## Поведение продукта

Поведение продукта описано в [PRODUCT_SCENARIOS.md](PRODUCT_SCENARIOS.md) — сверяйся с ним перед изменением кода и при добавлении новых фич.
