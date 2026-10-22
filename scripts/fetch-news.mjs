// RSSフィードから直近7日分の見出し・概要・リンクを収集して data/raw-news.json に保存する。
// 本文はコピーせず、RSSが配信する概要も短く切り詰めて「分析の材料」としてのみ使う。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFeed } from './lib/rss.mjs';
import {
  ROOT, FIXTURE_DIR, USE_FIXTURES, DAY_MS, WINDOW_DAYS,
  dataPath, readJson, writeJson, fetchWithTimeout, normalizeUrl, sha1, truncate, log,
} from './lib/util.mjs';

const MAX_PER_FEED = 40;

async function loadFeedXml(feed) {
  if (USE_FIXTURES) {
    return readFile(path.join(FIXTURE_DIR, 'feeds', `${feed.id}.xml`), 'utf8');
  }
  return fetchWithTimeout(feed.url, { timeoutMs: 15000 });
}

function cleanTitle(title, source) {
  // Google News は「見出し - 媒体名」形式なので媒体名を外す
  if (source && title.endsWith(` - ${source}`)) return title.slice(0, -(source.length + 3));
  return title;
}

const titleKey = (t) => t.toLowerCase().replace(/[\s\p{P}]/gu, '').slice(0, 60);

async function main() {
  const { feeds } = JSON.parse(await readFile(path.join(ROOT, 'scripts', 'feeds.json'), 'utf8'));
  const prev = await readJson(dataPath('raw-news.json'), { items: [] });
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const results = await Promise.all(
    feeds.map(async (feed) => {
      const started = Date.now();
      try {
        const items = parseFeed(await loadFeedXml(feed)).slice(0, MAX_PER_FEED);
        return { feed, items, ok: true, ms: Date.now() - started };
      } catch (err) {
        return { feed, items: [], ok: false, error: String(err?.message || err), ms: Date.now() - started };
      }
    }),
  );

  const byUrl = new Map(prev.items.map((it) => [it.url, it]));
  const seenTitles = new Set(prev.items.map((it) => titleKey(it.title)));
  let added = 0;

  for (const { feed, items } of results) {
    for (const it of items) {
      if (!it.title || !/^https?:\/\//.test(it.link)) continue;
      const url = normalizeUrl(it.link);
      const title = cleanTitle(it.title, it.source);
      const key = titleKey(title);
      if (byUrl.has(url) || seenTitles.has(key)) continue;
      const published = it.published || nowIso;
      if (now - Date.parse(published) > WINDOW_DAYS * DAY_MS) continue;
      byUrl.set(url, {
        id: sha1(url),
        title: truncate(title, 160),
        description: truncate(it.description === title ? '' : it.description, 200),
        url,
        source: it.source || feed.name,
        feed_id: feed.id,
        lang: feed.lang,
        hint: feed.hint,
        published_at: published,
        first_seen_at: nowIso,
      });
      seenTitles.add(key);
      added++;
    }
  }

  const items = [...byUrl.values()]
    .filter((it) => now - Date.parse(it.published_at) <= WINDOW_DAYS * DAY_MS)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));

  await writeJson(dataPath('raw-news.json'), { updated_at: nowIso, window_days: WINDOW_DAYS, count: items.length, items });

  const fetchLog = await readJson(dataPath('fetch-log.json'), {});
  fetchLog.news = {
    updated_at: nowIso,
    fixtures: USE_FIXTURES,
    feeds: results.map(({ feed, items: its, ok, error, ms }) => ({
      id: feed.id, name: feed.name, ok, count: its.length, ms, ...(error ? { error } : {}),
    })),
  };
  await writeJson(dataPath('fetch-log.json'), fetchLog);

  const failed = results.filter((r) => !r.ok);
  for (const r of failed) log(`SKIP ${r.feed.id}: ${r.error}`);
  log(`news: ${results.length - failed.length}/${results.length} feeds OK, +${added} new, ${items.length} items in ${WINDOW_DAYS}-day window`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
