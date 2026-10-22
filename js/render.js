// 描画処理。外部データは必ず textContent / setAttribute 経由で挿入する（innerHTML は使わない）。

/** 要素生成ヘルパ: h('a', { class: 'x', href }, [子要素 or 文字列]) */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '#');

export function scoreLevel(s) {
  if (s >= 9) return 'critical';
  if (s >= 7) return 'high';
  if (s >= 4) return 'mid';
  return 'low';
}

export function relTime(iso) {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return '';
  const m = Math.round(diff / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr}時間前`;
  return `${Math.round(hr / 24)}日前`;
}

export function fmtDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtNum(v, decimals = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('ja-JP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function summaryLines(text) {
  return String(text || '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function categoryTag(cat) {
  return h('span', { class: `tag${cat === '戦争' ? ' tag-war' : ''}` }, cat);
}

const STEPS = [
  ['step1_facts', '① 事実'],
  ['step2_background', '② 背景'],
  ['step3_impact', '③ 影響'],
  ['step4_scenarios', '④ シナリオ'],
  ['step5_conclusion', '⑤ 結論'],
];

/** ニュースカード（CoT 5段階を折りたたみで表示） */
export function newsCard(item, { open = false } = {}) {
  const severe = item.crisis_score >= 7;
  const pending = item.analysis === 'rule';
  const tags = [categoryTag(item.category)];
  if (pending) tags.push(h('span', { class: 'tag tag-pending', title: 'AI分析前のキーワードによる暫定分類' }, '暫定分類'));
  if (item.analysis === 'market') tags.push(h('span', { class: 'tag tag-market' }, '市場データ'));

  const cot = h('details', { class: 'cot', open: open || null }, [
    h('summary', {}, 'CoT分析（5段階）を見る'),
    h('ol', {}, STEPS.map(([key, label]) => {
      const v = item[key];
      const body = Array.isArray(v)
        ? (v.length ? h('ul', {}, v.map((s) => h('li', {}, s))) : '—')
        : (v || '—');
      return h('li', {}, [h('span', { class: 'step-label' }, label), h('div', { class: 'step-body' }, body)]);
    })),
  ]);

  return h('article', { class: `card reveal${severe ? ' is-severe' : ''}`, dataset: { id: item.id } }, [
    h('div', { class: 'card-top' }, [
      h('span', { class: 'score', dataset: { level: scoreLevel(item.crisis_score), count: item.crisis_score }, 'aria-label': `危機度 ${item.crisis_score}` }, String(item.crisis_score)),
      h('div', { class: 'card-meta' }, [
        h('div', { class: 'tags' }, tags),
        h('span', {}, [item.source, ' ・ ', h('time', { datetime: item.published_at, title: fmtDateTime(item.published_at) }, relTime(item.published_at))]),
      ]),
    ]),
    h('h3', { class: 'card-title' }, h('a', { href: safeUrl(item.source_url), target: '_blank', rel: 'noopener noreferrer' }, item.title)),
    h('ul', { class: 'summary' }, summaryLines(item.summary).map((l) => h('li', {}, l))),
    !pending && item.step5_conclusion ? h('p', { class: 'conclusion' }, item.step5_conclusion) : null,
    cot,
    h('div', { class: 'card-foot' }, [
      h('span', {}, item.original_title && item.original_title !== item.title ? `原題: ${item.original_title}` : ''),
      h('a', { class: 'src-link', href: safeUrl(item.source_url), target: '_blank', rel: 'noopener noreferrer' }, '元記事 ↗'),
    ]),
  ]);
}

export function emptyState(text) {
  return h('p', { class: 'empty' }, text);
}

export function renderCards(container, items, { limit = Infinity, emptyText = '該当するニュースはまだありません。', open = false } = {}) {
  container.replaceChildren(...(items.length ? items.slice(0, limit).map((i) => newsCard(i, { open })) : [emptyState(emptyText)]));
}

export function renderTicker(track, items) {
  const top = items.filter((i) => i.crisis_score >= 7).slice(0, 12);
  const list = top.length ? top : items.slice(0, 8);
  if (!list.length) {
    track.classList.remove('is-running');
    track.replaceChildren(h('span', { class: 'ticker-item' }, '現在、速報はありません。'));
    return;
  }
  const make = (hidden) => list.map((i) => h('span', { class: 'ticker-item', 'aria-hidden': hidden ? 'true' : null }, [
    h('span', { class: 't-score' }, `[${i.crisis_score}]`),
    h('a', { href: safeUrl(i.source_url), target: '_blank', rel: 'noopener noreferrer', tabindex: hidden ? '-1' : null }, i.title),
  ]));
  // 同じ内容を2回並べ、-50% までスクロールして継ぎ目なくループさせる
  track.replaceChildren(...make(false), ...make(true));
  track.style.setProperty('--ticker-duration', `${Math.max(30, list.length * 9)}s`);
  track.classList.add('is-running');
}

export function renderMarkets(grid, instruments, activeId, onSelect) {
  if (!instruments.length) {
    grid.replaceChildren(emptyState('市場データはまだ取得されていません。'));
    return;
  }
  grid.replaceChildren(...instruments.map((m) => {
    const isYield = m.kind === 'yield';
    const dir = m.change > 0 ? 'up' : m.change < 0 ? 'down' : '';
    const sign = m.change > 0 ? '+' : '';
    const changeText = m.change == null
      ? '—'
      : isYield
        ? `${sign}${fmtNum(m.change_bp ?? m.change * 100, 1)}bp`
        : `${sign}${fmtNum(m.change, m.decimals)} (${sign}${fmtNum(m.change_pct, 2)}%)`;
    return h('button', {
      type: 'button',
      class: `mkt reveal${m.id === activeId ? ' is-active' : ''}`,
      dataset: { id: m.id },
      'aria-pressed': m.id === activeId ? 'true' : 'false',
      onclick: () => onSelect(m.id),
    }, [
      h('span', { class: 'mkt-name' }, [
        m.name,
        m.stale
          ? h('span', { class: 'badge-stale', title: m.updated_at ? '最新の取得に失敗したため前回値を表示' : 'まだ一度も取得できていません' }, m.updated_at ? '前回値' : '未取得')
          : null,
      ]),
      h('span', { class: 'mkt-value' }, [
        h('span', { dataset: { count: m.value ?? '', decimals: m.decimals } }, fmtNum(m.value, m.decimals)),
        h('span', { class: 'mkt-unit' }, m.unit),
      ]),
      h('span', { class: `mkt-change ${dir}` }, changeText),
      h('span', { class: 'mkt-asof' }, m.updated_at ? `${m.as_of ?? ''} 終値 / 取得 ${fmtDateTime(m.updated_at)}` : '未取得'),
    ]);
  }));
}

export function renderAiMatrix(table, data, active, onPick) {
  const items = data.items || [];
  const companies = (data.companies || []).filter((c) => items.some((i) => i.company === c));
  const types = data.types || [];
  if (!companies.length) {
    table.replaceChildren(h('tbody', {}, h('tr', {}, h('td', {}, 'AI関連ニュースはまだありません。'))));
    return;
  }
  const max = Math.max(1, ...companies.flatMap((c) => types.map((t) => data.matrix?.[c]?.[t] || 0)));
  table.replaceChildren(
    h('thead', {}, h('tr', {}, [h('th', { scope: 'col' }, '企業'), ...types.map((t) => h('th', { scope: 'col' }, t)), h('th', { scope: 'col' }, '計')])),
    h('tbody', {}, companies.map((c) => {
      const row = types.map((t) => data.matrix?.[c]?.[t] || 0);
      return h('tr', {}, [
        h('th', { scope: 'row' }, c),
        ...row.map((n, idx) => h('td', {}, h('button', {
          type: 'button',
          disabled: n === 0 || null,
          class: active && active.company === c && active.type === types[idx] ? 'is-active' : null,
          style: `--heat:${(n / max).toFixed(2)}`,
          'aria-label': `${c} ${types[idx]} ${n}件`,
          onclick: () => onPick({ company: c, type: types[idx] }),
        }, n ? String(n) : '·'))),
        h('td', {}, h('button', { type: 'button', style: '--heat:0', onclick: () => onPick({ company: c }) }, String(row.reduce((a, b) => a + b, 0)))),
      ]);
    })),
  );
}

export function aiItem(i) {
  return h('article', { class: 'ai-item reveal' }, [
    h('div', { class: 'tags' }, [
      h('span', { class: 'tag' }, i.company),
      h('span', { class: 'tag' }, i.type),
      i.analysis === 'rule' ? h('span', { class: 'tag tag-pending' }, '暫定分類') : null,
    ]),
    h('h3', { class: 'card-title' }, h('a', { href: safeUrl(i.source_url), target: '_blank', rel: 'noopener noreferrer' }, i.title)),
    h('ul', { class: 'summary' }, summaryLines(i.summary).map((l) => h('li', {}, l))),
    i.analysis !== 'rule' && i.conclusion ? h('p', { class: 'conclusion' }, i.conclusion) : null,
    h('div', { class: 'card-foot' }, [
      h('span', {}, [i.source, ' ・ ', relTime(i.published_at)]),
      h('a', { class: 'src-link', href: safeUrl(i.source_url), target: '_blank', rel: 'noopener noreferrer' }, '元記事 ↗'),
    ]),
  ]);
}

export function renderOutlook(container, outlook) {
  if (!outlook) {
    container.replaceChildren(emptyState('分析データの蓄積後に表示されます。'));
    return;
  }
  container.replaceChildren(...[
    h('div', { class: 'outlook-hero reveal' }, [h('h3', {}, outlook.headline), h('p', {}, outlook.overview)]),
    h('div', { class: 'outlook-grid' }, (outlook.areas || []).map((a) => h('div', { class: 'outlook-card reveal' }, [
      h('h4', {}, a.area),
      h('p', { class: 'stance' }, a.stance),
      h('ul', {}, (a.actions || []).map((x) => h('li', {}, x))),
    ]))),
    (outlook.watch || []).length
      ? h('div', { class: 'watch reveal' }, [h('h4', {}, '👀 来週の注視点'), h('ul', {}, outlook.watch.map((w) => h('li', {}, w)))])
      : null,
    h('p', { class: 'outlook-meta' }, `${outlook.analysis === 'ai' ? 'AIによる統合分析' : 'ルールベースの暫定指針（AI分析待ち）'} ・ 生成 ${fmtDateTime(outlook.generated_at)}`),
  ].filter(Boolean));
}
