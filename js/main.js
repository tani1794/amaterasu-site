// エントリポイント: データ読み込み・60分ごとの自動更新・テーマ切替・アニメーション制御
import {
  renderCards, renderTicker, renderMarkets, renderAiMatrix, renderOutlook, aiItem, emptyState, h,
} from './render.js';
import { drawMarketChart, chartAvailable } from './charts.js';

const REFRESH_MS = 60 * 60 * 1000;
const PAGE = 9;
const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const $ = (sel) => document.querySelector(sel);

const state = {
  news: null,
  markets: null,
  ai: null,
  log: null,
  nextRefreshAt: Date.now() + REFRESH_MS,
  limits: { world: PAGE, japan: PAGE, economy: PAGE, ai: PAGE },
  worldFilter: '',
  aiFilter: null,
  chartId: 'nikkei',
};

// ---------------- データ取得 ----------------

async function getJson(name) {
  const res = await fetch(`data/${name}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

async function load() {
  const dot = $('#status-dot');
  dot.className = 'dot is-loading';
  const [news, markets, ai, log] = await Promise.allSettled(['news.json', 'markets.json', 'ai-competitors.json', 'fetch-log.json'].map(getJson));
  // 取得に失敗したファイルは前回の表示内容を保持する
  if (news.status === 'fulfilled') state.news = news.value;
  if (markets.status === 'fulfilled') state.markets = markets.value;
  if (ai.status === 'fulfilled') state.ai = ai.value;
  if (log.status === 'fulfilled') state.log = log.value;
  const failed = [news, markets, ai].filter((r) => r.status === 'rejected');
  failed.forEach((r) => console.warn('データ取得に失敗:', r.reason?.message));
  dot.className = failed.length ? 'dot is-error' : 'dot';
  state.nextRefreshAt = Date.now() + REFRESH_MS;
  renderAll();
}

// ---------------- 描画 ----------------

function renderAll() {
  const items = state.news?.items || [];
  const updated = state.news?.updated_at;
  const lu = $('#last-updated');
  if (updated) {
    const d = new Date(updated);
    lu.textContent = `${d.getHours()}時${String(d.getMinutes()).padStart(2, '0')}分`;
    lu.dateTime = updated;
    lu.title = d.toLocaleString('ja-JP');
    lu.classList.remove('flash');
    void lu.offsetWidth; // 再描画時にフラッシュを再生
    lu.classList.add('flash');
  }

  renderNotice(items);
  renderKpiValues(items);
  renderTicker($('#ticker-track'), items);
  renderCards($('#alert-list'), items.slice(0, 5), { emptyText: '初回のデータ更新を待っています。', open: false });
  renderWorld();
  renderSection('japan', items.filter((i) => i.category === '日本政治'));
  renderSection('economy', items.filter((i) => i.category === '経済'));
  renderMarketsSection();
  renderAiSection();
  renderOutlook($('#outlook-body'), state.news?.outlook);
  observeReveal();
  runCountUps();
}

function renderNotice(items) {
  const el = $('#mode-notice');
  const mode = state.news?.analysis_mode;
  let msg = '';
  if (!items.length) msg = '初回のデータ更新を待っています。GitHub Actions が実行されると自動で表示されます。';
  else if (mode === 'rule') msg = '現在はAI分析待ちのため、キーワードによる暫定分類（「暫定分類」タグ）を表示しています。';
  else if (mode === 'mixed') msg = '一部のニュースはAI分析待ちで、暫定分類を表示しています（次回更新で順次分析されます）。';
  el.textContent = msg;
  el.hidden = !msg;
}

function renderKpiValues(items) {
  const feeds = state.log?.news?.feeds || [];
  const values = {
    total: items.length,
    severe: items.filter((i) => i.crisis_score >= 7).length,
    ai: items.filter((i) => i.analysis === 'ai').length,
    feeds: feeds.filter((f) => f.ok).length,
  };
  for (const [k, v] of Object.entries(values)) {
    const el = document.querySelector(`[data-kpi="${k}"]`);
    el.dataset.count = v;
  }
  const feedsEl = document.querySelector('[data-kpi="feeds"]');
  feedsEl.title = feeds.length ? `${feeds.length}件中 ${values.feeds}件のフィードを取得` : '';
}

function moreButton(key, total) {
  const btn = document.querySelector(`[data-more="${key}"]`);
  btn.hidden = total <= state.limits[key];
  btn.textContent = `もっと見る（残り${Math.max(0, total - state.limits[key])}件）`;
}

function renderSection(key, list) {
  renderCards($(`#${key}-list`), list, { limit: state.limits[key] });
  moreButton(key, list.length);
}

function renderWorld() {
  const items = (state.news?.items || []).filter((i) => (state.worldFilter ? i.category === state.worldFilter : i.category === '国際政治' || i.category === '戦争'));
  renderSection('world', items);
}

function renderMarketsSection() {
  const instruments = state.markets?.instruments || [];
  if (!instruments.some((m) => m.id === state.chartId) && instruments[0]) state.chartId = instruments[0].id;
  renderMarkets($('#market-grid'), instruments, state.chartId, (id) => {
    state.chartId = id;
    renderMarketsSection();
    observeReveal();
  });
  const tabs = $('#chart-tabs');
  tabs.replaceChildren(...instruments.map((m) => h('button', {
    type: 'button',
    role: 'tab',
    class: `chip${m.id === state.chartId ? ' is-active' : ''}`,
    'aria-selected': m.id === state.chartId ? 'true' : 'false',
    onclick: () => { state.chartId = m.id; renderMarketsSection(); observeReveal(); },
  }, m.name)));
  drawChart();
}

function drawChart() {
  const inst = (state.markets?.instruments || []).find((m) => m.id === state.chartId);
  const fallback = $('#chart-fallback');
  const canvas = $('#market-chart');
  if (!inst || !inst.history?.length) {
    fallback.textContent = '表示できる市場データがまだありません。';
    fallback.hidden = false;
    canvas.hidden = true;
    return;
  }
  const ok = chartAvailable() && drawMarketChart(canvas, inst, { reduceMotion: reduceMotionQuery.matches });
  fallback.textContent = 'グラフを表示できませんでした（Chart.js の読み込みに失敗）。';
  fallback.hidden = ok;
  canvas.hidden = !ok;
}

function renderAiSection() {
  const data = state.ai || { items: [] };
  const f = state.aiFilter;
  renderAiMatrix($('#ai-matrix'), data, f, (pick) => {
    const same = f && f.company === pick.company && f.type === pick.type;
    state.aiFilter = same ? null : pick;
    state.limits.ai = PAGE;
    renderAiSection();
    observeReveal();
  });
  const list = (data.items || []).filter((i) => !f || (i.company === f.company && (!f.type || i.type === f.type)));
  const label = $('#ai-filter-label');
  label.hidden = !f;
  label.replaceChildren(...(f ? [h('button', {
    type: 'button',
    class: 'chip is-active',
    onclick: () => { state.aiFilter = null; renderAiSection(); observeReveal(); },
  }, `${f.company}${f.type ? ` × ${f.type}` : ''} で絞り込み中 ✕`)] : []));
  $('#ai-list').replaceChildren(...(list.length ? list.slice(0, state.limits.ai).map(aiItem) : [emptyState('AI関連ニュースはまだありません。')]));
  moreButton('ai', list.length);
}

// ---------------- アニメーション ----------------

let revealObserver = null;
function observeReveal() {
  const targets = document.querySelectorAll('.reveal:not(.is-visible)');
  if (reduceMotionQuery.matches || !('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-visible'));
    return;
  }
  revealObserver ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        revealObserver.unobserve(e.target);
      }
    }
  }, { rootMargin: '0px 0px -40px 0px', threshold: 0.05 });
  targets.forEach((el) => revealObserver.observe(el));
}

/** data-count を持つ要素の数値を 0 → 目標値へカウントアップ */
function runCountUps() {
  const els = document.querySelectorAll('[data-count]');
  for (const el of els) {
    const target = Number(el.dataset.count);
    if (el.dataset.count === '' || !Number.isFinite(target)) continue;
    const decimals = Number(el.dataset.decimals || 0);
    const fmt = (v) => v.toLocaleString('ja-JP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    if (reduceMotionQuery.matches) {
      el.textContent = fmt(target);
      continue;
    }
    const from = Number(el.dataset.shown || 0);
    const start = performance.now();
    const dur = 900;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - (1 - t) ** 3;
      el.textContent = fmt(from + (target - from) * eased);
      if (t < 1) requestAnimationFrame(step);
      else el.dataset.shown = target;
    };
    requestAnimationFrame(step);
  }
}

// ---------------- 自動更新・カウントダウン ----------------

function tick() {
  const left = Math.max(0, state.nextRefreshAt - Date.now());
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  $('#countdown').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (left === 0) {
    state.nextRefreshAt = Date.now() + REFRESH_MS; // 二重実行防止
    load();
  }
}

// ---------------- テーマ ----------------

function setupTheme() {
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]').content = next === 'light' ? '#f4f6fa' : '#0b0f17';
    try { localStorage.setItem('amaterasu-theme', next); } catch { /* 保存できなくても動作に影響なし */ }
    drawChart(); // 配色を反映
  });
}

// ---------------- イベント ----------------

function setupControls() {
  document.querySelector('[data-filter-for="world"]').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.worldFilter = btn.dataset.value;
    state.limits.world = PAGE;
    e.currentTarget.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c === btn));
    renderWorld();
    observeReveal();
  });
  document.querySelectorAll('[data-more]').forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.more;
    state.limits[key] += PAGE;
    if (key === 'world') renderWorld();
    else if (key === 'ai') renderAiSection();
    else renderSection(key, (state.news?.items || []).filter((i) => i.category === (key === 'japan' ? '日本政治' : '経済')));
    observeReveal();
  }));
  // 非表示タブから戻った時、更新時刻を過ぎていれば即時更新
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() >= state.nextRefreshAt) load();
  });
}

function init() {
  setupTheme();
  setupControls();
  load();
  setInterval(tick, 1000);
  tick();
}

// Chart.js（defer）より後に実行されるが、念のため DOM 構築完了を待つ
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
