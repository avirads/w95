import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Set PLAYWRIGHT_MODULE to a module URL/path when Playwright is not installed
// locally, and CHROME_EXECUTABLE to use an already installed Chrome browser.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chunkSize = 256 * 1024;
const imageDirectory = '/w95/images/windows95-v3-restored/';
const chunk = index => `${imageDirectory}${index * chunkSize}-${(index + 1) * chunkSize}.img`;
const harness = `<!doctype html><title>Windows 95 disk-cache test</title>
<script type="module">
try {
  const { prepareDiskCache } = await import('./disk-cache.mjs');
  window.cacheReady = await prepareDiskCache();
} catch (error) {
  window.cacheError = String(error);
}
</script>`;

async function fixture({ actualIndex = false } = {}) {
  const hits = new Map();
  const sources = new Map(await Promise.all(
    ['disk-image.mjs', 'disk-cache.mjs', 'disk-cache-sw.js', 'agent-prompts.mjs'].map(async name =>
      [`/w95/${name}`, await readFile(new URL(name, import.meta.url))]),
  ));
  const pageHtml = actualIndex ? await readFile(new URL('index.html', import.meta.url)) : harness;
  sources.set('/w95/build/libv86.js', `window.V86 = class {
    constructor(options) {
      this.listeners = new Map();
      window.keyboardStatus = [];
      window.constructorProbe = {
        controller: navigator.serviceWorker.controller?.scriptURL,
        hda: options.hda,
      };
      const request = new XMLHttpRequest();
      request.open('GET', options.hda.url.replace('/.img', '/0-262144.img'));
      request.responseType = 'arraybuffer';
      request.onload = () => { window.firstChunkLoaded = request.response.byteLength; };
      request.send();
      setTimeout(() => this.listeners.get('emulator-ready')?.(), 0);
    }
    add_listener(name, callback) { this.listeners.set(name, callback); }
    keyboard_set_status(enabled) { window.keyboardStatus.push(enabled); }
  };`);
  sources.set('/kalib/ocr/tesseract.min.js', 'window.Tesseract = {};');
  sources.set('/w95/w95-agent.mjs', `
    window.agentProbe = { runs: [], stops: 0, instances: 0 };
    export class WindowsAgent {
      constructor(emulator, dimensions, onLog) {
        window.agentProbe.instances++;
        window.agentTest = {
          log: message => onLog(message),
          complete: summary => this.resolve({ summary }),
          fail: message => this.reject(new Error(message)),
        };
      }
      run(goal) {
        window.agentProbe.runs.push(goal);
        return new Promise((resolve, reject) => {
          this.resolve = resolve;
          this.reject = reject;
        });
      }
      stop() {
        window.agentProbe.stops++;
        this.resolve({ summary: 'Cancelled.' });
      }
    }
  `);
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const key = `${request.method} ${path}${request.headers.range ? ' RANGE' : ''}`;
    hits.set(key, (hits.get(key) || 0) + 1);
    // Disable the ordinary HTTP cache so a passing test proves persistent
    // service-worker storage, rather than Chrome's in-memory HTTP cache.
    response.setHeader('Cache-Control', 'no-store');
    if (sources.has(path)) {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(sources.get(path));
    } else if (path === '/w95/' || path === '/w95/index.html') {
      response.setHeader('Content-Type', 'text/html');
      response.end(pageHtml);
    } else if (path === '/w95/seed') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Cache seed</title>');
    } else if (path.includes('/images/')) {
      response.setHeader('Content-Type', 'application/octet-stream');
      if (request.headers.range) {
        response.writeHead(206, { 'Content-Range': `bytes 0-15/${chunkSize}` });
        response.end(Buffer.alloc(16, 7));
      } else if (path === chunk(2)) {
        response.writeHead(500);
        response.end('Synthetic server failure');
      } else if (path === chunk(3)) {
        response.end(Buffer.alloc(17, 3));
      } else if (path === chunk(4)) {
        response.writeHead(401);
        response.end('Authentication required');
      } else if (path === chunk(5)) {
        response.writeHead(206);
        response.end(Buffer.alloc(chunkSize, 5));
      } else {
        response.end(Buffer.alloc(chunkSize, 42));
      }
    } else {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ path, hit: hits.get(key) }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    hits: (path, method = 'GET', range = false) =>
      hits.get(`${method} ${path}${range ? ' RANGE' : ''}`) || 0,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}

const browserOptions = {
  headless: true,
  ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}),
  args: ['--disable-gpu'],
};

async function ready(page, origin, expected = true) {
  await page.goto(`${origin}/w95/`);
  await page.waitForFunction(() => typeof window.cacheReady === 'boolean' || window.cacheError,
    null, { timeout: 20_000 });
  assert.equal(await page.evaluate(() => window.cacheError), undefined);
  assert.equal(await page.evaluate(() => window.cacheReady), expected);
}

// v86 uses XMLHttpRequest, not fetch, for its fixed-size image parts.
async function xhr(page, path, { method = 'GET', range } = {}) {
  return page.evaluate(({ path, method, range }) => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, path);
    request.responseType = 'arraybuffer';
    if (range) request.setRequestHeader('Range', range);
    request.onload = () => resolve({ status: request.status, length: request.response.byteLength });
    request.onerror = () => reject(new Error('XHR failed'));
    request.send();
  }), { path, method, range });
}

async function assertNotCached(page, path) {
  assert.equal(await page.evaluate(async path =>
    Boolean(await caches.match(new URL(path, location.href).href)), path), false, path);
}

test('disk parts survive reload and browser restart without caching application/auth traffic',
  { timeout: 120_000 }, async t => {
    const host = await fixture();
    const profile = await mkdtemp(join(tmpdir(), 'w95-disk-cache-test-'));
    let context;
    t.after(async () => {
      await context?.close();
      await host.close();
      // Only this test-owned mkdtemp directory is removed.
      await rm(profile, { recursive: true, force: true });
    });
    context = await chromium.launchPersistentContext(profile, browserOptions);
    let page = await context.newPage();
    await page.goto(`${host.origin}/w95/seed`);
    const oldCache = `w95-image:${host.origin}/w95/:obsolete`;
    await page.evaluate(async oldCache => {
      await caches.open(oldCache);
      await caches.open('unrelated-application-cache');
    }, oldCache);

    await ready(page, host.origin);
    const cacheNames = await page.evaluate(() => caches.keys());
    assert.ok(!cacheNames.includes(oldCache), 'old image revisions are removed');
    assert.ok(cacheNames.includes('unrelated-application-cache'), 'other applications are untouched');

    assert.deepEqual(await xhr(page, chunk(0)), { status: 200, length: chunkSize });
    await page.waitForFunction(async path => Boolean(await caches.match(new URL(path, location.href).href)), chunk(0));
    assert.equal(host.hits(chunk(0)), 1);
    assert.deepEqual(await xhr(page, chunk(0)), { status: 200, length: chunkSize });
    assert.equal(host.hits(chunk(0)), 1, 'the second XHR comes from browser storage');
    await ready(page, host.origin);
    assert.deepEqual(await xhr(page, chunk(0)), { status: 200, length: chunkSize });
    assert.equal(host.hits(chunk(0)), 1, 'a page reload reuses the cached part');
    assert.equal(host.hits('/w95/'), 2, 'navigations still contact the server');

    await context.close();
    context = await chromium.launchPersistentContext(profile, browserOptions);
    page = await context.newPage();
    await ready(page, host.origin);
    assert.deepEqual(await xhr(page, chunk(0)), { status: 200, length: chunkSize });
    assert.equal(host.hits(chunk(0)), 1, 'a fresh browser process reuses the disk cache');
    await xhr(page, chunk(1));
    await page.waitForFunction(async path => Boolean(await caches.match(new URL(path, location.href).href)), chunk(1));
    await xhr(page, chunk(1));
    assert.equal(host.hits(chunk(1)), 1, 'previously unseen parts are fetched once');

    for (const [index, status, length] of [[2, 500, 24], [3, 200, 17], [4, 401, 23], [5, 206, chunkSize]]) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await xhr(page, chunk(index));
        assert.equal(result.status, status);
        assert.equal(result.length, length);
      }
      assert.equal(host.hits(chunk(index)), 2, `invalid chunk ${index} is fetched again`);
      await assertNotCached(page, chunk(index));
    }

    for (const path of ['/v1/sessions', '/w95/api/status', '/w95/images/another-version/0-262144.img']) {
      await xhr(page, path);
      await xhr(page, path);
      assert.equal(host.hits(path), 2, `${path} bypasses the disk cache`);
      await assertNotCached(page, path);
    }
    await xhr(page, chunk(0), { range: 'bytes=0-15' });
    await xhr(page, chunk(0), { range: 'bytes=0-15' });
    assert.equal(host.hits(chunk(0), 'GET', true), 2, 'range requests bypass cached whole chunks');
    await xhr(page, chunk(0), { method: 'POST' });
    await xhr(page, chunk(0), { method: 'POST' });
    assert.equal(host.hits(chunk(0), 'POST'), 2, 'only GET requests may use the disk cache');
    assert.deepEqual(await xhr(page, chunk(0)), { status: 200, length: chunkSize });
    assert.equal(host.hits(chunk(0)), 1, 'excluded requests do not overwrite good chunks');
  });

test('blocking service workers fails open so image downloads still work',
  { timeout: 45_000 }, async t => {
    const host = await fixture();
    const browser = await chromium.launch(browserOptions);
    t.after(async () => {
      await browser.close();
      await host.close();
    });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await ready(page, host.origin, false);
    assert.deepEqual(await xhr(page, chunk(0)), { status: 200, length: chunkSize });
    assert.equal(host.hits(chunk(0)), 1);
  });

test('the real Windows 95 page waits for cache control before constructing V86',
  { timeout: 45_000 }, async t => {
    const host = await fixture({ actualIndex: true });
    const browser = await chromium.launch(browserOptions);
    t.after(async () => {
      await browser.close();
      await host.close();
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.goto(`${host.origin}/w95/?network=local`);
      await page.waitForFunction(() => window.firstChunkLoaded === 262144);
      const probe = await page.evaluate(() => window.constructorProbe);
      assert.equal(probe.controller, `${host.origin}/w95/disk-cache-sw.js`);
      assert.deepEqual(probe.hda, {
        url: `${host.origin}${imageDirectory}.img`,
        size: 471859200,
        async: true,
        fixed_chunk_size: chunkSize,
        use_parts: true,
      });
      assert.equal(await page.locator('#boot').isHidden(), true);
      assert.equal(await page.locator('#agent_run').isEnabled(), true);
      const agentPanel = page.locator('#agent_panel');
      const agentToggle = page.locator('#agent_toggle');
      const agentGoal = page.locator('#agent_goal');
      assert.equal(await agentPanel.isHidden(), true, 'the agent panel starts closed on every load');
      assert.equal(await agentToggle.getAttribute('aria-expanded'), 'false');
      await agentToggle.click();
      assert.equal(await agentPanel.isVisible(), true, 'the agent button opens the panel');
      assert.equal(await agentToggle.getAttribute('aria-expanded'), 'true');
      const prompt = 'Open Notepad and type "Hello from Jev"';
      await agentGoal.fill(prompt);
      await agentToggle.click();
      assert.equal(await agentPanel.isHidden(), true, 'a second click closes the panel');
      assert.equal(await agentToggle.getAttribute('aria-expanded'), 'false');
      await agentToggle.click();
      assert.equal(await agentGoal.inputValue(), prompt, 'toggling the panel preserves the prompt');
      assert.equal(await agentPanel.isVisible(), true);
      assert.equal(await agentToggle.getAttribute('aria-expanded'), 'true');
      await page.waitForFunction(async path => Boolean(await caches.match(new URL(path, location.href).href)), chunk(0));
    }
    assert.equal(host.hits(chunk(0)), 1, 'real page first load and reload share the disk part');
    assert.deepEqual(errors, []);
  });

test('agent suggestions, shortcuts and unobtrusive run controls work without sending real requests',
  { timeout: 60_000 }, async t => {
    const host = await fixture({ actualIndex: true });
    const browser = await chromium.launch(browserOptions);
    t.after(async () => {
      await browser.close();
      await host.close();
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${host.origin}/w95/?network=local`);
    await page.waitForFunction(() => window.firstChunkLoaded === 262144 && document.getElementById('boot').hidden);
    const panel = page.locator('#agent_panel');
    const toggle = page.locator('#agent_toggle');
    const goal = page.locator('#agent_goal');
    const run = page.locator('#agent_run');
    const shuffle = page.locator('#agent_shuffle');
    const activity = page.locator('#agent_activity');
    const stop = page.locator('#agent_stop');
    assert.equal(await panel.isHidden(), true);
    assert.equal(host.hits('/w95/w95-agent.mjs'), 0, 'opening the page does not load the agent');
    await toggle.click();
    let suggestion = await goal.inputValue();
    assert.ok(suggestion.length > 15, 'first opening offers a usable Windows 95 prompt');
    assert.equal(await goal.getAttribute('data-suggested'), 'true');
    assert.equal(await goal.evaluate(element => document.activeElement === element), true);
    for (let attempt = 0; attempt < 8; attempt++) {
      await shuffle.click();
      const next = await goal.inputValue();
      assert.notEqual(next, suggestion, 'Shuffle must not repeat the current prompt');
      assert.equal(await goal.getAttribute('data-suggested'), 'true');
      assert.equal(await goal.evaluate(element => document.activeElement === element), true);
      suggestion = next;
    }
    await page.evaluate(() => {
      window.guestKeyEvents = [];
      for (const type of ['keydown', 'keyup']) {
        document.addEventListener(type, event => window.guestKeyEvents.push(`${type}:${event.key}`));
      }
    });
    await goal.press('ArrowRight');
    assert.equal(await goal.getAttribute('data-suggested'), 'false');
    assert.deepEqual(await goal.evaluate(element => [element.selectionStart, element.selectionEnd]),
      [suggestion.length, suggestion.length], 'Right Arrow accepts the suggestion at its end');
    assert.equal(await goal.inputValue(), suggestion);
    assert.equal(host.hits('/w95/w95-agent.mjs'), 0, 'accepting a suggestion does not run it');
    await goal.press('Shift+Enter');
    assert.equal(await goal.inputValue(), `${suggestion}\n`, 'Shift+Enter remains a text-editing shortcut');
    for (const options of [
      { isComposing: true }, { repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true },
    ]) {
      await goal.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, ...options });
    }
    assert.equal(await panel.isVisible(), true);
    assert.equal(host.hits('/w95/w95-agent.mjs'), 0, 'IME, held keys and modified Enter do not submit');

    await shuffle.click();
    assert.equal(await goal.getAttribute('data-suggested'), 'true');
    const requestedGoal = 'Open Notepad and type "Hello from the browser test"';
    await goal.fill(requestedGoal);
    assert.equal(await goal.getAttribute('data-suggested'), 'false', 'editing accepts custom text');
    await goal.press('Enter');
    await page.waitForFunction(() => window.agentProbe?.runs.length === 1);
    assert.deepEqual(await page.evaluate(() => window.agentProbe.runs), [requestedGoal]);
    assert.equal(await panel.isHidden(), true, 'running clears the VM display');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await activity.isVisible(), true, 'compact status stays available outside the VM display');
    assert.equal(await activity.evaluate(element => {
      const display = document.getElementById('well').getBoundingClientRect();
      return Boolean(element.closest('.titlebar')) && element.getBoundingClientRect().bottom <= display.top;
    }), true, 'active controls occupy the titlebar, not the guest framebuffer');
    assert.equal(await stop.isVisible(), true);
    assert.equal(await stop.isEnabled(), true);
    assert.equal(await goal.isDisabled(), true);
    assert.equal(await run.isDisabled(), true);
    assert.equal(await shuffle.isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.guestKeyEvents), [],
      'editing and submitting prompt shortcuts never reach guest document keyboard handlers');
    await page.evaluate(() => window.agentTest.log('Opening Notepad…'));
    assert.equal(await page.locator('#agent_brief').textContent(), 'Opening Notepad…');
    assert.equal(await panel.isHidden(), true, 'progress does not reopen the panel');
    await run.dispatchEvent('click');
    await goal.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
    assert.equal(await page.evaluate(() => window.agentProbe.runs.length), 1, 'duplicate submissions are ignored');
    await page.evaluate(() => window.agentTest.complete('Typed the requested text.'));
    await page.waitForFunction(() => !document.getElementById('agent_run').disabled);
    assert.equal(await panel.isHidden(), true, 'completion does not reopen the panel');
    assert.equal(await page.locator('#agent_brief').textContent(), 'Typed the requested text.');
    assert.ok(await stop.isHidden() || await stop.isDisabled(), 'Cancel is not active after completion');

    await toggle.click();
    assert.equal(await goal.inputValue(), requestedGoal, 'reopening retains the submitted goal');
    await run.click();
    await page.waitForFunction(() => window.agentProbe.runs.length === 2);
    assert.deepEqual(await page.evaluate(() => window.agentProbe.runs), [requestedGoal, requestedGoal],
      'Enter and Run submit the identical goal through the same path');
    assert.equal(await panel.isHidden(), true);
    await stop.click();
    await page.waitForFunction(() => !document.getElementById('agent_run').disabled);
    assert.equal(await page.evaluate(() => window.agentProbe.stops), 1, 'titlebar Cancel stops the active agent');
    assert.equal(await panel.isHidden(), true);

    await toggle.click();
    await run.click();
    await page.waitForFunction(() => window.agentProbe.runs.length === 3);
    await toggle.click();
    assert.equal(await panel.isVisible(), true, 'users may explicitly open status during a run');
    assert.equal(await goal.isDisabled(), true);
    await page.locator('#agent_cancel').click();
    await page.waitForFunction(() => !document.getElementById('agent_run').disabled);
    assert.equal(await page.evaluate(() => window.agentProbe.stops), 2, 'panel Cancel also stops the active agent');

    if (await panel.isHidden()) await toggle.click();
    await run.click();
    await page.waitForFunction(() => window.agentProbe.runs.length === 4);
    await page.evaluate(() => window.agentTest.fail('Synthetic planner failure'));
    await page.waitForFunction(() => !document.getElementById('agent_run').disabled);
    assert.equal(await panel.isHidden(), true, 'an error does not cover the VM display');
    assert.match(await page.locator('#agent_brief').textContent(), /Synthetic planner failure/);
    assert.equal(await activity.isVisible(), true, 'error status remains reachable');
    assert.ok(await stop.isHidden() || await stop.isDisabled());
    assert.equal(await goal.isEnabled(), true);
    assert.equal(await shuffle.isEnabled(), true);
    assert.equal(host.hits('/20260918/api/jev/pc-step', 'POST'), 0, 'tests never invoke the real planner');
    assert.deepEqual(errors, []);

    await toggle.click();
    const panelTitle = page.locator('#agent_panel_drag');
    const beforeDrag = await panel.boundingBox();
    const titleBox = await panelTitle.boundingBox();
    await page.mouse.move(titleBox.x + 50, titleBox.y + titleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(titleBox.x + 110, titleBox.y + titleBox.height / 2 + 55, { steps: 3 });
    await page.mouse.up();
    const afterDrag = await panel.boundingBox();
    assert.ok(afterDrag.x > beforeDrag.x && afterDrag.y > beforeDrag.y,
      'the agent window moves when its title bar is dragged');
    const wellBox = await page.locator('#well').boundingBox();
    assert.ok(afterDrag.x >= wellBox.x && afterDrag.y >= wellBox.y &&
      afterDrag.x + afterDrag.width <= wellBox.x + wellBox.width &&
      afterDrag.y + afterDrag.height <= wellBox.y + wellBox.height,
    'dragging keeps the whole agent window inside the Windows display');
    const closePrompt = 'Open Notepad and type "Kept after closing"';
    await goal.fill(closePrompt);
    await page.locator('#agent_panel_close').click();
    assert.equal(await panel.isHidden(), true, 'the agent window close button hides the panel');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    assert.equal(await goal.inputValue(), closePrompt, 'closing and reopening preserves the prompt');
    assert.deepEqual(errors, []);
  });

test('cancelling while lazy agent or OCR code loads never launches automation afterward',
  { timeout: 60_000 }, async t => {
    const host = await fixture({ actualIndex: true });
    const browser = await chromium.launch(browserOptions);
    let releaseDownload;
    t.after(async () => {
      releaseDownload?.();
      await browser.close();
      await host.close();
    });
    for (const asset of ['/w95/w95-agent.mjs', '/kalib/ocr/tesseract.min.js']) {
      const page = await browser.newPage();
      const downloadGate = new Promise(resolve => { releaseDownload = resolve; });
      let markIntercepted;
      const intercepted = new Promise(resolve => { markIntercepted = resolve; });
      await page.route(`**${asset}`, async route => {
        markIntercepted();
        await downloadGate;
        await route.continue();
      });
      await page.goto(`${host.origin}/w95/?network=local`);
      await page.waitForFunction(() => window.firstChunkLoaded === 262144 && document.getElementById('boot').hidden);
      await page.locator('#agent_toggle').click();
      await page.locator('#agent_run').click();
      await intercepted;
      assert.equal(await page.locator('#agent_panel').isHidden(), true);
      assert.equal(await page.locator('#agent_stop').isEnabled(), true, 'Cancel works during lazy loading');
      await page.locator('#agent_stop').click();
      assert.match(await page.locator('#agent_brief').textContent(), /Stopping|cancelled/i);
      releaseDownload();
      await page.waitForFunction(() => !document.getElementById('agent_run').disabled);
      assert.equal(await page.evaluate(() => window.agentProbe?.instances || 0), 0,
        `cancellation during ${asset} loading prevents agent construction`);
      assert.equal(await page.evaluate(() => window.agentProbe?.runs.length || 0), 0,
        'the cancelled goal is never submitted');
      assert.equal(await page.locator('#agent_panel').isHidden(), true);
      assert.match(await page.locator('#agent_brief').textContent(), /cancelled/i);
      await page.close();
      releaseDownload = undefined;
    }
  });
