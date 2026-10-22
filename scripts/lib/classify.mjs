// APIキーが無い／AI分析に失敗した場合のルールベース分類（キーワード辞書）

export const CATEGORIES = ['国際政治', '戦争', '日本政治', '経済', 'AI'];

export const AI_COMPANIES = ['OpenAI', 'Google', 'Anthropic', 'Meta', 'xAI', 'DeepSeek', 'Mistral', 'Microsoft', 'Apple', 'Amazon', 'NVIDIA', 'その他'];
export const AI_TYPES = ['新モデル', '資金調達', '提携', '規制', 'その他'];

const has = (text, words) => {
  const lower = text.toLowerCase();
  return words.some((w) => (w instanceof RegExp ? w.test(text) : lower.includes(w.toLowerCase())));
};

const KW = {
  ai: [/\bAI\b/, /\bLLM/, /\bGPT-?\d/i, 'ChatGPT', 'OpenAI', 'Anthropic', 'Claude', 'Gemini', 'DeepMind', 'DeepSeek', 'Mistral', /\bxAI\b/, 'Grok', 'Llama', '生成AI', '人工知能', 'artificial intelligence', 'chatbot'],
  war: [/\bwar\b/i, 'missile', 'airstrike', 'air strike', 'drone strike', 'shelling', 'invasion', 'troops', 'ceasefire', 'military', 'Hamas', 'Hezbollah', 'Gaza', 'Ukraine', '戦争', '紛争', 'ミサイル', '空爆', '侵攻', '停戦', '軍事', '砲撃', '戦闘', '攻撃'],
  jpPolitics: ['首相', '総理', '国会', '衆院', '参院', '衆議院', '参議院', '内閣', '自民', '立憲', '公明', '維新', '国民民主', '与党', '野党', '官房長官', '閣議', /Japan('s)? (prime minister|PM|Diet|government)/i, /\bLDP\b/, 'Takaichi', 'Ishiba', 'Kishida'],
  economy: ['株', '日経平均', 'TOPIX', '円安', '円高', '為替', '日銀', '金利', '利上げ', '利下げ', '物価', 'インフレ', 'GDP', '関税', '決算', '国債', /\bstocks?\b/i, 'market', 'inflation', 'interest rate', 'central bank', /\bFed\b/, 'tariff', 'recession', 'bond', 'yield', 'oil price', 'economy', 'earnings'],
};

// [正規表現/語, スコア]。最大値を採用する。
const SCORE_RULES = [
  [['nuclear', '核兵器', '核攻撃', '核実験', 'radiation leak', '放射能', 'world war', '大規模テロ', 'mass shooting', 'terror attack', 'テロ', 'financial crisis', '金融危機', 'bank run', 'tsunami', '津波', 'magnitude 7', 'magnitude 8', 'マグニチュード7', 'マグニチュード8', '大震災', 'pandemic', 'declares war', '宣戦布告'], 9],
  [['airstrike', 'air strike', 'missile', 'invasion', 'ミサイル', '空爆', '侵攻', 'killed', '死亡', '死者', 'coup', 'クーデター', 'collapse', '崩壊', 'sanction', '制裁', 'plunge', 'crash', '急落', '暴落', 'martial law', '戒厳令', 'earthquake', '地震', 'hurricane', 'typhoon', '台風', 'clashes', '衝突', 'resign', '辞任', '総辞職'], 7],
  [['election', '選挙', 'rate hike', 'rate cut', '利上げ', '利下げ', '政策金利', 'tariff', '関税', 'protest', '抗議', 'diplomatic', '外交', 'summit', '首脳会談', 'talks', '協議', 'ceasefire', '停戦', 'tension', '緊張', 'regulation', '規制', 'lawsuit', '訴訟'], 5],
];

export function ruleCategory(title, desc, hint) {
  const t = `${title} ${desc}`;
  if (has(t, KW.ai)) return 'AI';
  if (has(t, KW.war)) return '戦争';
  if (has(t, KW.jpPolitics)) return '日本政治';
  if (hint && CATEGORIES.includes(hint) && hint !== '国際政治') return hint;
  if (has(t, KW.economy)) return '経済';
  return hint && CATEGORIES.includes(hint) ? hint : '国際政治';
}

export function ruleScore(title, desc) {
  const t = `${title} ${desc}`.toLowerCase();
  let score = 2;
  for (const [words, s] of SCORE_RULES) {
    if (words.some((w) => t.includes(w.toLowerCase()))) score = Math.max(score, s);
  }
  return score;
}

const COMPANY_RULES = [
  ['OpenAI', ['OpenAI', 'ChatGPT', 'GPT-', 'Sora', 'Altman']],
  ['Anthropic', ['Anthropic', 'Claude']],
  ['Google', ['Google', 'Gemini', 'DeepMind', 'Alphabet']],
  ['Meta', ['Meta ', 'Meta’s', "Meta's", 'Llama', 'Zuckerberg']],
  ['xAI', ['xAI', 'Grok', 'Musk']],
  ['DeepSeek', ['DeepSeek']],
  ['Mistral', ['Mistral']],
  ['Microsoft', ['Microsoft', 'Copilot']],
  ['NVIDIA', ['Nvidia', 'NVIDIA']],
  ['Apple', ['Apple']],
  ['Amazon', ['Amazon', 'AWS']],
];

const TYPE_RULES = [
  ['資金調達', ['raises', 'funding', 'valuation', 'investment', 'invest', 'IPO', '資金調達', '出資', '評価額', 'billion round']],
  ['規制', ['regulat', 'law', 'ban', 'lawsuit', 'court', 'antitrust', 'EU AI Act', '規制', '法案', '訴訟', 'copyright', 'policy']],
  ['提携', ['partner', 'deal', 'agreement', 'acquire', 'acquisition', 'teams up', '提携', '買収', '契約']],
  ['新モデル', ['launch', 'release', 'unveil', 'introduc', 'model', 'new version', '発表', '公開', 'リリース', '新モデル']],
];

export function ruleAiTags(title, desc) {
  const t = `${title} ${desc}`;
  const company = COMPANY_RULES.find(([, ws]) => ws.some((w) => t.includes(w)))?.[0] ?? 'その他';
  const type = TYPE_RULES.find(([, ws]) => ws.some((w) => t.toLowerCase().includes(w.toLowerCase())))?.[0] ?? 'その他';
  return { ai_company: company, ai_type: type };
}
