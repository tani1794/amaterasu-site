// RSS 2.0 / RDF(RSS 1.0) / Atom を共通形式に変換する軽量パーサ
import { XMLParser } from 'fast-xml-parser';
import { stripHtml, toIso } from './util.mjs';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  cdataPropName: false,
  processEntities: true,
  htmlEntities: true,
});

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (x) => (x == null ? '' : typeof x === 'object' ? String(x['#text'] ?? '') : String(x));

function atomLink(link) {
  const links = arr(link);
  const alt = links.find((l) => typeof l === 'object' && (!l['@rel'] || l['@rel'] === 'alternate'));
  return (alt && alt['@href']) || (typeof links[0] === 'string' ? links[0] : links[0]?.['@href']) || '';
}

/** @returns {{title:string, link:string, description:string, published:string|null, source:string}[]} */
export function parseFeed(xml) {
  const doc = parser.parse(xml);
  if (doc.rss?.channel) {
    return arr(doc.rss.channel.item).map((it) => ({
      title: stripHtml(text(it.title)),
      link: text(it.link).trim() || (typeof it.guid === 'string' ? it.guid : text(it.guid)),
      description: stripHtml(text(it.description)),
      published: toIso(text(it.pubDate) || text(it['dc:date'])),
      source: text(it.source),
    }));
  }
  if (doc['rdf:RDF']) {
    return arr(doc['rdf:RDF'].item).map((it) => ({
      title: stripHtml(text(it.title)),
      link: text(it.link).trim(),
      description: stripHtml(text(it.description)),
      published: toIso(text(it['dc:date'])),
      source: '',
    }));
  }
  if (doc.feed) {
    return arr(doc.feed.entry).map((it) => ({
      title: stripHtml(text(it.title)),
      link: atomLink(it.link),
      description: stripHtml(text(it.summary) || text(it.content)),
      published: toIso(text(it.published) || text(it.updated)),
      source: '',
    }));
  }
  throw new Error('未対応のフィード形式');
}
