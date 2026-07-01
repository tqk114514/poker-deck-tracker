'use strict';

const STORAGE_KEY = 'pokerDeck.heldCards';
const BOX_STORAGE_KEY = 'pokerDeck.boxOwned';

// ====== Card data generation ======
const SUITS = [
  { key: 'spades',   code: 'S', symbol: '♠', color: 'black', label: '黑桃' },
  { key: 'hearts',   code: 'H', symbol: '♥', color: 'red',   label: '红心' },
  { key: 'diamonds', code: 'D', symbol: '♦', color: 'red',   label: '方块' },
  { key: 'clubs',    code: 'C', symbol: '♣', color: 'black', label: '梅花' }
];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function buildDeck() {
  const deck = [];
  SUITS.forEach(suit => {
    RANKS.forEach(rank => {
      deck.push({
        id: `${suit.code}-${rank}`,
        suit: suit.key,
        rank,
        label: rank,
        symbol: suit.symbol,
        color: suit.color
      });
    });
  });
  // Jokers
  deck.push({
    id: 'J-B', suit: 'joker', rank: 'B', label: 'JOKER',
    symbol: '★', color: 'black', jokerType: 'small'
  });
  deck.push({
    id: 'J-R', suit: 'joker', rank: 'R', label: 'JOKER',
    symbol: '★', color: 'gold', jokerType: 'big'
  });
  return deck;
}

const DECK = buildDeck();
const deckById = new Map(DECK.map(c => [c.id, c]));

// ====== State ======
let cardStates = loadStates();
let boxOwned = loadBoxState();
let statusFilter = 'all'; // all | held | missing
let suitFilter = 'all';   // all | spades | hearts | diamonds | clubs | joker

function loadStates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed);
  } catch (e) {
    console.warn('Failed to parse saved states:', e);
  }
  return new Set();
}

function loadBoxState() {
  return localStorage.getItem(BOX_STORAGE_KEY) === 'true';
}

function saveBoxState() {
  try {
    localStorage.setItem(BOX_STORAGE_KEY, String(boxOwned));
    updateLastSaved();
  } catch (e) {
    console.warn('Failed to save box state:', e);
  }
}

function saveStates() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(cardStates)));
    updateLastSaved();
  } catch (e) {
    console.warn('Failed to save states:', e);
    showToast('保存失败');
  }
}

function isChecked(id) {
  return cardStates.has(id);
}

function setState(id, val) {
  if (val) cardStates.add(id);
  else cardStates.delete(id);
}

// ====== Rendering ======
const grid = document.getElementById('grid');

function cardInner(card) {
  if (card.suit === 'joker') {
    const word = card.jokerType === 'big' ? 'BIG' : 'SMALL';
    return `
      <div class="corner tl"><div class="rank">${word === 'BIG' ? 'B' : 'S'}</div><div class="sym">${card.symbol}</div></div>
      <div class="center joker">
        <div class="star">${card.symbol}</div>
        <div class="word">JOKER</div>
      </div>
      <div class="corner br"><div class="rank">${word === 'BIG' ? 'B' : 'S'}</div><div class="sym">${card.symbol}</div></div>
      <div class="checkmark"></div>
    `;
  }
  return `
    <div class="corner tl"><div class="rank">${card.label}</div><div class="sym">${card.symbol}</div></div>
    <div class="center">${card.symbol}</div>
    <div class="corner br"><div class="rank">${card.label}</div><div class="sym">${card.symbol}</div></div>
    <div class="checkmark"></div>
  `;
}

// 元素缓存：54 张牌的 DOM 元素在 init 时一次性创建，renderGrid 只做移动+属性更新，跳过 HTML 解析
const cardEls = new Map();
function buildCardEls() {
  DECK.forEach(card => {
    const el = document.createElement('div');
    el.className = `card ${card.color}`;
    el.dataset.id = card.id;
    el.setAttribute('role', 'checkbox');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', card.suit === 'joker'
      ? (card.jokerType === 'big' ? '大王' : '小王')
      : fullLabel(card));
    el.innerHTML = cardInner(card);
    cardEls.set(card.id, el);
  });
}

function renderGrid() {
  leavingSet.clear();
  if (cleanTimer) { clearTimeout(cleanTimer); cleanTimer = null; }
  // 先清空 grid（1 次批量操作断开所有元素），再更新属性（断开状态下无样式重算），最后一次性插入
  grid.replaceChildren();
  const frag = document.createDocumentFragment();
  let idx = 0;
  for (const card of DECK) {
    if (suitFilter !== 'all' && card.suit !== suitFilter) continue;
    if (statusFilter === 'held' && !isChecked(card.id)) continue;
    if (statusFilter === 'missing' && isChecked(card.id)) continue;
    const el = cardEls.get(card.id);
    const checked = isChecked(card.id);
    el.className = `card ${card.color} ${checked ? 'checked' : 'unchecked'}`;
    el.setAttribute('aria-checked', String(checked));
    el.style.setProperty('--deal-delay', `${(idx * 0.025).toFixed(3)}s`);
    frag.appendChild(el);
    idx++;
  }
  grid.appendChild(frag);
  calibrateGrid();
}

function updateBoxDom() {
  const box = document.getElementById('cardbox');
  box.classList.toggle('owned', boxOwned);
  box.setAttribute('aria-checked', String(boxOwned));
  document.getElementById('boxStateLabel').textContent = boxOwned ? '牌盒已摸到' : '牌盒未摸到';
}

function toggleBox() {
  boxOwned = !boxOwned;
  updateBoxDom();
  saveBoxState();
  showToast(boxOwned ? '牌盒已标记为摸到' : '牌盒已标记为未摸到');
}

function fullLabel(card) {
  const suit = SUITS.find(s => s.key === card.suit);
  return `${suit ? suit.label : ''} ${card.label}`;
}

function updateCardDom(id) {
  const el = grid.querySelector(`.card[data-id="${id}"]`);
  if (!el) return;
  const checked = isChecked(id);
  el.classList.toggle('checked', checked);
  el.classList.toggle('unchecked', !checked);
  el.setAttribute('aria-checked', String(checked));
  clearTimeout(el._flashTimer);
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  el._flashTimer = setTimeout(() => el.classList.remove('flash'), 250);
}

function cardMatchesFilter(card) {
  if (suitFilter !== 'all' && card.suit !== suitFilter) return false;
  if (statusFilter === 'held' && !isChecked(card.id)) return false;
  if (statusFilter === 'missing' && isChecked(card.id)) return false;
  return true;
}

// ====== Grid metrics (零 reflow 标定) ======
// cols 用 offsetTop 数（不受 transform 影响）；cardW/cardH 用 grid 容器 rect 反推小数精确值
let gridMetrics = null; // { cols, cardW, cardH, gap }

function calibrateGrid() {
  const cards = grid.children;
  if (cards.length < 1) { gridMetrics = null; return; }
  // cols：用 offsetTop 数第一行（不受 transform 影响）
  const top0 = cards[0].offsetTop;
  let cols = 1;
  for (let i = 1; i < cards.length; i++) {
    if (cards[i].offsetTop !== top0) break;
    cols++;
  }
  let gap = 14;
  try {
    const cs = getComputedStyle(grid);
    gap = parseFloat(cs.columnGap || cs.gap) || 14;
  } catch (e) {}
  // 用 grid 容器自身的 rect 反推精确列宽/行高（小数）。
  // grid 无 transform，rect 不受子元素入场/leaving 动画影响。连续读只触发 1 次 reflow。
  const gridRect = grid.getBoundingClientRect();
  const cardW = (gridRect.width - gap * (cols - 1)) / cols;
  const rows = Math.ceil(cards.length / cols);
  const cardH = rows > 1
    ? (gridRect.height - gap * (rows - 1)) / rows
    : cardW * (3.5 / 2.5); // aspect-ratio 2.5/3.5 fallback（单行时无行间距可推）
  gridMetrics = { cols, cardW, cardH, gap };
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(calibrateGrid, 150);
});

const leavingSet = new Set();
let cleanTimer = null;

function scheduleClean() {
  if (cleanTimer) clearTimeout(cleanTimer);
  cleanTimer = setTimeout(cleanLeaving, 340);
}

function cleanLeaving() {
  cleanTimer = null;
  if (leavingSet.size === 0) return;

  const m = gridMetrics;
  const useArithmetic = !!m;

  // 一次遍历：建 oldIndexMap（旧索引 = 含 leaving 的 DOM 顺序）+ 收集稳定卡片
  const oldIndexMap = new Map();
  const stablePre = [];
  const children = grid.children;
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    oldIndexMap.set(c, i);
    if (!c.classList.contains('leaving')) stablePre.push(c);
  }

  // 仅 fallback 需要真实 First 位置；算术路径完全跳过 getBoundingClientRect
  let firstRects = null;
  if (!useArithmetic) {
    firstRects = new Array(stablePre.length);
    for (let i = 0; i < stablePre.length; i++) {
      firstRects[i] = stablePre[i].getBoundingClientRect();
    }
  }

  // 移除 leaving 牌。移除后 stablePre[i] 的新索引就是 i（相对顺序不变）
  leavingSet.forEach(el => el.remove());
  leavingSet.clear();

  const stepX = m ? m.cardW + m.gap : 0;
  const stepY = m ? m.cardH + m.gap : 0;
  const cols = m ? m.cols : 0;

  for (let i = 0; i < stablePre.length; i++) {
    const c = stablePre[i];
    let dx, dy;

    if (useArithmetic) {
      // 纯算术：位移 = (旧列-新列)*stepX, (旧行-新行)*stepY
      const oldIdx = oldIndexMap.get(c);
      dx = ((oldIdx % cols) - (i % cols)) * stepX;
      dy = (Math.floor(oldIdx / cols) - Math.floor(i / cols)) * stepY;
    } else {
      // fallback: 真实 First - Last
      const first = firstRects[i];
      const last = c.getBoundingClientRect();
      dx = first.left - last.left;
      dy = first.top - last.top;
    }

    if (dx === 0 && dy === 0) continue;

    c.animate(
      [
        { transform: `translate3d(${dx}px, ${dy}px, 0)` },
        { transform: 'translate3d(0, 0, 0)' }
      ],
      {
        duration: 350,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'none'
      }
    );
  }
}

function removeCardWithAnimation(id) {
  const el = grid.querySelector(`.card[data-id="${id}"]`);
  if (!el) return;

  setTimeout(() => {
    if (!grid.contains(el)) return;
    const card = DECK.find(c => c.id === id);
    if (card && cardMatchesFilter(card)) return;

    el.classList.add('leaving');
    leavingSet.add(el);
    scheduleClean();
  }, 500);
}

function updateStats() {
  let held = 0;
  DECK.forEach(c => { if (isChecked(c.id)) held++; });
  const missing = DECK.length - held;
  document.getElementById('heldCount').textContent = held;
  document.getElementById('missingCount').textContent = missing;
  document.getElementById('boxCount').textContent = held;
  document.getElementById('heldTagCount').textContent = `(${held})`;
  document.getElementById('missingTagCount').textContent = `(${missing})`;
  const pct = (held / DECK.length) * 100;
  document.getElementById('progressFill').style.width = pct + '%';
}

function updateLastSaved() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  document.getElementById('lastSaved').textContent = `最后保存 ${hh}:${mm}:${ss}`;
}

// ====== Interaction ======
function toggleCard(id) {
  const card = DECK.find(c => c.id === id);
  setState(id, !isChecked(id));
  updateCardDom(id);
  updateStats();
  saveStates();
  if (card && !cardMatchesFilter(card)) {
    removeCardWithAnimation(id);
  }
}

grid.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  toggleCard(card.dataset.id);
});

grid.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('.card');
  if (!card) return;
  e.preventDefault();
  toggleCard(card.dataset.id);
});

// Tag filter (status group + suit group, independent)
document.getElementById('tags').addEventListener('click', (e) => {
  const tag = e.target.closest('.tag');
  if (!tag) return;
  const type = tag.dataset.type;
  const filter = tag.dataset.filter;
  document.querySelectorAll(`.tag[data-type="${type}"]`).forEach(t => t.classList.remove('active'));
  tag.classList.add('active');
  if (type === 'status') statusFilter = filter;
  else suitFilter = filter;
  renderGrid();
});

// Card box toggle
const cardboxEl = document.getElementById('cardbox');
cardboxEl.addEventListener('click', toggleBox);
cardboxEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    toggleBox();
  }
});

// Batch actions
document.getElementById('btnSelectAll').addEventListener('click', () => {
  DECK.forEach(c => setState(c.id, true));
  renderGrid();
  updateStats();
  saveStates();
  showToast('已全选');
});

document.getElementById('btnSelectNone').addEventListener('click', () => {
  DECK.forEach(c => setState(c.id, false));
  renderGrid();
  updateStats();
  saveStates();
  showToast('已全不选');
});

document.getElementById('btnReset').addEventListener('click', () => {
  cardStates = new Set();
  boxOwned = false;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(BOX_STORAGE_KEY);
  document.getElementById('lastSaved').textContent = '尚未保存';
  renderGrid();
  updateStats();
  updateBoxDom();
  showToast('已重置');
});

// Toast
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ====== Init ======
buildCardEls();
renderGrid();
updateStats();
updateBoxDom();
if (window.__loaderTick) window.__loaderTick();
