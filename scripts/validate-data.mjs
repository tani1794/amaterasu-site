// data/*.json の形式チェック。1件でも不正があれば終了コード1（CIではコミットしない）。
import { dataPath, readJson } from './lib/util.mjs';
import { CATEGORIES, AI_COMPANIES, AI_TYPES } from './lib/classify.mjs';

const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const isIso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const isUrl = (s) => typeof s === 'string' && /^https?:\/\/\S+$/.test(s);
const isStr = (s) => typeof s === 'string';

async function load(name) {
  const j = await readJson(dataPath(name));
  if (!j || typeof j !== 'object') fail(name, 'JSONとして読み込めない');
  return j || {};
}

const news = await load('news.json');
if (!isIso(news.updated_at)) fail('news.json', 'updated_at が不正');
if (!Array.isArray(news.items)) fail('news.json', 'items が配列でない');
let prevScore = Infinity;
for (const [i, it] of (news.items || []).entries()) {
  const w = `news.items[${i}]`;
  for (const k of ['id', 'title', 'step1_facts', 'step2_background', 'step3_impact', 'step5_conclusion', 'summary', 'source']) if (!isStr(it[k])) fail(w, `${k} が文字列でない`);
  if (!CATEGORIES.includes(it.category)) fail(w, `category 不正: ${it.category}`);
  if (!Number.isInteger(it.crisis_score) || it.crisis_score < 1 || it.crisis_score > 10) fail(w, `crisis_score 不正: ${it.crisis_score}`);
  if (it.crisis_score > prevScore) fail(w, 'crisis_score の降順になっていない');
  prevScore = it.crisis_score;
  if (!Array.isArray(it.step4_scenarios) || !it.step4_scenarios.every(isStr)) fail(w, 'step4_scenarios が文字列配列でない');
  if (it.analysis === 'ai' && it.step4_scenarios.length !== 3) fail(w, 'AI分析の step4_scenarios が3件でない');
  if (!isUrl(it.source_url)) fail(w, `source_url 不正: ${it.source_url}`);
  if (!isIso(it.published_at)) fail(w, 'published_at が不正');
  if (!['ai', 'rule', 'market'].includes(it.analysis)) fail(w, `analysis 不正: ${it.analysis}`);
}
if (news.outlook) {
  const o = news.outlook;
  if (!isStr(o.headline) || !isStr(o.overview) || !Array.isArray(o.areas) || !Array.isArray(o.watch)) fail('news.outlook', '構造が不正');
  for (const a of o.areas || []) if (!isStr(a.area) || !isStr(a.stance) || !Array.isArray(a.actions)) fail('news.outlook.areas', '構造が不正');
}

const markets = await load('markets.json');
if (!Array.isArray(markets.instruments)) fail('markets.json', 'instruments が配列でない');
for (const m of markets.instruments || []) {
  const w = `markets.${m.id}`;
  if (!isStr(m.id) || !isStr(m.name)) fail(w, 'id/name 不正');
  if (m.value !== null && typeof m.value !== 'number') fail(w, 'value 不正');
  if (typeof m.stale !== 'boolean') fail(w, 'stale 不正');
  if (!Array.isArray(m.history) || !m.history.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.d) && typeof p.c === 'number')) fail(w, 'history 不正');
}

const ai = await load('ai-competitors.json');
if (!Array.isArray(ai.items)) fail('ai-competitors.json', 'items が配列でない');
for (const [i, it] of (ai.items || []).entries()) {
  if (!AI_COMPANIES.includes(it.company)) fail(`ai.items[${i}]`, `company 不正: ${it.company}`);
  if (!AI_TYPES.includes(it.type)) fail(`ai.items[${i}]`, `type 不正: ${it.type}`);
  if (!isUrl(it.source_url)) fail(`ai.items[${i}]`, 'source_url 不正');
}

if (errors.length) {
  console.error(`検証エラー ${errors.length} 件:\n` + errors.slice(0, 50).join('\n'));
  process.exit(1);
}
console.log(`validate: OK (news ${news.items.length}, markets ${markets.instruments.length}, ai ${ai.items.length})`);
