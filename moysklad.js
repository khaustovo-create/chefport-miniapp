'use strict';

const axios = require('axios');
const https = require('https');

const {
  MOYSKLAD_BASE_URL = 'https://api.moysklad.ru/api/remap/1.2',
  MOYSKLAD_TOKEN,
  MOYSKLAD_WAREHOUSE_ID,      // store id
  MOYSKLAD_ORGANIZATION_ID,
} = process.env;

if (!MOYSKLAD_TOKEN) throw new Error('MOYSKLAD_TOKEN is required');
if (!MOYSKLAD_WAREHOUSE_ID) throw new Error('MOYSKLAD_WAREHOUSE_ID is required');
if (!MOYSKLAD_ORGANIZATION_ID) throw new Error('MOYSKLAD_ORGANIZATION_ID is required');

const agent = new https.Agent({ keepAlive: true, maxSockets: 50 });

const http = axios.create({
  baseURL: MOYSKLAD_BASE_URL,
  timeout: 60000,
  httpsAgent: agent,
  headers: {
    Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
    // МойСклад капризный:
    Accept: 'application/json;charset=utf-8',
    'Content-Type': 'application/json;charset=utf-8',
  },
});

function rubFromKopeks(v) {
  const n = Number(v || 0);
  return Math.round(n) / 100;
}

function safeString(x) {
  return (x == null) ? '' : String(x);
}

function normalizeCategoryName(folderName) {
  const s = safeString(folderName);
  if (!s) return 'Без категории';
  const parts = s.split('/').map(p => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s.trim();
}

function buildImageProxyUrl(downloadHref, w = 420) {
  if (!downloadHref) return null;
  const enc = encodeURIComponent(downloadHref);
  return `/api/image?src=${enc}&w=${w}&v=3`;
}

function extractIdFromHrefOrUuid(meta) {
  const u = safeString(meta?.uuidHref);
  if (u) {
    const m = u.match(/[0-9a-fA-F-]{36}/);
    if (m) return m[0];
  }
  const href = safeString(meta?.href);
  if (href) {
    const m = href.match(/[0-9a-fA-F-]{36}/);
    if (m) return m[0];
  }
  return null;
}

function extractAssortmentMetaFromRow(row) {
  const meta = row?.meta || null;
  const type = safeString(meta?.type).trim(); // product / variant / bundle / service ...
  const id = extractIdFromHrefOrUuid(meta);
  const href = safeString(meta?.href);

  if (!type || !id || !href) return null;
  return { type, id, href };
}

async function getStockForWarehouseFast() {
  const rows = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const r = await http.get('/report/stock/all', {
      params: {
        store: MOYSKLAD_WAREHOUSE_ID,
        limit,
        offset,
      }
    });

    const chunk = Array.isArray(r.data?.rows) ? r.data.rows : [];
    rows.push(...chunk);

    if (chunk.length < limit) break;
    offset += limit;
  }

  return rows;
}

async function fetchEntitiesByType(type, ids) {
  const uniq = Array.from(new Set(ids)).filter(Boolean);
  if (!uniq.length) return new Map();

  // Поддержим только то, что реально встречается у тебя массово
  if (!['product', 'variant'].includes(type)) {
    return new Map(); // неизвестные типы просто останутся без картинки, но заказ всё равно соберётся по href/type
  }

  const out = new Map();
  const batchSize = 80;

  for (let i = 0; i < uniq.length; i += batchSize) {
    const part = uniq.slice(i, i + batchSize);
    const filter = part.map(id => `id=${id}`).join(';');

    const r = await http.get(`/entity/${type}`, {
      params: {
        filter,
        // images — чтобы получить downloadHref
        expand: 'images,productFolder,uom',
        limit: 1000,
      }
    });

    const rows = Array.isArray(r.data?.rows) ? r.data.rows : [];
    for (const e of rows) out.set(e.id, e);
  }

  return out;
}

function pickDownloadHrefFromEntity(entity) {
  const imgs = entity?.images?.rows || entity?.images || [];
  const first = Array.isArray(imgs) ? imgs[0] : null;

  const dh = first?.meta?.downloadHref;
  if (dh) return dh;

  // иногда downloadHref нет, но бывает href на download уже готовый (редко)
  const href = first?.meta?.href;
  if (href && href.includes('/download/')) return href;

  return null;
}

function pickFolderName(row, entity) {
  // report/stock/all: folder.name может быть
  const fromRow = row?.folder?.name || row?.folder || '';
  const a = normalizeCategoryName(fromRow);

  if (a && a !== 'Без категории') return a;

  // entity: productFolder.name
  const fromEntity = entity?.productFolder?.name || entity?.folder?.name || '';
  const b = normalizeCategoryName(fromEntity);

  return b || 'Без категории';
}

function pickUomName(row, entity) {
  const u1 = safeString(row?.uom?.name || row?.uomName || '').trim();
  if (u1) return u1;
  const u2 = safeString(entity?.uom?.name || '').trim();
  if (u2) return u2;
  return 'шт';
}

// ----------- cache -----------
let cache = { ts: 0, data: null };
const CACHE_TTL_MS = 60 * 1000;

async function buildShowcase() {
  console.log('getProductsWithPrices: строим витрину по report/stock/all...');

  let stockRows;
  try {
    stockRows = await getStockForWarehouseFast();
  } catch (e) {
    const ms = e?.response?.data ? JSON.stringify(e.response.data) : e.message;
    throw new Error(`МойСклад: ${ms}`);
  }

  console.log(`getStockForWarehouse: всего строк остатков: ${stockRows.length}`);

  const inStock = stockRows.filter(r => Number(r?.stock || 0) > 0);

  // соберём ids по типам
  const idsByType = new Map(); // type -> [ids]
  const metas = []; // {type,id,href,row}
  for (const row of inStock) {
    const m = extractAssortmentMetaFromRow(row);
    if (!m) continue;
    metas.push({ ...m, row });

    if (!idsByType.has(m.type)) idsByType.set(m.type, []);
    idsByType.get(m.type).push(m.id);
  }

  // добираем детали (для картинок/категории/uom)
  const entitiesByType = new Map(); // type -> Map(id -> entity)
  for (const [type, ids] of idsByType.entries()) {
    const map = await fetchEntitiesByType(type, ids);
    entitiesByType.set(type, map);
  }

  const products = [];
  const catSet = new Set();

  for (const x of metas) {
    const { type, id, href, row } = x;

    const entityMap = entitiesByType.get(type);
    const entity = entityMap ? entityMap.get(id) : null;

    const name = safeString(entity?.name || row?.name || '').trim();
    if (!name) continue;

    // price
    let priceRub = 0;
    if (row?.salePrice != null) priceRub = rubFromKopeks(row.salePrice);
    else if (row?.price != null) priceRub = rubFromKopeks(row.price);

    const category = pickFolderName(row, entity);
    const uomName = pickUomName(row, entity);

    // image
    const downloadHref = entity ? pickDownloadHrefFromEntity(entity) : null;
    const imageUrl = downloadHref ? buildImageProxyUrl(downloadHref, 420) : null;

    catSet.add(category);

    // ВАЖНО: id для фронта = id сущности ассортимента (product/variant), а не “какой-то другой”
    products.push({
      id,
      name,
      price: priceRub,
      category,
      image: imageUrl,
      uomName,
      assortmentHref: href,
      assortmentType: type,
    });
  }

  products.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category, 'ru');
    return a.name.localeCompare(b.name, 'ru');
  });

  const categories = Array.from(catSet).sort((a, b) => a.localeCompare(b, 'ru'));
  return { products, categories };
}

async function getFrontendProductsWithStock() {
  const now = Date.now();
  if (cache.data && (now - cache.ts) < CACHE_TTL_MS) {
    console.log(`getFrontendProductsWithStock: cache hit: ${cache.data.products.length}`);
    return cache.data;
  }

  console.log('getFrontendProductsWithStock: запрашиваем товары из МойСклад...');
  const data = await buildShowcase();

  cache = {
    ts: now,
    data: { ...data, updatedAt: new Date(now).toISOString() },
  };

  console.log(`getFrontendProductsWithStock: товаров отдано фронту: ${data.products.length}`);
  return cache.data;
}

// ----------- заказ: CustomerOrder -----------
async function createCustomerOrder({ items, customer, comment }) {
  const positions = (items || []).map((it) => {
    const qty = Number(it.qty || 0);
    if (!isFinite(qty) || qty <= 0) return null;

    const priceRub = Number(it.price || 0);
    const priceKopeks = Math.round(priceRub * 100);

    const href =
     (it.assortmentHref && String(it.assortmentHref).trim()) ||
     `${MOYSKLAD_BASE_URL}/entity/product/${it.id}`;

    const type =
     (it.assortmentType && String(it.assortmentType).trim()) ||
     'product';

    return {
      quantity: qty,          // может быть 0.1, 0.2 и т.д.
      price: priceKopeks,
      discount: 0,
      vat: 0,
      assortment: {
        meta: {
          href,
          type,
          mediaType: 'application/json',
        },
      },
    };
  }).filter(Boolean);

  if (!positions.length) throw new Error('Empty positions');

  const name = `Заказ MiniApp ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;

  const body = {
    name,
    organization: {
      meta: {
        href: `${MOYSKLAD_BASE_URL}/entity/organization/${MOYSKLAD_ORGANIZATION_ID}`,
        type: 'organization',
        mediaType: 'application/json',
      },
    },
    store: {
      meta: {
        href: `${MOYSKLAD_BASE_URL}/entity/store/${MOYSKLAD_WAREHOUSE_ID}`,
        type: 'store',
        mediaType: 'application/json',
      },
    },
    agent: { meta: await ensureCounterparty(customer) },
    positions,
    description: [
      customer?.name ? `Имя: ${customer.name}` : null,
      customer?.phone ? `Телефон: ${customer.phone}` : null,
      customer?.address ? `Адрес: ${customer.address}` : null,
      comment ? `Комментарий: ${comment}` : null,
    ].filter(Boolean).join('\n'),
  };

  const r = await http.post('/entity/customerorder', body);
  return r.data;
}

async function ensureCounterparty(customer) {
  const name = safeString(customer?.name || '').trim() || 'Покупатель MiniApp';
  const phone = safeString(customer?.phone || '').trim();

  if (phone) {
    const rr = await http.get('/entity/counterparty', {
      params: { filter: `phone=${phone}`, limit: 1 }
    });
    const found = Array.isArray(rr.data?.rows) ? rr.data.rows[0] : null;
    if (found?.id) {
      return {
        href: `${MOYSKLAD_BASE_URL}/entity/counterparty/${found.id}`,
        type: 'counterparty',
        mediaType: 'application/json',
      };
    }
  }

  const cr = await http.post('/entity/counterparty', {
    name,
    phone: phone || undefined,
    description: 'Создано из Telegram MiniApp',
  });

  return {
    href: `${MOYSKLAD_BASE_URL}/entity/counterparty/${cr.data.id}`,
    type: 'counterparty',
    mediaType: 'application/json',
  };
}

module.exports = {
  getFrontendProductsWithStock,
  createCustomerOrder,
};