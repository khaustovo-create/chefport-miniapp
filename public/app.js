'use strict';

// ---- state ----
let state = {
  loading: true,
  error: null,
  products: [],
  categories: [],
  selectedCategory: 'Все',
  updatedAt: null,
};

const cart = new Map(); // id -> {id,name,price,qty,uomName,assortmentHref,assortmentType}

// ---- DOM ----
const $sub = document.getElementById('sub');
const $err = document.getElementById('err');
const $products = document.getElementById('products');
const $empty = document.getElementById('empty');

const $catalogBtn = document.getElementById('catalogBtn');
const $dropdown = document.getElementById('dropdown');
const $cats = document.getElementById('cats');

const $bottomBar = document.getElementById('bottomBar');
const $bbLeft = document.getElementById('bbLeft');
const $bbRight = document.getElementById('bbRight');

const $overlay = document.getElementById('overlay');
const $sheet = document.getElementById('sheet');

// ---- helpers ----
function fmtRub(n) {
  const x = Number(n || 0);
  if (!isFinite(x)) return '—';
  return `${x.toFixed(0)} ₽`;
}

function isKg(uomName) {
  return String(uomName || '').toLowerCase() === 'кг';
}

function fmtQty(uomName, qty) {
  const q = Number(qty || 0);
  if (isKg(uomName)) {
    const grams = Math.round(q * 1000);
    if (grams <= 0) return '0 г';
    if (grams % 1000 === 0) return `${grams / 1000} кг`;
    if (grams >= 1000) return `${(grams / 1000).toFixed(1)} кг`;
    return `${grams} г`;
  }
  return `${q} ${uomName || 'шт'}`.trim();
}

function cartCount() {
  let n = 0;
  for (const v of cart.values()) n += Number(v.qty || 0);
  return n;
}

function cartSum() {
  let s = 0;
  for (const v of cart.values()) s += Number(v.qty || 0) * Number(v.price || 0);
  return s;
}

function getQty(id) {
  return cart.get(id)?.qty || 0;
}

function setQty(product, qty) {
  if (!product?.id) return;
  const q = Number(qty || 0);

  if (q <= 0) {
    cart.delete(product.id);
  } else {
    cart.set(product.id, {
      id: product.id,
      name: product.name,
      price: Number(product.price || 0),
      qty: q,
      uomName: product.uomName || 'шт',
      assortmentHref: product.assortmentHref,
      assortmentType: product.assortmentType,
    });
  }
  syncBottomBar();
}

function addStep(product, step) {
  const cur = Number(getQty(product.id) || 0);
  const next = Math.max(0, cur + step);
  setQty(product, next);
  // точечный апдейт карточки (без моргания всего списка)
  updateCardActions(product.id);
}

function closeDropdown() {
  $dropdown.classList.remove('open');
}

function openDropdown() {
  $dropdown.classList.add('open');
}

// ---- dropdown toggles ----
$catalogBtn.addEventListener('click', () => {
  if ($dropdown.classList.contains('open')) closeDropdown();
  else openDropdown();
});

// клик по затемнению/вне — закрываем dropdown (простое поведение)
document.addEventListener('click', (e) => {
  const inside = e.target.closest('.dropdownWrap');
  if (!inside) closeDropdown();
});

// ---- cart modal ----
function openCart() {
  renderCartSheet();
  $overlay.classList.add('open');
  $sheet.classList.add('open');
}

function closeCart() {
  $overlay.classList.remove('open');
  $sheet.classList.remove('open');
}

$bottomBar.addEventListener('click', openCart);
$overlay.addEventListener('click', closeCart);

// ---- render header/sub ----
function renderSub() {
  if (state.loading) $sub.textContent = 'Загрузка…';
  else if (state.error) $sub.textContent = 'Ошибка';
  else if (state.updatedAt) $sub.textContent = `Обновлено: ${new Date(state.updatedAt).toLocaleString()}`;
  else $sub.textContent = '';
}

// ---- categories ----
function renderCategories() {
  $cats.innerHTML = '';

  const cats = ['Все', ...(state.categories || [])];
  for (const c of cats) {
    const btn = document.createElement('button');
    btn.className = 'catBtn' + (state.selectedCategory === c ? ' active' : '');
    btn.textContent = c;
    btn.addEventListener('click', () => {
      state.selectedCategory = c;
      closeDropdown();          // ✅ фикс: после выбора категория список закрывается
      renderProducts();         // ✅ и сразу показываем товары
      renderCategories();       // подсветка active
    });
    $cats.appendChild(btn);
  }
}

// ---- products ----
function filteredProducts() {
  if (state.selectedCategory === 'Все') return state.products;
  return state.products.filter(p => p.category === state.selectedCategory);
}

function productCard(p) {
  const card = document.createElement('div');
  card.className = 'card';
  card.setAttribute('data-pid', p.id || '');

  const img = document.createElement('img');
  img.className = 'img';
  img.alt = p.name || '';
  // Сейчас “без картинок” — но если image появится, оно подхватится
  img.src = p.image || '/placeholder.png';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.onerror = () => { img.onerror = null; img.src = '/placeholder.png'; };

  const body = document.createElement('div');
  body.className = 'body';

  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = p.name || '—';

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${fmtRub(p.price)} / ${p.uomName || 'шт'}`;

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.setAttribute('data-actions', '1');

  body.appendChild(name);
  body.appendChild(meta);
  body.appendChild(actions);

  card.appendChild(img);
  card.appendChild(body);

  return card;
}

function updateCardActions(pid) {
  const card = document.querySelector(`[data-pid="${pid}"]`);
  if (!card) return;

  const p = state.products.find(x => x.id === pid);
  if (!p) return;

  const wrap = card.querySelector('[data-actions]');
  if (!wrap) return;

  wrap.innerHTML = '';

  if (!p.id) {
    const b = document.createElement('button');
    b.className = 'add';
    b.disabled = true;
    b.textContent = 'Нет ID';
    wrap.appendChild(b);
    return;
  }

  const qty = getQty(p.id);
  const uom = p.uomName || 'шт';

  if (qty <= 0) {
    const add = document.createElement('button');
    add.className = 'add';
    add.textContent = 'В корзину';
    add.addEventListener('click', () => {
      const step = isKg(uom) ? 0.1 : 1; // ✅ весовое: старт 100г
      addStep(p, step);
    });
    wrap.appendChild(add);
    return;
  }

  const minus = document.createElement('button');
  minus.className = 'step';
  minus.textContent = '−';

  const plus = document.createElement('button');
  plus.className = 'step';
  plus.textContent = '+';

  const mid = document.createElement('div');
  mid.className = 'inCart';
  mid.textContent = `В корзине: ${fmtQty(uom, qty)}`;

  minus.addEventListener('click', () => {
    const step = isKg(uom) ? 0.1 : 1; // ✅ 100г шаг
    addStep(p, -step);
  });
  plus.addEventListener('click', () => {
    const step = isKg(uom) ? 0.1 : 1;
    addStep(p, step);
  });

  wrap.appendChild(minus);
  wrap.appendChild(mid);
  wrap.appendChild(plus);
}

function renderProducts() {
  $products.innerHTML = '';
  $empty.style.display = 'none';

  const list = filteredProducts();
  if (!state.loading && (!list || list.length === 0)) {
    $empty.style.display = 'block';
    return;
  }

  for (const p of list) {
    const card = productCard(p);
    $products.appendChild(card);
    if (p?.id) updateCardActions(p.id);
  }
}

// ---- bottom bar ----
function syncBottomBar() {
  const n = cartCount();
  const s = cartSum();

  if (n <= 0) {
    $bottomBar.classList.add('hidden');
    return;
  }

  $bottomBar.classList.remove('hidden');
  $bbLeft.textContent = `🛒 Корзина (${n})`;
  $bbRight.textContent = fmtRub(s);
}

// ---- cart sheet ----
function renderCartSheet() {
  $sheet.innerHTML = '';

  const hdr = document.createElement('div');
  hdr.className = 'sheetHdr';

  const t = document.createElement('div');
  t.className = 'sheetTitle';
  t.textContent = 'Корзина';

  const x = document.createElement('button');
  x.className = 'closeBtn';
  x.textContent = '×';
  x.addEventListener('click', closeCart);

  hdr.appendChild(t);
  hdr.appendChild(x);
  $sheet.appendChild(hdr);

  const items = Array.from(cart.values());

  if (items.length === 0) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'Пока пусто';
    $sheet.appendChild(e);
    return;
  }

  const list = document.createElement('div');
  list.className = 'cartList';

  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'cartRow';

    const nm = document.createElement('div');
    nm.className = 'cartName';
    nm.textContent = it.name;

    const line = document.createElement('div');
    line.className = 'cartLine';

    const minus = document.createElement('button');
    minus.className = 'step';
    minus.textContent = '−';

    const qty = document.createElement('div');
    qty.className = 'cartQty';
    qty.textContent = fmtQty(it.uomName, it.qty);

    const plus = document.createElement('button');
    plus.className = 'step';
    plus.textContent = '+';

    const sum = document.createElement('div');
    sum.className = 'cartSum';
    sum.textContent = fmtRub(Number(it.qty || 0) * Number(it.price || 0));

    minus.addEventListener('click', () => {
      const step = isKg(it.uomName) ? 0.1 : 1;
      const next = Math.max(0, Number(it.qty || 0) - step);
      if (next <= 0) cart.delete(it.id);
      else it.qty = next;
      syncBottomBar();
      renderCartSheet();
      updateCardActions(it.id);
    });

    plus.addEventListener('click', () => {
      const step = isKg(it.uomName) ? 0.1 : 1;
      it.qty = Number(it.qty || 0) + step;
      syncBottomBar();
      renderCartSheet();
      updateCardActions(it.id);
    });

    line.appendChild(minus);
    line.appendChild(qty);
    line.appendChild(plus);

    row.appendChild(nm);
    row.appendChild(line);
    row.appendChild(sum);

    list.appendChild(row);
  }

  $sheet.appendChild(list);

  const total = document.createElement('div');
  total.className = 'totalRow';
  total.innerHTML = `<div>Итого:</div><div>${fmtRub(cartSum())}</div>`;
  $sheet.appendChild(total);

  const form = document.createElement('div');
  form.className = 'form';

  const name = document.createElement('input');
  name.className = 'inp';
  name.placeholder = 'Имя *';

  const phone = document.createElement('input');
  phone.className = 'inp';
  phone.placeholder = 'Телефон *';

  const address = document.createElement('input');
  address.className = 'inp';
  address.placeholder = 'Адрес (если доставка)';

  const comment = document.createElement('input');
  comment.className = 'inp';
  comment.placeholder = 'Комментарий';

  const btn = document.createElement('button');
  btn.className = 'orderBtn';
  btn.textContent = 'Оформить заказ';

  btn.addEventListener('click', async () => {
    const nm = (name.value || '').trim();
    const ph = (phone.value || '').trim();
    if (!nm || !ph) {
      alert('Нужны имя и телефон.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Отправляю…';

    try {
      const payload = {
        items: items.map(x => ({
          id: x.id,
          name: x.name,
          qty: x.qty,
          price: x.price,
          assortmentHref: x.assortmentHref,
          assortmentType: x.assortmentType,
        })),
        customer: {
          name: nm,
          phone: ph,
          address: (address.value || '').trim(),
        },
        comment: (comment.value || '').trim(),
      };

      const r = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'order failed');

      cart.clear();
      syncBottomBar();
      renderCartSheet();
      renderProducts();

      alert('Заказ оформлен ✅\nМы скоро свяжемся.');
      closeCart();
    } catch (e) {
      alert(`Ошибка заказа: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Оформить заказ';
    }
  });

  form.appendChild(name);
  form.appendChild(phone);
  form.appendChild(address);
  form.appendChild(comment);
  form.appendChild(btn);

  $sheet.appendChild(form);
}

// ---- load ----
async function load() {
  try {
    state.loading = true;
    state.error = null;
    renderSub();

    $err.style.display = 'none';
    $err.textContent = '';

    const resp = await fetch('/api/products', { cache: 'no-store' });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || 'Failed');

    state.products = data.products || [];
    state.categories = data.categories || [];
    state.updatedAt = data.updatedAt || null;

    state.loading = false;
    renderSub();

    renderCategories();
    renderProducts();
    syncBottomBar();

    // Telegram WebApp cosmetic
    try {
      if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
      }
    } catch (_) {}
  } catch (e) {
    state.loading = false;
    state.error = e.message;
    renderSub();

    $err.style.display = 'block';
    $err.textContent = `Ошибка загрузки: ${e.message}`;
  }
}

load();