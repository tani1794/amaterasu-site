// 共通ユーティリティ（ファイルI/O・HTTP取得・文字列整形）
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
export const FIXTURE_DIR = path.join(ROOT, 'scripts', 'fixtures');
export const USE_FIXTURES = process.argv.includes('--fixtures');

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WINDOW_DAYS = 7;

const UA = 'Mozilla/5.0 (compatible; AmaterasuNewsBot/1.0; +https://github.com/tani1794/Amaterasu)';

export function dataPath(name) {
  return path.join(DATA_DIR, name);
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJson(file, obj) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/** タイムアウト付き fetch。失敗時は例外を投げる。 */
export async function fetchWithTimeout(url, { timeoutMs = 15000, as = 'text', headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (as === 'buffer') return Buffer.from(await res.arrayBuffer());
    if (as === 'json') return await res.json();
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export function sha1(s) {
  return createHash('sha1').update(s).digest('hex').slice(0, 16);
}

/** 追跡パラメータを除いたURL（重複判定・キャッシュキー用） */
export function normalizeUrl(raw) {
  try {
    const u = new URL(raw.trim());
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|at_|cmpid|ref$|rss$)/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return raw.trim();
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function stripHtml(s = '') {
  return String(s)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(s, n) {
  const arr = [...(s || '')];
  return arr.length > n ? arr.slice(0, n - 1).join('') + '…' : arr.join('');
}

export function toIso(d) {
  const t = d ? new Date(d) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toISOString() : null;
}

export function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}
