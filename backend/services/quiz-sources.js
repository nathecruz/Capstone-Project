// What an AI Practice Quiz is made from (the Rewards Shop's quiz maker): a file (PDF, DOCX or PPTX),
// a link (a web page, or a YouTube video's captions), a recording (MP3, MP4, M4A or WAV, turned
// into text by the AI service), or text typed or pasted in the app. Only the text is kept, up to
// SOURCE_WORDS words: a file is read in memory and never stored.
//
// A link is opened by this server, so it may only reach the public internet: every address the
// host resolves to must be public (checked on the connection itself, so a DNS answer cannot change
// between the check and the request), on the default port, with at most MAX_REDIRECTS redirects.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { getDocumentProxy } from 'unpdf';

/** About how much a quiz can be made from: the AI reads it all, and so can the student. */
export const SOURCE_WORDS = 1500;
export const DOCUMENT_BYTES = 10 * 1024 * 1024;
/** The AI service's upload limit for a recording. */
export const RECORDING_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.pptx'];
export const RECORDING_EXTENSIONS = ['.mp3', '.mp4', '.m4a', '.wav'];
const PDF_PAGES = 80;
const LINK_BYTES = 3 * 1024 * 1024;
const LINK_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
// No part of a real document or slide deck is this big; a bigger one is a zip bomb.
const ZIP_PART_BYTES = 25 * 1024 * 1024;

/** A problem the student can fix (a file or link HabitAI cannot read), with its HTTP status. */
export class SourceError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'SourceError';
    this.status = status;
  }
}

export const wordsOf = (text) => (String(text ?? '').match(/\S+/g) ?? []).length;

/** The text with tidy spacing (paragraphs kept), cut after `limit` words. */
export function clipWords(raw, limit = SOURCE_WORDS) {
  const text = String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const pattern = /\S+/g;
  let words = 0;
  let end = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    words += 1;
    if (words === limit) end = match.index + match[0].length;
  }
  if (words <= limit) return { text, words, truncated: false };
  return { text: text.slice(0, end).trim(), words: limit, truncated: true };
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', middot: '·', bull: '•', deg: '°', copy: '©', reg: '®', trade: '™', times: '×', divide: '÷',
};

export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

// ---------------------------------------------------------------------------
// Files

/**
 * What a file is, from its name and its first bytes (a renamed file is refused): 'pdf', 'docx',
 * 'pptx', 'mp3', 'mp4', 'm4a' or 'wav', else null.
 */
export function fileKind(name, bytes) {
  const extension = path.extname(String(name ?? '')).toLowerCase();
  const head = Buffer.from(bytes.subarray(0, 1024));
  const ascii = (start, end) => head.subarray(start, end).toString('latin1');
  switch (extension) {
    case '.pdf': return head.toString('latin1').includes('%PDF-') ? 'pdf' : null;
    case '.docx':
    case '.pptx': return ascii(0, 4) === 'PK\u0003\u0004' ? extension.slice(1) : null;
    case '.mp3': return ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) ? 'mp3' : null;
    case '.mp4':
    case '.m4a': return ascii(4, 8) === 'ftyp' ? extension.slice(1) : null;
    case '.wav': return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE' ? 'wav' : null;
    default: return null;
  }
}

export const isRecordingKind = (kind) => ['mp3', 'mp4', 'm4a', 'wav'].includes(kind);

/** The parts of a zip (DOCX, PPTX) whose names `wanted` accepts, or null when it is not a zip. */
function zipParts(bytes, wanted) {
  try {
    // A part's size is read from the zip, and nothing past it is unpacked.
    return unzipSync(new Uint8Array(bytes), { filter: (file) => wanted(file.name) && file.originalSize <= ZIP_PART_BYTES });
  } catch {
    return null;
  }
}

/** The text of `tag` runs (w:t, a:t), one paragraph per line. */
function xmlRuns(xml, paragraphEnd, runTag) {
  const run = new RegExp(`<${runTag}(?:\\s[^>]*)?>([^<]*)</${runTag}>`, 'g');
  return xml
    .split(paragraphEnd)
    .map((paragraph) => decodeEntities([...paragraph.matchAll(run)].map((match) => match[1]).join('')).trim())
    .filter(Boolean)
    .join('\n');
}

export function textFromDocx(bytes) {
  const xml = zipParts(bytes, (name) => name === 'word/document.xml')?.['word/document.xml'];
  if (!xml) return null;
  // A tab or a line break inside a paragraph becomes a space or a new line.
  const body = strFromU8(xml).replace(/<w:tab\/>/g, '<w:t> </w:t>').replace(/<w:br\/>/g, '<w:t>\n</w:t>');
  return xmlRuns(body, /<\/w:p>/, 'w:t');
}

export function textFromPptx(bytes) {
  const parts = zipParts(bytes, (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  if (!parts) return null;
  const number = (name) => Number(name.match(/slide(\d+)\.xml$/)[1]);
  const slides = Object.keys(parts).sort((left, right) => number(left) - number(right));
  if (!slides.length) return null;
  return slides.map((name) => xmlRuns(strFromU8(parts[name]), /<\/a:p>/, 'a:t')).filter(Boolean).join('\n\n');
}

/** The text of a PDF's pages, read until there is enough for a quiz (a scanned PDF has none). */
export async function textFromPdf(bytes) {
  // A PDF from a student is untrusted: pdf.js must never compile code from its fonts.
  const document = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false });
  try {
    const pages = [];
    let words = 0;
    for (let number = 1; number <= Math.min(document.numPages, PDF_PAGES) && words <= SOURCE_WORDS; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '')).join('');
      pages.push(text);
      words += wordsOf(text);
    }
    return pages.join('\n\n');
  } finally {
    // Frees the parsed document (the method is not on every pdf.js build).
    await Promise.resolve(typeof document.destroy === 'function' ? document.destroy() : undefined).catch(() => {});
  }
}

/** The text of a document file ('pdf', 'docx' or 'pptx'). */
export async function textFromDocument(kind, bytes) {
  try {
    if (kind === 'pdf') return await textFromPdf(bytes);
    if (kind === 'docx') return textFromDocx(bytes);
    if (kind === 'pptx') return textFromPptx(bytes);
  } catch {
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Links

const PRIVATE_IPV4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const ipv4Value = (address) => address.split('.').reduce((value, part) => value * 256 + Number(part), 0);

/** The eight 16-bit words of an IPv6 address (an IPv4 tail, as in ::ffff:1.2.3.4, included). */
function ipv6Words(address) {
  let text = address.toLowerCase().split('%')[0];
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const value = ipv4Value(tail[1]);
    text = text.slice(0, -tail[1].length) + `${Math.floor(value / 65536).toString(16)}:${(value % 65536).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = rest === undefined ? [] : rest ? rest.split(':') : [];
  const words = rest === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return words.map((word) => Number.parseInt(word || '0', 16));
}

/** Whether an IP address is on the public internet (not private, loopback, link-local and the like). */
export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const value = ipv4Value(address);
    return !PRIVATE_IPV4.some(([base, bits]) => Math.floor(value / 2 ** (32 - bits)) === Math.floor(ipv4Value(base) / 2 ** (32 - bits)));
  }
  if (family !== 6) return false;
  const words = ipv6Words(address);
  const embedded = () => `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`;
  // ::, ::1 and IPv4 inside IPv6 (::a.b.c.d, ::ffff:a.b.c.d): judged as the IPv4 address.
  if (words.slice(0, 5).every((word) => word === 0) && (words[5] === 0 || words[5] === 0xffff)) {
    return words[5] === 0 && words[6] === 0 ? false : isPublicAddress(embedded());
  }
  const [first, second] = words;
  if (first === 0x64 && second === 0xff9b) return false; // NAT64
  if (first === 0x2001 && (second === 0 || second === 0xdb8)) return false; // Teredo, documentation
  if (first === 0x2002) return false; // 6to4
  if (first === 0x100 && second === 0) return false; // discard
  if ((first & 0xfe00) === 0xfc00) return false; // unique local
  if ((first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0) return false; // link-local, site-local
  if ((first & 0xff00) === 0xff00) return false; // multicast
  return (first & 0xe000) === 0x2000; // global unicast
}

/** DNS lookup for a link's connection: every address must be public, or none is used. */
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || !addresses.every((entry) => isPublicAddress(entry.address))) {
      return callback(Object.assign(new Error('The link points to a private address.'), { code: 'PRIVATE_ADDRESS' }));
    }
    if (options?.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

const BLOCKED_LINK = 'This link cannot be opened from HabitAI. Try a public web page, or download the file and choose File.';

/** A link the server may open: http or https, no user name, no port, and not a private host. */
export function parseLink(raw) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new SourceError('Enter the full link, starting with https://', 400);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SourceError('Only http and https links can be read.', 400);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.username || url.password || url.port || !host) throw new SourceError(BLOCKED_LINK, 400);
  if (net.isIP(host) ? !isPublicAddress(host) : !host.includes('.') || /\.(local|internal|localhost)$/i.test(host)) throw new SourceError(BLOCKED_LINK, 400);
  return url;
}

const READABLE_TYPE = /text\/html|application\/xhtml\+xml|text\/plain|text\/xml|application\/xml/;

function requestOnce(url, { headers, maxBytes, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle(value);
    };
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(url, {
      method: 'GET',
      lookup: publicLookup,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HabitAI quiz maker)', Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'Accept-Language': 'en,fil;q=0.8', ...headers },
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        return finish(resolve, { redirect: String(response.headers.location) });
      }
      if (status >= 400) {
        response.resume();
        return finish(reject, new SourceError(status === 404 ? 'That page was not found. Check the link.' : `The page could not be opened (it answered HTTP ${status}).`, 502));
      }
      const type = String(response.headers['content-type'] ?? '').toLowerCase();
      if (type && !READABLE_TYPE.test(type)) {
        response.resume();
        return finish(reject, new SourceError('This link is not a web page HabitAI can read. Download the file and choose File instead.'));
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        // More than enough for a quiz: keep what came, and stop.
        if (size + chunk.length > maxBytes) {
          chunks.push(chunk.subarray(0, maxBytes - size));
          size = maxBytes;
          finish(resolve, { body: Buffer.concat(chunks).toString('utf8'), type });
          request.destroy();
          return;
        }
        chunks.push(chunk);
        size += chunk.length;
      });
      response.on('end', () => finish(resolve, { body: Buffer.concat(chunks).toString('utf8'), type }));
      response.on('error', () => finish(reject, new SourceError('HabitAI could not read this link. Try again.', 502)));
    });
    const timer = setTimeout(() => {
      finish(reject, new SourceError('The page took too long to answer. Try again, or paste its text.', 504));
      request.destroy();
    }, timeoutMs);
    request.on('error', (error) => finish(reject, error?.code === 'PRIVATE_ADDRESS' ? new SourceError(BLOCKED_LINK, 400) : new SourceError('HabitAI could not open this link. Check it and try again.', 502)));
    request.end();
  });
}

/** Opens a public link (following a few redirects): { url, body, type }. */
export async function fetchPage(link, { headers = {}, maxBytes = LINK_BYTES, timeoutMs = LINK_TIMEOUT_MS } = {}) {
  let url = parseLink(link);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await requestOnce(url, { headers, maxBytes, timeoutMs });
    if (!result.redirect) return { url, ...result };
    url = parseLink(new URL(result.redirect, url).toString());
  }
  throw new SourceError('This link redirects too many times.', 502);
}

const HTML_BYTES = 1_500_000;
const UNREAD_TAGS = ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'canvas', 'form', 'select', 'button', 'object'];
const AROUND_TAGS = ['nav', 'header', 'footer', 'aside'];

/**
 * The page without the given elements (and comments), in one pass: a page that never closes one
 * loses the rest, and no page can make this slow (no backtracking patterns).
 */
function withoutElements(html, tags) {
  const lower = html.toLowerCase();
  let kept = '';
  let index = 0;
  while (index < html.length) {
    const open = lower.indexOf('<', index);
    if (open < 0) {
      kept += html.slice(index);
      break;
    }
    kept += html.slice(index, open);
    const comment = lower.startsWith('<!--', open);
    const tag = comment ? null : tags.find((name) => lower.startsWith(`<${name}`, open) && !/[\w-]/.test(lower[open + name.length + 1] ?? ''));
    if (!comment && !tag) {
      kept += '<';
      index = open + 1;
      continue;
    }
    const close = lower.indexOf(comment ? '-->' : `</${tag}`, open + 1);
    if (close < 0) break;
    const end = comment ? close + 3 : lower.indexOf('>', close);
    if (end < 0) break;
    kept += ' ';
    index = comment ? end : end + 1;
  }
  return kept;
}

/** The part of a page between the first `<tag` and the last `</tag>`, or null. */
function outerPart(html, tag) {
  const lower = html.toLowerCase();
  const start = lower.indexOf(`<${tag}`);
  const end = lower.lastIndexOf(`</${tag}>`);
  return start >= 0 && end > start ? html.slice(start, end + tag.length + 3) : null;
}

/** The readable text of a web page: its article or main part when it has one, without scripts and menus. */
export function textFromHtml(html) {
  const source = String(html ?? '').slice(0, HTML_BYTES);
  const lower = source.toLowerCase();
  const titleStart = lower.indexOf('<title');
  const titleOpenEnd = titleStart < 0 ? -1 : lower.indexOf('>', titleStart);
  const titleEnd = titleOpenEnd < 0 ? -1 : lower.indexOf('</title', titleOpenEnd);
  const title = titleEnd < 0 ? '' : decodeEntities(source.slice(titleOpenEnd + 1, titleEnd).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
  const plain = (markup) => decodeEntities(markup
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre|dd|dt|figcaption)>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' '));
  let body = withoutElements(source, UNREAD_TAGS);
  const main = outerPart(body, 'article') ?? outerPart(body, 'main');
  body = main && wordsOf(plain(main)) >= 80 ? main : withoutElements(body, AROUND_TAGS);
  return { title, text: clipWords(plain(body), Number.MAX_SAFE_INTEGER).text };
}

/** A YouTube link's video id, else null. */
export function youtubeVideoId(url) {
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1];
  }
  return id && /^[\w-]{6,20}$/.test(id) ? id : null;
}

/** The JSON array that starts at `from` in a page, read bracket by bracket (strings respected). */
function jsonArrayAt(text, from) {
  const start = text.indexOf('[', from);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** A YouTube watch page's caption tracks: [{ baseUrl, languageCode, kind }]. */
export function captionTracks(html) {
  const at = String(html ?? '').indexOf('"captionTracks":');
  const tracks = at < 0 ? null : jsonArrayAt(html, at);
  return Array.isArray(tracks) ? tracks.filter((track) => typeof track?.baseUrl === 'string') : [];
}

/** The captions to read: English or Filipino first, and of those, ones written by a person before automatic ones. */
export function pickCaptionTrack(tracks) {
  const rank = (track) => (/^(en|fil|tl)/i.test(track.languageCode ?? '') ? 0 : 2) + (track.kind === 'asr' ? 1 : 0);
  return [...tracks].sort((left, right) => rank(left) - rank(right))[0] ?? null;
}

export function youtubeTitle(html) {
  const fromDetails = String(html ?? '').match(/"videoDetails":\{[^}]*?"title":"((?:[^"\\]|\\.)*)"/)?.[1];
  if (fromDetails) {
    try {
      return JSON.parse(`"${fromDetails}"`);
    } catch {
      // the page title below
    }
  }
  return textFromHtml(html).title.replace(/\s*-\s*YouTube$/, '');
}

/** The words of a caption file (YouTube's XML formats), in order. */
export function textFromCaptionXml(xml) {
  return [...String(xml ?? '').matchAll(/<(text|p)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((match) => decodeEntities(decodeEntities(match[2].replace(/<[^>]+>/g, ''))).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

const NO_CAPTIONS = 'This video has no captions HabitAI can read. Paste its transcript as Text instead.';

async function readYoutube(videoId) {
  // The consent cookie skips the cookie notice some regions get instead of the page.
  const watch = await fetchPage(`https://www.youtube.com/watch?v=${videoId}&hl=en`, { headers: { Cookie: 'CONSENT=YES+1' } });
  const track = pickCaptionTrack(captionTracks(watch.body));
  if (!track) throw new SourceError(NO_CAPTIONS);
  const captions = await fetchPage(track.baseUrl);
  const text = textFromCaptionXml(captions.body);
  if (!text) throw new SourceError(NO_CAPTIONS);
  return { name: youtubeTitle(watch.body) || 'YouTube video', text };
}

/** The text behind a link: a web page's, or a YouTube video's captions. */
export async function readLink(link) {
  const url = parseLink(link);
  const videoId = youtubeVideoId(url);
  if (videoId) return readYoutube(videoId);
  const page = await fetchPage(url.toString());
  const { title, text } = /text\/plain/.test(page.type) ? { title: '', text: page.body } : textFromHtml(page.body);
  return { name: title || page.url.hostname, text };
}
