// What a practice quiz is made from (services/quiz-sources.js): the text of a DOCX, PPTX or PDF
// file, of a web page or a YouTube video's captions, cut to 1,500 words; and links that may only
// reach the public internet.
import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import {
  SourceError,
  captionTracks,
  clipWords,
  decodeEntities,
  fileKind,
  isPublicAddress,
  parseLink,
  pickCaptionTrack,
  readLink,
  textFromCaptionXml,
  textFromDocument,
  textFromDocx,
  textFromHtml,
  textFromPptx,
  youtubeTitle,
  youtubeVideoId,
} from '../services/quiz-sources.js';

const docx = (paragraphs) => Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<Types/>'),
  'word/document.xml': strToU8(`<w:document><w:body>${paragraphs.map((runs) => `<w:p>${runs.map((run) => (run === '\t' ? '<w:r><w:tab/></w:r>' : `<w:r><w:t xml:space="preserve">${run}</w:t></w:r>`)).join('')}</w:p>`).join('')}<w:tbl><w:tr><w:tc><w:p><w:r><w:t>In a table</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`),
}));

const pptx = (slides) => Buffer.from(zipSync(Object.fromEntries(slides.map((lines, index) => [
  `ppt/slides/slide${index + 1}.xml`,
  strToU8(`<p:sld><p:cSld><p:spTree>${lines.map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`).join('')}</p:spTree></p:cSld></p:sld>`),
]))));

/** A one-page PDF with these lines of text (built by hand: header, objects, cross-reference table). */
function pdf(lines) {
  const content = `BT /F1 12 Tf 72 720 Td ${lines.map((line, index) => `${index ? '0 -16 Td ' : ''}(${line}) Tj`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let text = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = text.length;
    text += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text, 'latin1');
}

test('text is cut after 1,500 words, with its paragraphs kept', () => {
  const words = Array.from({ length: 1600 }, (_, index) => `w${index}`);
  const clipped = clipWords(`${words.slice(0, 3).join('  ')}\r\n\r\n\r\n\t${words.slice(3).join(' ')}`);
  assert.deepEqual([clipped.words, clipped.truncated, clipped.text.split(/\s+/).at(-1)], [1500, true, 'w1499']);
  assert.ok(clipped.text.startsWith('w0 w1 w2\n\nw3'));
  assert.deepEqual(clipWords('  A short   note. '), { text: 'A short note.', words: 3, truncated: false });
  assert.equal(decodeEntities('Tom &amp; Jerry &mdash; &#8220;fun&#x201D; &unknown;'), 'Tom & Jerry — “fun” &unknown;');
});

test('a file is what its name says only when its first bytes agree', () => {
  assert.equal(fileKind('Reviewer.DOCX', docx([['Hi']])), 'docx');
  assert.equal(fileKind('Slides.pptx', pptx([['Hi']])), 'pptx');
  assert.equal(fileKind('Notes.pdf', pdf(['Hi'])), 'pdf');
  assert.equal(fileKind('Lecture.mp3', Buffer.from('ID3\u0004\u0000\u0000\u0000', 'latin1')), 'mp3');
  assert.equal(fileKind('Lecture.m4a', Buffer.from('\u0000\u0000\u0000\u0018ftypM4A ', 'latin1')), 'm4a');
  assert.equal(fileKind('Class.mp4', Buffer.from('\u0000\u0000\u0000\u0018ftypisom', 'latin1')), 'mp4');
  assert.equal(fileKind('Voice.wav', Buffer.from('RIFF$\u0000\u0000\u0000WAVEfmt ', 'latin1')), 'wav');
  assert.equal(fileKind('Renamed.pdf', docx([['Hi']])), null, 'a DOCX renamed to .pdf');
  assert.equal(fileKind('Program.exe', Buffer.from('MZ')), null);
});

test('a DOCX, PPTX or PDF is read as its text, one paragraph or slide at a time', async () => {
  assert.equal(textFromDocx(docx([['Photo', 'synthesis &amp; light'], ['Chlorophyll', '\t', 'is green']])), 'Photosynthesis & light\nChlorophyll is green\nIn a table');
  assert.equal(textFromPptx(pptx([['Cells'], ['Mitosis', 'Meiosis'], [], ['DNA']].slice(0, 2).concat([['DNA']]))), 'Cells\n\nMitosis\nMeiosis\n\nDNA');
  // Slide 10 comes after slide 2.
  const slides = pptx(Array.from({ length: 10 }, (_, index) => [`Slide ${index + 1}`]));
  assert.equal(textFromPptx(slides).split('\n\n').at(-1), 'Slide 10');
  const read = await textFromDocument('pdf', pdf(['Photosynthesis turns light into energy.', 'Chlorophyll absorbs red and blue light.']));
  assert.match(read, /Photosynthesis turns light into energy\.\s+Chlorophyll absorbs red and blue light\./);
  assert.equal(await textFromDocument('docx', Buffer.from('not a zip')), null);
  assert.equal(await textFromDocument('pdf', Buffer.from('%PDF-1.4 broken')), null);
  assert.equal(textFromPptx(docx([['No slides']])), null);
});

test("a web page is read as its article's text, without scripts, menus or footers", () => {
  const filler = Array.from({ length: 90 }, (_, index) => `fact${index}`).join(' ');
  const page = textFromHtml(`<html><head><title>Cells &amp; Life</title><script>var x = "<p>not text</p>";</script><style>p{}</style></head>
    <body><nav>Home About</nav><article><h1>Mitosis</h1><p>Cells divide.</p><p>${filler}</p><!-- hidden --></article><footer>Copyright</footer></body></html>`);
  assert.equal(page.title, 'Cells & Life');
  assert.ok(page.text.startsWith('Mitosis\n\nCells divide.\n\nfact0'), page.text.slice(0, 60));
  assert.ok(!/Home|Copyright|not text|hidden/.test(page.text));
  // A short article is not the whole page: the rest is read too, still without the menus.
  const short = textFromHtml('<body><nav>Menu</nav><article>Short.</article><p>Body text.</p><footer>Foot</footer></body>');
  assert.equal(short.text, 'Short.\n\nBody text.');
  // A page that never closes its scripts cannot slow the server down.
  const started = Date.now();
  textFromHtml(`${'<script>'.repeat(150_000)}<p>end</p>`);
  textFromHtml(`${'<article>'.repeat(150_000)}${'<nav>'.repeat(50_000)}`);
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
});

test('a YouTube link is read from its captions, people-written English or Filipino first', () => {
  const id = (link) => youtubeVideoId(new URL(link));
  assert.deepEqual(
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'https://youtu.be/dQw4w9WgXcQ', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://example.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=bad!'].map(id),
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'dQw4w9WgXcQ', null, null],
  );
  const watch = `<title>Cells - YouTube</title><script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
    {"baseUrl":"https://www.youtube.com/api/timedtext?v=x&lang=ja","languageCode":"ja"},
    {"baseUrl":"https://www.youtube.com/api/timedtext?v=x&lang=en&kind=asr","languageCode":"en","kind":"asr"},
    {"baseUrl":"https://www.youtube.com/api/timedtext?v=x&lang=fil","languageCode":"fil","name":{"simpleText":"Filipino [\\"Ph\\"]"}}]}},
    "videoDetails":{"videoId":"x","title":"Cell \\"division\\" explained"}};</script>`;
  const tracks = captionTracks(watch);
  assert.equal(tracks.length, 3);
  assert.equal(pickCaptionTrack(tracks).languageCode, 'fil');
  assert.equal(pickCaptionTrack(tracks.slice(0, 2)).kind, 'asr', 'automatic English before a person-written other language');
  assert.equal(youtubeTitle(watch), 'Cell "division" explained');
  assert.equal(youtubeTitle('<title>Cells - YouTube</title>'), 'Cells');
  assert.deepEqual(captionTracks('<p>No captions</p>'), []);
  assert.equal(textFromCaptionXml('<transcript><text start="0" dur="1">Cells &amp;amp; DNA</text><text start="1">it&amp;#39;s\nfun</text></transcript>'), "Cells & DNA it's fun");
  assert.equal(textFromCaptionXml('<timedtext><body><p t="0"><s>Hello</s><s> world</s></p></body></timedtext>'), 'Hello world');
});

test('only public addresses on the internet may be opened', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2001:db8::1', 'ff02::1', 'not an ip']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '142.250.72.14', '2607:f8b0:4005:80c::200e', '::ffff:8.8.8.8']) assert.equal(isPublicAddress(address), true, address);
});

test('a link must be a public http or https page on the default port', async () => {
  assert.equal(parseLink('https://en.wikipedia.org/wiki/Cell').hostname, 'en.wikipedia.org');
  for (const link of ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://0x7f000001/', 'http://2130706433/', 'https://example.com:8443/', 'https://user:pass@example.com/', 'http://intranet/', 'http://printer.local/', 'http://169.254.169.254/latest/meta-data/']) {
    assert.throws(() => parseLink(link), SourceError, link);
  }
  assert.throws(() => parseLink('ftp://example.com/file'), /Only http and https/);
  assert.throws(() => parseLink('not a link'), /full link/);
  // Refused before anything is opened.
  await assert.rejects(readLink('http://127.0.0.1:3000/admin'), SourceError);
});
