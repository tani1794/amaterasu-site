// ローカル検証用のサンプルRSS/CSVを生成する（ネットワーク不要）。
// 見出しはすべて架空の【サンプル】で、実在の報道ではない。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const now = Date.now();
const ago = (h) => new Date(now - h * 3600e3);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const rss2 = (title, items) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${esc(title)}</title>
${items.map(([t, d, h, u, src]) => `<item><title><![CDATA[${t}]]></title><link>${u}</link><description><![CDATA[<p>${d}</p>]]></description><pubDate>${ago(h).toUTCString()}</pubDate>${src ? `<source url="https://example.com">${esc(src)}</source>` : ''}</item>`).join('\n')}
</channel></rss>`;

const atom = (title, items) => `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>${esc(title)}</title>
${items.map(([t, d, h, u]) => `<entry><title>${esc(t)}</title><link rel="alternate" href="${u}"/><summary>${esc(d)}</summary><updated>${ago(h).toISOString()}</updated></entry>`).join('\n')}
</feed>`;

const u = (slug) => `https://example.com/sample/${slug}?utm_source=rss`;

const FEEDS = {
  'nhk-intl': rss2('NHK 国際（サンプル）', [
    ['【サンプル】A国とB国の国境で軍事衝突、双方に死者', '架空の国境地帯で砲撃が続き、国連が自制を要請した。', 2, u('border-clash')],
    ['【サンプル】C国で大統領が辞任表明、政権崩壊の懸念', '抗議デモの拡大を受けて大統領が辞任を表明した。', 5, u('c-resign')],
    ['【サンプル】主要国首脳会談で気候変動対策を協議', '首脳会談で排出削減目標について協議した。', 20, u('summit')],
    ['【サンプル】10日前の古い記事（7日窓の外）', '期間外として除外されることを確認する。', 240, u('old')],
  ]),
  'nhk-politics': rss2('NHK 政治（サンプル）', [
    ['【サンプル】首相、臨時国会の召集を表明', '補正予算案の審議に向けて臨時国会を召集する方針。', 3, u('diet')],
    ['【サンプル】与野党、選挙制度改革で協議へ', '衆院選挙制度の見直しに向けた協議を始める。', 30, u('election-reform')],
  ]),
  'nhk-economy': rss2('NHK 経済（サンプル）', [
    ['【サンプル】日銀、政策金利の引き上げを決定', '日銀が金融政策決定会合で利上げを決めた。', 6, u('boj-hike')],
    ['【サンプル】日経平均が急落、下げ幅一時2000円超', '米国株安を受けて東京市場で売りが広がった。', 4, u('nikkei-plunge')],
  ]),
  'bbc-world': rss2('BBC World (sample)', [
    ['[SAMPLE] Missile strikes hit port city as war escalates', 'Fictional sample: officials report missile strikes on a port city.', 1, u('missile-port')],
    ['[SAMPLE] Nuclear talks collapse amid rising tension', 'Fictional sample: negotiations over a nuclear programme ended without a deal.', 8, u('nuclear-talks')],
  ]),
  reuters: rss2('Google News (sample)', [
    ['[SAMPLE] Oil prices jump after supply disruption - Reuters', 'Fictional sample.', 7, u('oil-jump'), 'Reuters'],
    ['[SAMPLE] Missile strikes hit port city as war escalates - Reuters', 'Duplicate title from another outlet should be removed.', 1, u('missile-port-dup'), 'Reuters'],
  ]),
  'techcrunch-ai': rss2('TechCrunch AI (sample)', [
    ['[SAMPLE] OpenAI unveils new reasoning model', 'Fictional sample: a new model release.', 9, u('openai-model')],
    ['[SAMPLE] Mistral raises new funding round at higher valuation', 'Fictional sample: funding news.', 26, u('mistral-funding')],
    ['[SAMPLE] EU regulators open probe into AI chatbot data practices', 'Fictional sample: regulation news.', 50, u('eu-ai-probe')],
  ]),
  'verge-ai': atom('The Verge AI (sample)', [
    ['[SAMPLE] Anthropic and a cloud provider announce partnership', 'Fictional sample: partnership news.', 12, u('anthropic-partner')],
    ['[SAMPLE] DeepSeek releases open-weight model', 'Fictional sample.', 40, u('deepseek-open')],
  ]),
};

// 価格系列（決定的な疑似乱数ウォーク）
function series(start, vol, n, seed, lastShock = 0) {
  let x = start;
  let s = seed;
  const out = [];
  for (let i = n; i >= 1; i--) {
    s = (s * 9301 + 49297) % 233280;
    x *= 1 + ((s / 233280) - 0.5) * vol;
    out.push([new Date(now - i * 864e5).toISOString().slice(0, 10), x]);
  }
  if (lastShock) out[out.length - 1][1] = out[out.length - 2][1] * (1 + lastShock);
  return out;
}
const csv = (rows, dp) => 'Date,Open,High,Low,Close,Volume\n' + rows.map(([d, c]) => `${d},${c.toFixed(dp)},${c.toFixed(dp)},${c.toFixed(dp)},${c.toFixed(dp)},0`).join('\n') + '\n';

const MARKETS = {
  nikkei: csv(series(38000, 0.02, 100, 1, -0.042), 2), // 急落アラートの確認用に最終日 -4.2%
  usdjpy: csv(series(150, 0.006, 100, 2), 3),
  us10y: csv(series(4.2, 0.02, 100, 3), 3),
  wti: csv(series(75, 0.025, 100, 4), 2),
  gold: csv(series(2600, 0.01, 100, 5), 2),
  // topix はわざと用意しない（取得失敗 → 前回値保持の確認用）
};

// 財務省形式（和暦）: jp10y の stooq 失敗 → mof フォールバックの確認用
const mof = ['国債金利情報,,,', '基準日,1年,5年,10年']
  .concat(series(1.5, 0.02, 15, 6).map(([d, c]) => {
    const [y, m, dd] = d.split('-').map(Number);
    return `R${y - 2018}.${m}.${dd},0.5,1.0,${c.toFixed(3)}`;
  }))
  .join('\r\n');

await mkdir(path.join(DIR, 'feeds'), { recursive: true });
await mkdir(path.join(DIR, 'markets'), { recursive: true });
for (const [id, xml] of Object.entries(FEEDS)) await writeFile(path.join(DIR, 'feeds', `${id}.xml`), xml);
for (const [id, c] of Object.entries(MARKETS)) await writeFile(path.join(DIR, 'markets', `${id}.csv`), c);
await writeFile(path.join(DIR, 'markets', 'jgbcm.csv'), mof);
console.log('fixtures generated');
