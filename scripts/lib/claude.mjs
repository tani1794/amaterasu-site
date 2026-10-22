// Anthropic API 呼び出し（構造化出力 JSON schema）。APIキーは環境変数からのみ読む。
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.ANALYSIS_MODEL || 'claude-sonnet-5-5';
const EFFORT = process.env.ANALYSIS_EFFORT || 'medium';

let client = null;
let fallbacksSupported = true;

export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY) || process.env.ANTHROPIC_MOCK === '1';
}

/**
 * system + user テキストを送り、schema に沿った JSON を返す。
 * 安全分類器による拒否時は server-side fallback（fallbacks: "default"）で別モデルが応答する。
 * @param {(req:{system:string,user:string,schema:object})=>object} [mock] ANTHROPIC_MOCK=1 時の代替応答
 */
export async function callJson({ system, user, schema, maxTokens = 16000, mock }) {
  if (process.env.ANTHROPIC_MOCK === '1') {
    if (!mock) throw new Error('mock 応答が未定義');
    return mock({ system, user, schema });
  }
  client ??= new Anthropic({ maxRetries: 3, timeout: 5 * 60 * 1000 });

  const base = {
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema } },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  };

  let res;
  if (fallbacksSupported) {
    try {
      res = await client.beta.messages.create({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    } catch (err) {
      // fallbacks が使えない環境（組織設定など）では通常リクエストに切り替える
      if (!(err instanceof Anthropic.BadRequestError) || !/fallback/i.test(err.message)) throw err;
      fallbacksSupported = false;
    }
  }
  res ??= await client.messages.create(base);

  if (res.stop_reason === 'refusal') throw new Error(`refusal (${res.stop_details?.category ?? 'unknown'})`);
  if (res.stop_reason === 'max_tokens') throw new Error('max_tokens に到達し出力が途切れた');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}
