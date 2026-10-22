// raw-news.json を CoT 5段階フォーマットで分析し、news.json / ai-competitors.json を生成する。
// 分析済み記事は URL ハッシュ（id）でキャッシュし、毎時の新着分だけを Claude に送る。
import { callJson, hasApiKey, MODEL } from './lib/claude.mjs';
import { CATEGORIES, AI_COMPANIES, AI_TYPES, ruleCategory, ruleScore, ruleAiTags } from './lib/classify.mjs';
import { dataPath, readJson, writeJson, truncate, log, DAY_MS, WINDOW_DAYS } from './lib/util.mjs';

const MAX_ANALYZE = Number(process.env.MAX_ANALYZE_PER_RUN || 40);
const BATCH_SIZE = 8;
const PENDING = 'AI分析待ち（APIキー未設定または分析失敗のため、キーワードによる暫定分類です）';

// ---------------- プロンプトとスキーマ ----------------

const SYSTEM = `あなたは国際情勢アナリストです。日本の読者向けに、ニュースの見出しとRSS概要だけを材料として分析します。

# 思考の順序（必ずこの順に考え、各欄に書く）
1. step1_facts: 何が起きたか。見出しと概要から確認できる事実だけを書く。推測を混ぜない。
2. step2_background: なぜ起きたか。一般に知られた背景・経緯から説明する。
3. step3_impact: 日本と世界への影響。日本への影響を必ず含める。
4. step4_scenarios: 楽観・基本・悲観の3シナリオを各1文で。
5. step5_conclusion: 断定的な結論と、読者が取るべき行動を1〜3文で。「〜かもしれない」等の曖昧表現は使わない。

# 危機度スコア crisis_score（1〜10の整数）
- 9-10: 戦争の拡大・核・大規模テロ・金融危機・大災害
- 7-8: 軍事衝突・政権崩壊・市場の急落（3%以上）・重大な制裁
- 4-6: 外交摩擦・重要な選挙・政策金利の変更
- 1-3: 通常の政治経済ニュース
見出しの扇情的な表現に引きずられず、実際の規模と波及度で採点する。

# カテゴリ category
国際政治 / 戦争 / 日本政治 / 経済 / AI のいずれか1つ。武力衝突・軍事作戦は「戦争」、日本の国内政治は「日本政治」、AI企業・AI技術・AI規制は「AI」。

# AI分類（category が AI の場合のみ意味を持つ。それ以外は "その他"）
ai_company: ${AI_COMPANIES.join(' / ')}
ai_type: ${AI_TYPES.join(' / ')}（新モデル・資金調達・提携・規制に当てはまらなければ その他）

# 書式
- すべて自然な日本語。英語記事も日本語に訳して分析する。
- title は日本語の見出し（30〜45文字程度、元見出しの意訳）。
- summary は自分の言葉でポイントを押さえた3行。各行を改行(\\n)で区切り、各行40字以内。元記事の文章をそのまま写さない。
- 入力の id をそのまま返し、入力された全記事を1件ずつ分析する。`;

const str = { type: 'string' };
const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['analyses'],
  properties: {
    analyses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'category', 'crisis_score', 'step1_facts', 'step2_background', 'step3_impact', 'step4_scenarios', 'step5_conclusion', 'summary', 'ai_company', 'ai_type'],
        properties: {
          id: str,
          title: str,
          category: { type: 'string', enum: CATEGORIES },
          crisis_score: { type: 'integer' },
          step1_facts: str,
          step2_background: str,
          step3_impact: str,
          step4_scenarios: {
            type: 'object',
            additionalProperties: false,
            required: ['optimistic', 'base', 'pessimistic'],
            properties: { optimistic: str, base: str, pessimistic: str },
          },
          step5_conclusion: str,
          summary: str,
          ai_company: { type: 'string', enum: AI_COMPANIES },
          ai_type: { type: 'string', enum: AI_TYPES },
        },
      },
    },
  },
};

const OUTLOOK_AREAS = ['国際情勢・安全保障', '日本政治', '経済・金融・投資', 'AI・テクノロジー'];

const OUTLOOK_SYSTEM = `あなたは国際情勢アナリストです。直近1週間の分析結果（危機度順）を統合し、日本の個人・企業が「今後どうすべきか」を断定的な行動指針としてまとめます。
- headline: 今週の情勢を一言で表す見出し（30字以内）
- overview: 全体の結論を2〜3文で断定的に
- areas: ${OUTLOOK_AREAS.join(' / ')} の4分野それぞれについて、stance（一言の方針、15字以内）と actions（具体的な行動を2〜3個、各40字以内、命令形）
- watch: 来週注視すべき点を3つ（各30字以内）
曖昧な表現は避け、入力された分析の根拠に基づいて書く。投資については個別銘柄を推奨しない。`;

const OUTLOOK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'overview', 'areas', 'watch'],
  properties: {
    headline: str,
    overview: str,
    areas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'stance', 'actions'],
        properties: {
          area: { type: 'string', enum: OUTLOOK_AREAS },
          stance: str,
          actions: { type: 'array', items: str },
        },
      },
    },
    watch: { type: 'array', items: str },
  },
};

// ---------------- 変換ヘルパ ----------------

const clampScore = (n) => Math.min(10, Math.max(1, Math.round(Number(n) || 1)));

function baseFields(raw) {
  return { id: raw.id, source: raw.source, source_url: raw.url, published_at: raw.published_at, original_title: raw.title, lang: raw.lang };
}

function ruleItem(raw) {
  const category = ruleCategory(raw.title, raw.description, raw.hint);
  const tags = category === 'AI' ? ruleAiTags(raw.title, raw.description) : { ai_company: 'その他', ai_type: 'その他' };
  return {
    title: raw.title,
    category,
    crisis_score: ruleScore(raw.title, raw.description),
    // RSS概要は転載しない（AI分析の入力にだけ使う）
    step1_facts: PENDING,
    step2_background: PENDING,
    step3_impact: PENDING,
    step4_scenarios: [],
    step5_conclusion: PENDING,
    summary: '',
    ...tags,
    ...baseFields(raw),
    analysis: 'rule',
  };
}

function aiItem(raw, a) {
  return {
    title: a.title || raw.title,
    category: CATEGORIES.includes(a.category) ? a.category : ruleCategory(raw.title, raw.description, raw.hint),
    crisis_score: clampScore(a.crisis_score),
    step1_facts: a.step1_facts,
    step2_background: a.step2_background,
    step3_impact: a.step3_impact,
    step4_scenarios: [`楽観: ${a.step4_scenarios.optimistic}`, `基本: ${a.step4_scenarios.base}`, `悲観: ${a.step4_scenarios.pessimistic}`],
    step5_conclusion: a.step5_conclusion,
    summary: a.summary,
    ai_company: a.category === 'AI' ? a.ai_company : 'その他',
    ai_type: a.category === 'AI' ? a.ai_type : 'その他',
    ...baseFields(raw),
    analysis: 'ai',
    model: MODEL,
    analyzed_at: new Date().toISOString(),
  };
}

function marketAlertItems(markets) {
  return (markets?.alerts || []).map((al) => {
    const pct = al.change_pct.toFixed(2);
    const score = al.change_pct <= -5 ? 8 : 7;
    return {
      id: `market-${al.id}-${al.as_of}`,
      title: `${al.name}が前日比${pct}%の急落`,
      category: '経済',
      crisis_score: score,
      step1_facts: `${al.as_of} の終値ベースで${al.name}が前営業日比${pct}%下落した。`,
      step2_background: '市場データに基づく自動検知です。下落要因は同期間の経済・国際ニュースを参照してください。',
      step3_impact: '株価の3%以上の下落は投資家心理の悪化を通じて為替・金利・実体経済に波及しうる水準です。',
      step4_scenarios: ['楽観: 一時的な調整で数日内に反発する', '基本: 変動の大きい状態がしばらく続く', '悲観: 下落が連鎖し世界的なリスク回避に発展する'],
      step5_conclusion: '急落局面での狼狽売りは避け、自分のリスク許容度とポジションを点検してください。',
      summary: `${al.name}が${pct}%急落\n市場の急変を自動検知\n関連ニュースと併せて確認`,
      ai_company: 'その他',
      ai_type: 'その他',
      source: '市場データ',
      source_url: al.source_url,
      published_at: new Date(`${al.as_of}T06:00:00Z`).toISOString(),
      original_title: '',
      lang: 'ja',
      analysis: 'market',
    };
  });
}

// ANTHROPIC_MOCK=1 用: スキーマに沿ったダミー応答（ローカル検証専用）
function mockAnalyses({ user }) {
  const items = JSON.parse(user.slice(user.indexOf('['))).map((r) => {
    const cat = ruleCategory(r.title, r.description, r.hint);
    return {
      id: r.id, title: `（模擬分析）${r.title}`, category: cat, crisis_score: ruleScore(r.title, r.description),
      step1_facts: `模擬: ${r.title}`, step2_background: '模擬: 背景', step3_impact: '模擬: 日本と世界への影響',
      step4_scenarios: { optimistic: '模擬: 楽観', base: '模擬: 基本', pessimistic: '模擬: 悲観' },
      step5_conclusion: '模擬: 結論。行動指針。', summary: '模擬1行目\n模擬2行目\n模擬3行目',
      ...(cat === 'AI' ? ruleAiTags(r.title, r.description) : { ai_company: 'その他', ai_type: 'その他' }),
    };
  });
  return { analyses: items };
}

function mockOutlook() {
  return {
    headline: '（模擬）緊張の高まりに備える週',
    overview: '模擬の全体結論です。',
    areas: OUTLOOK_AREAS.map((area) => ({ area, stance: '模擬スタンス', actions: ['模擬行動1', '模擬行動2'] })),
    watch: ['模擬注視点1', '模擬注視点2', '模擬注視点3'],
  };
}

// ---------------- AI 分析 ----------------

async function analyzeBatch(batch) {
  const payload = batch.map((r) => ({ id: r.id, title: r.title, description: r.description, source: r.source, published_at: r.published_at, lang: r.lang, hint: r.hint }));
  const user = `以下の${batch.length}件のニュースを分析してください。\n${JSON.stringify(payload, null, 1)}`;
  const out = await callJson({ system: SYSTEM, user, schema: ANALYSIS_SCHEMA, mock: mockAnalyses });
  return new Map((out.analyses || []).map((a) => [a.id, a]));
}

async function buildOutlook(items) {
  const top = items.filter((i) => i.analysis !== 'rule').slice(0, 40).map((i) => ({
    category: i.category, crisis_score: i.crisis_score, title: i.title, conclusion: i.step5_conclusion, published_at: i.published_at,
  }));
  if (!top.length) return null;
  const user = `直近${WINDOW_DAYS}日間の分析結果（危機度順）:\n${JSON.stringify(top, null, 1)}`;
  const o = await callJson({ system: OUTLOOK_SYSTEM, user, schema: OUTLOOK_SCHEMA, maxTokens: 8000, mock: mockOutlook });
  return { ...o, analysis: 'ai', model: MODEL, generated_at: new Date().toISOString() };
}

function ruleOutlook(items) {
  if (!items.length) return null;
  const severe = items.filter((i) => i.crisis_score >= 7);
  const byCat = (c) => items.filter((i) => i.category === c);
  const lead = severe[0];
  return {
    headline: severe.length ? `危機度7以上が${severe.length}件、警戒を強める局面` : '大きな危機は限定的、平常運転を維持',
    overview: severe.length
      ? `直近${WINDOW_DAYS}日で危機度7以上のニュースが${severe.length}件あります。最も深刻なのは「${truncate(lead.title, 40)}」です。情報源を確認しながら備えを優先してください。`
      : `直近${WINDOW_DAYS}日で危機度7以上のニュースはありません。過度に反応せず、定期的な情報確認を続けてください。`,
    areas: [
      { area: '国際情勢・安全保障', stance: byCat('戦争').length ? '警戒を維持' : '平常を維持', actions: ['渡航先の安全情報を外務省の海外安全HPで確認する', '一次情報（政府・国際機関の発表）を優先して確認する'] },
      { area: '日本政治', stance: '政策動向を注視', actions: ['税制・社会保障に関わる法案の審議状況を確認する', '選挙・国会日程を把握しておく'] },
      { area: '経済・金融・投資', stance: '分散を徹底', actions: ['資産配分が自分のリスク許容度に合っているか点検する', '急変時に狼狽売りをしないルールを決めておく'] },
      { area: 'AI・テクノロジー', stance: '動向を継続把握', actions: ['主要AI企業の新モデルと規制動向を週1回確認する', '業務へのAI導入は小さく試して効果を測る'] },
    ],
    watch: severe.slice(0, 3).map((i) => truncate(i.title, 30)).concat(['主要市場の値動き', '各国の政策発表', '紛争地域の情勢']).slice(0, 3),
    analysis: 'rule',
    generated_at: new Date().toISOString(),
  };
}

// ---------------- メイン ----------------

async function main() {
  const raw = await readJson(dataPath('raw-news.json'), { items: [] });
  const prev = await readJson(dataPath('news.json'), { items: [] });
  const markets = await readJson(dataPath('markets.json'), {});
  const now = Date.now();
  const cache = new Map((prev.items || []).filter((i) => i.analysis === 'ai').map((i) => [i.id, i]));

  const items = new Map();
  const todo = [];
  for (const r of raw.items) {
    if (cache.has(r.id)) items.set(r.id, cache.get(r.id));
    else {
      items.set(r.id, ruleItem(r));
      todo.push(r);
    }
  }

  let aiCount = 0;
  let failures = 0;
  const useAi = hasApiKey();
  if (useAi && todo.length) {
    // 危機度（暫定）が高く新しいものを優先して上限件数まで分析
    const queue = todo
      .sort((a, b) => ruleScore(b.title, b.description) - ruleScore(a.title, a.description) || Date.parse(b.published_at) - Date.parse(a.published_at))
      .slice(0, MAX_ANALYZE);
    const batches = [];
    for (let i = 0; i < queue.length; i += BATCH_SIZE) batches.push(queue.slice(i, i + BATCH_SIZE));
    for (let i = 0; i < batches.length; i += 2) {
      await Promise.all(batches.slice(i, i + 2).map(async (batch) => {
        try {
          const result = await analyzeBatch(batch);
          for (const r of batch) {
            const a = result.get(r.id);
            if (a) { items.set(r.id, aiItem(r, a)); aiCount++; }
          }
        } catch (err) {
          failures++;
          log(`AI分析失敗（${batch.length}件はルールベースのまま、次回再試行）: ${err?.message || err}`);
        }
      }));
    }
  } else if (!useAi) {
    log('ANTHROPIC_API_KEY 未設定: ルールベース分析のみ実行');
  }

  const list = [...items.values(), ...marketAlertItems(markets)]
    .filter((i) => now - Date.parse(i.published_at) <= WINDOW_DAYS * DAY_MS)
    .sort((a, b) => b.crisis_score - a.crisis_score || Date.parse(b.published_at) - Date.parse(a.published_at));

  // 「今後どうすべきか」: 新しいAI分析があった時か、前回が古い（6時間超）・ルールベースの時に再生成
  let outlook = prev.outlook || null;
  const stale = !outlook || outlook.analysis !== 'ai' || now - Date.parse(outlook.generated_at) > 6 * 3600e3;
  if (useAi && (aiCount > 0 || stale)) {
    try {
      outlook = (await buildOutlook(list)) || outlook;
    } catch (err) {
      log(`今後の指針の生成に失敗（前回分を保持）: ${err?.message || err}`);
    }
  }
  if (!outlook || (outlook.analysis !== 'ai' && !useAi)) outlook = ruleOutlook(list);

  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, list.filter((i) => i.category === c).length]));
  const analyzed = list.filter((i) => i.analysis === 'ai').length;
  const nowIso = new Date(now).toISOString();

  await writeJson(dataPath('news.json'), {
    updated_at: nowIso,
    window_days: WINDOW_DAYS,
    model: useAi ? MODEL : null,
    analysis_mode: analyzed === 0 ? 'rule' : analyzed === list.filter((i) => i.analysis !== 'market').length ? 'ai' : 'mixed',
    counts: { total: list.length, ai_analyzed: analyzed, severe: list.filter((i) => i.crisis_score >= 7).length, ...counts },
    outlook,
    items: list,
  });

  const aiItems = list.filter((i) => i.category === 'AI');
  const matrix = Object.fromEntries(AI_COMPANIES.map((c) => [c, Object.fromEntries(AI_TYPES.map((t) => [t, 0]))]));
  for (const i of aiItems) matrix[i.ai_company][i.ai_type]++;
  await writeJson(dataPath('ai-competitors.json'), {
    updated_at: nowIso,
    companies: AI_COMPANIES,
    types: AI_TYPES,
    matrix,
    items: aiItems
      .slice()
      .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
      .map(({ id, title, ai_company, ai_type, summary, step5_conclusion, crisis_score, source, source_url, published_at, analysis }) => ({
        id, title, company: ai_company, type: ai_type, summary, conclusion: step5_conclusion, crisis_score, source, source_url, published_at, analysis,
      })),
  });

  log(`analyze: ${list.length} items (AI新規 ${aiCount}, AI累計 ${analyzed}, 未分析 ${todo.length - aiCount}, 失敗バッチ ${failures})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
