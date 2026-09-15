/** The WordPress client and the page operations built on it. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { TargetError } from '@pterodocs/core/util';
import { WpClient } from '../../src/client';
import { computePrune, createPostsApi, diffPage } from '../../src/pages';
import { hrefFor, prefixSegments, splitOwnership } from '../../src/url';
import { hashFromSlug, mediaSlug } from '../../src/media';
import { createFakeWp, type FakeWp } from '../fixtures/fake-wp';
import type { RemotePage, RenderedPage } from '@pterodocs/core/target';

/** The page routes, bound to whichever collection the fake is serving. */
function posts(fake: FakeWp, options: Partial<ConstructorParameters<typeof WpClient>[0]> = {}) {
  return createPostsApi(client(fake, options), fake.restBase);
}

function client(fake: FakeWp, options: Partial<ConstructorParameters<typeof WpClient>[0]> = {}) {
  return new WpClient({
    baseUrl: 'https://example.test',
    user: 'someone',
    appPassword: 'secret',
    fetch: fake.fetch,
    sleep: async () => {},
    ...options,
  });
}

test('requests carry Basic auth, a user agent, and ask only for the fields used', async () => {
  const seen: { url: URL; init: RequestInit }[] = [];
  const wp = new WpClient({
    baseUrl: 'https://example.test',
    user: 'someone',
    appPassword: 'a b c d',
    sleep: async () => {},
    fetch: async (url, init = {}) => {
      seen.push({ url: new URL(String(url)), init });
      return new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-wp-totalpages': '1' },
      });
    },
  });
  await createPostsApi(wp, 'pages').fetchIndex();

  const call = seen[0]!;
  const headers = call.init.headers as Record<string, string>;
  // The spaces WordPress shows in an Application Password are decoration.
  assert.equal(headers['Authorization'], `Basic ${Buffer.from('someone:abcd').toString('base64')}`);
  assert.match(headers['User-Agent']!, /^pterodocs\//);
  assert.equal(call.init.redirect, 'error');
  assert.equal(call.url.searchParams.get('status'), 'any');
  assert.equal(call.url.searchParams.get('context'), 'edit');
  assert.equal(call.url.searchParams.get('per_page'), '100');
});

test('a language is passed on every request', async () => {
  const fake = createFakeWp();
  await client(fake, { lang: 'fr' }).request('GET', '/pages');
  assert.equal(fake.calls[0]!.query['lang'], 'fr');
});

test('collections are followed to the last page', async () => {
  const fake = createFakeWp({
    pages: Array.from({ length: 150 }, (_, index) => ({ id: index + 1, slug: `p${index + 1}` })),
  });
  assert.equal((await posts(fake).fetchIndex()).length, 150);
});

test('being busy is retried, and Retry-After applies once, not forever', async () => {
  const failures = new Map([
    ['GET /pages', [{ status: 429, headers: { 'retry-after': '5' } }, { status: 503 }]],
  ]);
  const waits: number[] = [];
  const fake = createFakeWp({ pages: [{ id: 1, slug: 'a' }], failures });
  const wp = client(fake, { sleep: async (ms: number) => void waits.push(ms) });

  assert.equal((await createPostsApi(wp, 'pages').fetchIndex()).length, 1);
  // Five seconds because the 429 asked for it, then the ordinary backoff.
  assert.deepEqual(waits, [5000, 2000]);
});

test('a refusal is raised at once, with the code the site gave', async () => {
  const failures = new Map([
    ['GET /pages', [{ status: 403, body: '{"code":"rest_forbidden","message":"Sorry"}' }]],
  ]);
  await assert.rejects(
    () => posts(createFakeWp({ failures })).fetchIndex(),
    (error: TargetError) => {
      assert.equal(error.status, 403);
      assert.equal(error.code, 'rest_forbidden');
      return true;
    },
  );
});

test('an HTML error body is reported as a blocked REST API', async () => {
  const wp = client(createFakeWp(), {
    fetch: async () =>
      new Response('<html>Access denied</html>', {
        status: 403,
        headers: { 'content-type': 'text/html' },
      }),
  });
  await assert.rejects(() => createPostsApi(wp, 'pages').fetchIndex(), /firewall or security plugin/);
});

test('a redirect is explained rather than retried', async () => {
  const wp = client(createFakeWp(), {
    fetch: async () => {
      throw new TypeError('unexpected redirect');
    },
  });
  await assert.rejects(() => createPostsApi(wp, 'pages').fetchIndex(), /redirected.*WP_URL/s);
  // One attempt: retrying a redirect would never succeed.
  assert.equal(wp.requestCount, 1);
});

test('pages are found by parent and slug', async () => {
  const fake = createFakeWp({
    pages: [
      { id: 1, slug: 'docs', parent: 0 },
      { id: 2, slug: 'docs', parent: 1 },
    ],
  });
  const wp = posts(fake);
  const index = await wp.fetchIndex();
  assert.equal((await wp.find(0, 'docs', index))!.id, 1);
  assert.equal((await wp.find(1, 'docs', index))!.id, 2);
  assert.equal(await wp.find(9, 'docs', index), undefined);
});

test('a slug WordPress would not honour is an error, not a silent rename', async () => {
  const fake = createFakeWp({ pages: [{ id: 1, slug: 'docs', parent: 0 }] });
  await assert.rejects(
    () => posts(fake).create({ title: 'Docs', slug: 'docs', parent: 0 }),
    /already holds that slug/,
  );
});

test('every route is built from the collection it was given', async () => {
  // A custom post type is the same five operations against a different route,
  // and a literal `/pages` left behind anywhere would reach the wrong one — or
  // succeed against real pages, which is worse.
  const fake = createFakeWp({ restBase: 'pterodocs_release', pages: [{ id: 7, slug: 'v1', parent: 0 }] });
  const api = createPostsApi(client(fake), 'pterodocs_release');

  await api.fetchIndex();
  await api.fetchOne(7);
  await api.find(0, 'v1');
  await api.create({ title: 'v2', slug: 'v2', parent: 0 });
  await api.update(7, { title: 'v1.1' });
  await api.trash(7);

  const paths = new Set(fake.calls.map((call) => call.path));
  assert.deepEqual([...paths].sort(), ['/pterodocs_release', '/pterodocs_release/7']);
});

test('a post the collection would not accept names that collection, not pages', async () => {
  const fake = createFakeWp({ restBase: 'pterodocs_release', pages: [{ id: 1, slug: 'v1', parent: 0 }] });
  await assert.rejects(
    () => createPostsApi(client(fake), 'pterodocs_release').create({ slug: 'v1', parent: 0 }),
    (error: TargetError) => error.url === '/pterodocs_release',
  );
});

test('removing a page trashes it', async () => {
  const fake = createFakeWp({ pages: [{ id: 7, slug: 'gone', parent: 1 }] });
  await posts(fake).trash(7);
  assert.equal(fake.calls.at(-1)!.method, 'DELETE');
  assert.equal(fake.calls.at(-1)!.query['force'], undefined);
  assert.equal(fake.pages.find((page) => page.id === 7)!.status, 'trash');
});

test('the method override turns a DELETE into a POST for restrictive hosts', async () => {
  const fake = createFakeWp({ pages: [{ id: 7, slug: 'gone', parent: 1 }] });
  await posts(fake, { methodOverride: true }).trash(7);
  const call = fake.calls.at(-1)!;
  assert.equal(call.method, 'POST');
  assert.equal(call.routedAs, 'DELETE');
  assert.equal(fake.pages.find((page) => page.id === 7)!.status, 'trash');
});

test('the diff reports only fields that really differ', () => {
  const remote: RemotePage = {
    id: 1,
    parent: 3,
    slug: 'a',
    status: 'publish',
    link: '',
    title: 'A',
    content: 'body\n',
    excerpt: 'x',
    menuOrder: 10,
    template: '',
    meta: { seo: 'x' },
  };
  const rendered: RenderedPage = {
    path: 'a',
    slug: 'a',
    title: 'A',
    content: 'body',
    excerpt: 'x',
    menuOrder: 10,
    meta: { seo: 'x' },
  };
  const context = { parentId: 3, status: 'publish', template: '', isRoot: false, slug: 'a' };

  assert.deepEqual(diffPage(remote, rendered, context), []);
  assert.deepEqual(diffPage(remote, { ...rendered, menuOrder: 20 }, context), ['menu_order']);
  assert.deepEqual(diffPage(remote, { ...rendered, menuOrder: 20 }, { ...context, isRoot: true }), []);
  assert.deepEqual(diffPage(remote, rendered, { ...context, parentId: 9 }), ['parent']);
  assert.deepEqual(diffPage(remote, { ...rendered, meta: { seo: 'y' } }, context), ['meta.seo']);
});

test('metadata the site does not expose is not reported as a difference', () => {
  const remote: RemotePage = {
    id: 1, parent: 0, slug: 'a', status: 'publish', link: '', title: 'A',
    content: '', excerpt: '', menuOrder: 0, template: '', meta: {},
  };
  const rendered: RenderedPage = {
    path: 'a', slug: 'a', title: 'A', content: '', excerpt: '', menuOrder: 0,
    meta: { advanced_seo_description: 'something' },
  };
  assert.deepEqual(
    diffPage(remote, rendered, { parentId: 0, status: 'publish', template: '', isRoot: false, slug: 'a' }),
    [],
  );
});

test('pruning lists the deepest pages first and keeps what it was told to', () => {
  const index = [
    { id: 1, parent: 0, slug: 'docs' },
    { id: 2, parent: 1, slug: 'section' },
    { id: 3, parent: 2, slug: 'leaf' },
    { id: 4, parent: 99, slug: 'elsewhere' },
  ] as RemotePage[];
  assert.deepEqual(computePrune(index, 1, new Set()).map((page) => page.id), [3, 2]);
  assert.deepEqual(computePrune(index, 1, new Set([2, 3])), []);
});

test('URL policy adds a segment only for a version or locale that is not primary', () => {
  const policy = { rootSegments: ['docstack'], baseSegments: ['docs'] };
  assert.equal(hrefFor(policy, 'guides/sync', { versionName: 'current', locale: 'en' }), '/docstack/docs/guides/sync/');
  assert.equal(hrefFor(policy, '', { versionName: 'current', locale: 'en' }), '/docstack/docs/');

  const versioned = { ...policy, primaryVersion: 'current', primaryLocale: 'en' };
  assert.deepEqual(prefixSegments(versioned, { versionName: 'current', locale: 'en' }), ['docstack', 'docs']);
  assert.deepEqual(prefixSegments(versioned, { versionName: '1.0.0', locale: 'en' }), ['docstack', 'docs', '1-0-0']);
  assert.deepEqual(prefixSegments(versioned, { versionName: 'current', locale: 'fr' }), ['docstack', 'docs', 'fr']);
});

test('the last segment owns the tree and everything above it is only a stub', () => {
  assert.deepEqual(splitOwnership({ rootSegments: ['products', 'docstack'], baseSegments: ['docs'] }), {
    stubSegments: ['products', 'docstack'],
    rootSlug: 'docs',
  });
  assert.deepEqual(splitOwnership({ rootSegments: ['docs'], baseSegments: [] }), {
    stubSegments: [],
    rootSlug: 'docs',
  });
  assert.throws(() => splitOwnership({ rootSegments: [], baseSegments: [] }), /nowhere to publish/);
});

test('a media slug carries the content hash both ways', () => {
  assert.equal(mediaSlug('pterodocs', 'abc123'), 'pterodocs-abc123');
  assert.equal(hashFromSlug('pterodocs', 'pterodocs-0123456789abcdef'), '0123456789abcdef');
  assert.equal(hashFromSlug('pterodocs', 'something-else'), undefined);
  assert.equal(hashFromSlug('pterodocs', 'pterodocs-short'), undefined);
});
