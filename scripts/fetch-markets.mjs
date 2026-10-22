// 市場データ（日足）を無料ソースから取得して data/markets.json に保存する。
// ソースは銘柄ごとに順に試し、全て失敗したら前回データを保持して stale: true を付ける。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FIXTURE_DIR, USE_FIXTURES, dataPath, readJson, writeJson, fetchWithTimeout, log,
} from './lib/util.mjs';

const KEEP_POINTS = 130;

const INSTRUMENTS = [
  { id: 'nikkei', name: '日経平均', unit: '円', decimals: 0, kind: 'index', sources: [['stooq', '^nkx'], ['yahoo', '^N225']] },
  { id: 'topix', name: 'TOPIX', unit: 'pt', decimals: 2, kind: 'index', sources: [['stooq', '^tpx'], ['yahoo', '^TOPX']] },
  { id: 'usdjpy', name: 'ドル円', unit: '円', decimals: 2, kind: 'fx', sources: [['stooq', 'usdjpy'], ['yahoo', 'JPY=X']] },
  { id: 'us10y', name: '米10年債利回り', unit: '%', decimals: 3, kind: 'yield', sources: [['stooq', '10usy.b'], ['fred', 'DGS10'], ['yahoo', '^TNX']] },
  { id: 'jp10y', name: '日本10年債利回り', unit: '%', decimals: 3, kind: 'yield', sources: [['stooq', '10jpy.b'], ['mof', '10年']] },
  { id: 'wti', name: 'WTI原油', unit: 'ドル/バレル', decimals: 2, kind: 'commodity', sources: [['stooq', 'cl.f'], ['yahoo', 'CL=F']] },
  { id: 'gold', name: '金', unit: 'ドル/oz', decimals: 1, kind: 'commodity', sources: [['stooq', 'xauusd'], ['yahoo', 'GC=F']] },
];

const SOURCE_PAGES = {
  stooq: (s) => `https://stooq.com/q/?s=${encodeURIComponent(s)}`,
  yahoo: (s) => `https://finance.yahoo.com/quote/${encodeURIComponent(s)}`,
  fred: (s) => `https://fred.stlouisfed.org/series/${s}`,
  mof: () => 'https://www.mof.go.jp/jgbs/reference/interest_rate/',
};

// ---- 各ソースの取得・パース（戻り値: 日付昇順の [{d:'YYYY-MM-DD', c:number}]） ----

function parseStooqCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (!/^Date,/i.test(lines[0] || '')) throw new Error(`stooq: 予期しない応答 "${(lines[0] || '').slice(0, 40)}"`);
  const idx = lines[0].split(',').findIndex((h) => /^close$/i.test(h.trim()));
  return lines.slice(1).map((l) => l.split(',')).map((c) => ({ d: c[0], c: Number(c[idx]) })).filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.d) && Number.isFinite(p.c));
}

async function fromStooq(sym, inst) {
  const csv = USE_FIXTURES
    ? await readFile(path.join(FIXTURE_DIR, 'markets', `${inst.id}.csv`), 'utf8')
    : await fetchWithTimeout(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`);
  return parseStooqCsv(csv);
}

async function fromYahoo(sym) {
  if (USE_FIXTURES) throw new Error('fixture なし');
  const j = await fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=6mo&interval=1d`, { as: 'json' });
  const r = j?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error('yahoo: データなし');
  const closes = r.indicators?.quote?.[0]?.close || [];
  const tz = r.meta?.gmtoffset || 0;
  return r.timestamp
    .map((t, i) => ({ d: new Date((t + tz) * 1000).toISOString().slice(0, 10), c: closes[i] }))
    .filter((p) => Number.isFinite(p.c));
}

async function fromFred(series) {
  if (USE_FIXTURES) throw new Error('fixture なし');
  const since = new Date(Date.now() - 200 * 864e5).toISOString().slice(0, 10);
  const csv = await fetchWithTimeout(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}&cosd=${since}`);
  return csv.trim().split(/\r?\n/).slice(1).map((l) => l.split(',')).map(([d, v]) => ({ d, c: Number(v) })).filter((p) => Number.isFinite(p.c));
}

// 財務省「国債金利情報」（当月分CSV, Shift_JIS, 和暦の日付）
function warekiToIso(s) {
  const m = /^([RHS])(\d+)\.(\d+)\.(\d+)$/.exec(s.trim());
  if (!m) return null;
  const base = { R: 2018, H: 1988, S: 1925 }[m[1]];
  return `${base + Number(m[2])}-${m[3].padStart(2, '0')}-${m[4].padStart(2, '0')}`;
}

async function fromMof(column) {
  const buf = USE_FIXTURES
    ? await readFile(path.join(FIXTURE_DIR, 'markets', 'jgbcm.csv'))
    : await fetchWithTimeout('https://www.mof.go.jp/jgbs/reference/interest_rate/jgbcm.csv', { as: 'buffer' });
  let text = new TextDecoder('shift_jis').decode(buf);
  if (!text.includes(column)) text = new TextDecoder('utf-8').decode(buf);
  const lines = text.trim().split(/\r?\n/).map((l) => l.split(','));
  const headerIdx = lines.findIndex((c) => c.includes(column));
  if (headerIdx < 0) throw new Error('mof: 列が見つからない');
  const col = lines[headerIdx].indexOf(column);
  return lines.slice(headerIdx + 1).map((c) => ({ d: warekiToIso(c[0] || ''), c: Number(c[col]) })).filter((p) => p.d && Number.isFinite(p.c));
}

const FETCHERS = { stooq: fromStooq, yahoo: fromYahoo, fred: fromFred, mof: fromMof };

// ---- 集計 ----

function mergeHistory(oldH = [], newH = []) {
  const map = new Map(oldH.map((p) => [p.d, p.c]));
  for (const p of newH) map.set(p.d, p.c);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-KEEP_POINTS).map(([d, c]) => ({ d, c }));
}

function summarize(inst, history) {
  const last = history.at(-1);
  const prev = history.at(-2);
  const change = last && prev ? last.c - prev.c : null;
  const pct = last && prev && prev.c !== 0 ? (change / prev.c) * 100 : null;
  const round = (v, n) => (v == null ? null : Number(v.toFixed(n)));
  return {
    value: round(last?.c, inst.decimals + 1),
    as_of: last?.d ?? null,
    change: round(change, inst.decimals + 2),
    change_pct: round(pct, 2),
    // 利回りは %pt 変化で見る
    change_bp: inst.kind === 'yield' && change != null ? round(change * 100, 1) : undefined,
  };
}

async function main() {
  const prev = await readJson(dataPath('markets.json'), { instruments: [] });
  const prevById = new Map((prev.instruments || []).map((i) => [i.id, i]));
  const nowIso = new Date().toISOString();
  const logs = [];

  const instruments = [];
  for (const inst of INSTRUMENTS) {
    const old = prevById.get(inst.id);
    let fetched = null;
    let usedSource = null;
    const errors = [];
    for (const [src, sym] of inst.sources) {
      try {
        const h = await FETCHERS[src](sym, inst);
        if (h.length < 2) throw new Error(`${src}: データ点不足 (${h.length})`);
        fetched = h;
        usedSource = [src, sym];
        break;
      } catch (err) {
        errors.push(`${src}(${sym}): ${err?.message || err}`);
      }
    }
    logs.push({ id: inst.id, ok: !!fetched, source: usedSource?.[0] ?? null, errors });

    const { sources, ...meta } = inst;
    if (fetched) {
      const history = mergeHistory(old?.history, fetched);
      instruments.push({
        ...meta, ...summarize(inst, history),
        source: usedSource[0], source_url: SOURCE_PAGES[usedSource[0]](usedSource[1]),
        updated_at: nowIso, stale: false, history,
      });
    } else if (old) {
      instruments.push({ ...old, ...meta, stale: true }); // 前回データを保持（updated_at は前回のまま）
    } else {
      instruments.push({ ...meta, value: null, as_of: null, change: null, change_pct: null, source: null, source_url: null, updated_at: null, stale: true, history: [] });
    }
  }

  const alerts = instruments
    .filter((i) => i.kind === 'index' && !i.stale && i.change_pct != null && i.change_pct <= -3)
    .map((i) => ({ id: i.id, name: i.name, change_pct: i.change_pct, as_of: i.as_of, source_url: i.source_url }));

  await writeJson(dataPath('markets.json'), { updated_at: nowIso, fixtures: USE_FIXTURES, alerts, instruments });

  const fetchLog = await readJson(dataPath('fetch-log.json'), {});
  fetchLog.markets = { updated_at: nowIso, fixtures: USE_FIXTURES, instruments: logs };
  await writeJson(dataPath('fetch-log.json'), fetchLog);

  for (const l of logs) log(`${l.ok ? 'OK  ' : 'KEEP'} ${l.id} ${l.source ?? ''} ${l.ok ? '' : l.errors.join(' | ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
