// Renders Habi's 3D animations for the app: every frame of each loop in headless Chromium (WebGL),
// then encode.py turns them into animated WebP files and still images in frontend/assets/buddy.
// Run `npm run render` here (see README.md). `node render.mjs happy` renders only that mood.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(here, '../../frontend/assets/buddy');
// Frames are drawn at twice the saved size, so the edges are smooth once scaled down.
const RENDER_SIZE = 768;
const SAVED_SIZE = 384;

/** Each animation: its mood (components/buddy.tsx), frames in one loop and the loop's length. */
export const ANIMATIONS = [
  { mood: 'happy', frames: 36, ms: 2400 },
  { mood: 'ecstatic', frames: 24, ms: 1200 },
  { mood: 'sleepy', frames: 40, ms: 3200 },
  { mood: 'hungry', frames: 30, ms: 2000 },
  { mood: 'sad', frames: 36, ms: 3000 },
  // Played once when Habi is tapped or gets something new.
  { mood: 'cheer', frames: 24, ms: 1200, still: false },
];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };

/** Serves this folder (the page, the model and three.js) to the browser on a local port. */
function serve() {
  const server = http.createServer((request, response) => {
    const file = path.join(here, decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!file.startsWith(here) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const only = process.argv.slice(2);
const animations = only.length ? ANIMATIONS.filter((animation) => only.includes(animation.mood)) : ANIMATIONS;
const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'habi-frames-'));
const server = await serve();
// SwiftShader draws WebGL without a GPU, so this also runs on a server.
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: RENDER_SIZE, height: RENDER_SIZE } });
  page.on('pageerror', (error) => console.error('page error:', error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?size=${RENDER_SIZE}`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60_000 });
  for (const { mood, frames: count } of animations) {
    for (let index = 0; index < count; index += 1) {
      const url = await page.evaluate(([name, t]) => window.renderFrame(name, t), [mood, index / count]);
      fs.writeFileSync(path.join(frames, `${mood}-${String(index).padStart(3, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
    console.log(`Rendered ${mood}: ${count} frames`);
  }
} finally {
  await browser.close();
  server.close();
}

fs.mkdirSync(output, { recursive: true });
const jobs = animations.map(({ mood, frames: count, ms, still = true }) => `${mood}:${count}:${ms}:${still ? 1 : 0}`);
const encoded = spawnSync('python3', ['-I', path.join(here, 'encode.py'), frames, output, String(SAVED_SIZE), ...jobs], { stdio: 'inherit' });
fs.rmSync(frames, { recursive: true, force: true });
process.exit(encoded.status ?? 1);
