import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const scope = 'https://fastium.live/w95/';
const image = Object.freeze({
  url: scope + 'images/windows95-v3-restored/.img',
  size: 471859200,
  chunkSize: 256 * 1024,
});
const prefix = 'w95-image:' + scope + ':';
const cacheName = prefix + 'v1:/w95/images/windows95-v3-restored/';
const source = (await readFile(new URL('./disk-cache-sw.js', import.meta.url), 'utf8'))
  .replace(/^import \{ DISK_IMAGE \} from "\.\/disk-image\.mjs";\r?\n/, '');
const chunkUrl = (index = 0) => new URL(`${index * image.chunkSize}-${(index + 1) * image.chunkSize}.img`, image.url).href;

function networkResponse(url, { status = 200, size = image.chunkSize,
  contentType = 'application/octet-stream', redirected = false } = {}) {
  const response = new Response(new Uint8Array(size).fill(37), {
    status, headers: { 'Content-Type': contentType },
  });
  // A real fetch Response has a URL; constructed Node Responses do not.
  Object.defineProperties(response, {
    url: { value: url },
    redirected: { value: redirected },
  });
  return response;
}

function worker(options = {}) {
  const handlers = new Map();
  const entries = new Map();
  const calls = { open: [], match: [], put: [], fetch: [], deleted: [], warnings: [], claim: 0, skipWaiting: 0 };
  const cache = {
    async match(request) {
      calls.match.push(request.url);
      if (options.matchError) throw options.matchError;
      return entries.get(request.url)?.clone();
    },
    async put(request, response) {
      calls.put.push(request.url);
      if (options.putError) throw options.putError;
      entries.set(request.url, response.clone());
    },
  };
  vm.runInNewContext(source, {
    DISK_IMAGE: image, URL,
    console: { warn: (...args) => calls.warnings.push(args) },
    self: {
      registration: { scope },
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: async () => { calls.skipWaiting++; },
      clients: { claim: async () => { calls.claim++; } },
    },
    caches: {
      async open(name) {
        calls.open.push(name);
        if (options.openError) throw options.openError;
        return cache;
      },
      async keys() {
        if (options.keysError) throw options.keysError;
        return options.keys || [];
      },
      async delete(name) {
        calls.deleted.push(name);
        if (options.deleteError) throw options.deleteError;
        return true;
      },
    },
    async fetch(request, fetchOptions) {
      calls.fetch.push({ request, options: fetchOptions });
      return options.fetch ? options.fetch(request, calls.fetch.length) : networkResponse(request.url);
    },
  }, { filename: 'disk-cache-sw.js' });

  function dispatch(name, request) {
    const result = { response: undefined, work: [] };
    handlers.get(name)({
      request,
      respondWith: value => { result.response = Promise.resolve(value); },
      waitUntil: value => { result.work.push(Promise.resolve(value)); },
    });
    return result;
  }
  return { calls, entries, options, dispatch,
    request: (url = chunkUrl(), init) => dispatch('fetch', new Request(url, init)) };
}

async function finish(event) {
  try { return await event.response; }
  finally { await Promise.all(event.work); }
}

test('valid chunks are saved and served from CacheStorage on later reads', async () => {
  const sw = worker();
  const first = await finish(sw.request());
  assert.equal((await first.arrayBuffer()).byteLength, image.chunkSize);
  const second = await finish(sw.request());
  assert.equal((await second.arrayBuffer()).byteLength, image.chunkSize);
  assert.equal(sw.calls.fetch.length, 1);
  assert.equal(sw.calls.fetch[0].options.cache, 'no-store');
  assert.deepEqual(sw.calls.put, [chunkUrl()]);
  assert.ok(sw.calls.open.every(name => name === cacheName));
});

test('CacheStorage open or match errors do not prevent successful downloads', async t => {
  for (const operation of ['openError', 'matchError']) {
    await t.test(operation, async () => {
      const sw = worker({ [operation]: new DOMException('Storage disabled', 'SecurityError') });
      const response = await finish(sw.request());
      assert.equal(response.status, 200);
      assert.equal((await response.arrayBuffer()).byteLength, image.chunkSize);
      assert.equal(sw.calls.fetch.length, 1);
    });
  }
});

test('quota failures disable new writes but preserve readable chunks and network fallback', async () => {
  const sw = worker();
  await finish(sw.request());
  sw.options.putError = new DOMException('Storage full', 'QuotaExceededError');
  const uncached = await finish(sw.request(chunkUrl(1)));
  assert.equal((await uncached.arrayBuffer()).byteLength, image.chunkSize);
  assert.equal(sw.calls.warnings.length, 1);
  const putCount = sw.calls.put.length;
  const subsequent = await finish(sw.request(chunkUrl(2)));
  assert.equal((await subsequent.arrayBuffer()).byteLength, image.chunkSize);
  assert.equal(sw.calls.put.length, putCount);
  const networkCount = sw.calls.fetch.length;
  await finish(sw.request());
  assert.equal(sw.calls.fetch.length, networkCount, 'previously cached chunks remain usable');
  assert.equal(sw.calls.deleted.length, 0, 'quota failure must not evict application storage');
});

test('network failures are not cached and pending requests can retry', async () => {
  const sw = worker({ fetch: async (request, attempt) => {
    if (attempt === 1) throw new TypeError('Network unavailable');
    return networkResponse(request.url);
  } });
  await assert.rejects(finish(sw.request()), /Network unavailable/);
  assert.equal(sw.calls.put.length, 0);
  assert.equal((await finish(sw.request())).status, 200);
  assert.equal(sw.calls.fetch.length, 2);
  assert.equal(sw.calls.put.length, 1);
});

test('error, partial, redirected, wrong-size and nonbinary responses are not cached', async t => {
  for (const [name, responseOptions] of Object.entries({
    unauthorized: { status: 401 },
    missing: { status: 404 },
    partial: { status: 206 },
    redirected: { redirected: true },
    truncated: { size: image.chunkSize - 1 },
    oversized: { size: image.chunkSize + 1 },
    html: { contentType: 'text/html' },
    json: { contentType: 'application/json' },
    xml: { contentType: 'application/xml' },
  })) {
    await t.test(name, async () => {
      const sw = worker({ fetch: async request => networkResponse(request.url, responseOptions) });
      await finish(sw.request());
      await finish(sw.request());
      assert.equal(sw.calls.put.length, 0);
      assert.equal(sw.calls.fetch.length, 2);
    });
  }
  const sw = worker({ fetch: async () => networkResponse(scope + 'login') });
  await finish(sw.request());
  assert.equal(sw.calls.put.length, 0, 'a response from another URL is not a disk chunk');
});

test('unrelated requests, navigation, methods, invalid boundaries and Range pass through', () => {
  const sw = worker();
  const requests = [
    new Request(scope),
    new Request('https://fastium.live/v1/sessions', { method: 'POST' }),
    new Request('https://fastium.live/20260918/api/jev/pc-step', { method: 'POST' }),
    new Request(chunkUrl().replace('fastium.live', 'example.com')),
    new Request(chunkUrl().replace('windows95-v3-restored', 'windows95-next')),
    new Request(chunkUrl() + '?revision=other'),
    new Request(chunkUrl().replace('0-262144', '1-262145')),
    new Request(chunkUrl().replace('0-262144', '0-1')),
    new Request(chunkUrl(1800)),
    new Request(chunkUrl().replace('0-262144', '-262144-0')),
    new Request(chunkUrl().replace('0-262144', '9007199254740992-9007199255003136')),
    new Request(chunkUrl().replace('0-262144.img', 'nested/0-262144.img')),
    new Request(chunkUrl(), { method: 'HEAD' }),
    new Request(chunkUrl(), { method: 'POST' }),
    new Request(chunkUrl(), { headers: { Range: 'bytes=0-99' } }),
    { url: chunkUrl(), method: 'GET', mode: 'navigate', headers: new Headers() },
  ];
  for (const request of requests) {
    const result = sw.dispatch('fetch', request);
    assert.equal(result.response, undefined, `${request.method} ${request.url} must pass through`);
    assert.equal(result.work.length, 0);
  }
  assert.equal(sw.calls.fetch.length, 0);
  assert.equal(sw.calls.open.length, 0);
});

test('activation removes only obsolete caches for this scope and claims clients', async () => {
  const obsolete = prefix + 'v0:/w95/images/old/';
  const sw = worker({ keys: [cacheName, obsolete, 'ai-models', 'v86-disks',
    'w95-image:https://fastium.live/another/:v0:old'] });
  await finish(sw.dispatch('activate'));
  assert.deepEqual(sw.calls.deleted, [obsolete]);
  assert.equal(sw.calls.claim, 1);
  await finish(sw.dispatch('install'));
  assert.equal(sw.calls.skipWaiting, 1);
});

test('activation still claims clients if cache inspection or deletion fails', async t => {
  for (const operation of ['keysError', 'deleteError']) {
    await t.test(operation, async () => {
      const sw = worker({ keys: [prefix + 'old'], [operation]: new Error('Storage unavailable') });
      await finish(sw.dispatch('activate'));
      assert.equal(sw.calls.claim, 1);
    });
  }
});

test('concurrent reads coalesce one download and receive independent response bodies', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const sw = worker({ fetch: async request => {
    await gate;
    return networkResponse(request.url);
  } });
  const first = sw.request();
  const second = sw.request();
  release();
  const [a, b] = await Promise.all([finish(first), finish(second)]);
  assert.notEqual(a, b);
  assert.deepEqual(new Uint8Array(await a.arrayBuffer()), new Uint8Array(await b.arrayBuffer()));
  assert.equal(sw.calls.fetch.length, 1);
  assert.equal(sw.calls.put.length, 1);
});
