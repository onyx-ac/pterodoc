/** The reconciler, end to end against an in-memory WordPress. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCapture } from '@pterodocs/core/model';
import { createMemoryReader } from '@pterodocs/core/model';
import { DEFAULT_LAYOUT, resolveConfig, type ResolvedConfig } from '@pterodocs/core';
import { createWordpressTarget } from '@pterodocs/wordpress';
import { runSync } from '@pterodocs/core';
import type { SiteModel } from '@pterodocs/core/model';
import { createFakeWp, type FakeWp } from '../../../wordpress/test/fixtures/fake-wp';

// Captured models are a core artefact and live with core's fixtures.
const fixtures = path.dirname(
  fileURLToPath(new URL('../../../core/test/fixtures/x', import.meta.url)),
);

/** A site whose documents exist on disk, so bodies can actually be read. */
async function siteOnDisk(): Promise<{ model: SiteModel; dir: string }> {
  const model = await readCapture(path.join(fixtures, 'models', 'mini.model.json'));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pterodocs-site-'));

  const version = model.instances[0]!.versions[0]!;
  for (const doc of version.docs) {
    const file = path.join(dir, doc.sourceRelativePath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `Body of ${doc.title}, linking to [the first page](./alpha/first.md).\n`);
    doc.sourceAbsolutePath = file;
  }
  model.siteDir = dir;
  version.contentPath = path.join(dir, 'docs');
  version.contentPathLocalized = version.contentPath;
  return { model, dir };
}

/** A configuration writing to a scratch directory. */
function configFor(outDir: string, overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  const config = resolveConfig({
    env: { WP_URL: 'https://example.test', WP_USER: 'someone', WP_APP_PASSWORD: 'secret' },
    file: {
      site: { sidebars: ['docs'] },
      target: { root: '/products/docstack', base: 'docs', meta: { description: 'seo' } },
      render: { classPrefix: 'x' },
      media: { upload: false },
    },
    fileDir: outDir,
  });
  return { ...config, outDir, ...overrides };
}

function targetFor(config: ResolvedConfig, fake: FakeWp) {
  return createWordpressTarget(
    {
      url: config.targetUrl,
      user: config.user,
      appPassword: config.appPassword,
      policy: { rootSegments: config.rootSegments, baseSegments: config.baseSegments },
      restBase: config.restBase,
      ownership: config.ownership,
      status: config.status,
      template: config.template,
      lang: config.lang,
      mediaSlugPrefix: config.mediaSlugPrefix,
      methodOverride: config.methodOverride,
    },
    { fetch: fake.fetch, sleep: async () => {} },
  );
}

/** Set up a run: a site on disk, a fake WordPress, and somewhere to write. */
async function setup(overrides: Partial<ResolvedConfig> = {}, fake = createFakeWp()) {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pterodocs-out-'));
  const { model, dir } = await siteOnDisk();
  const config = configFor(outDir, overrides);
  const reader = createMemoryReader(model);
  return {
    config,
    model,
    reader,
    fake,
    outDir,
    cleanup: async () => {
      await fs.rm(outDir, { recursive: true, force: true });
      await fs.rm(dir, { recursive: true, force: true });
    },
    run: () => runSync(config, { reader, target: targetFor(config, fake) }),
  };
}

test('an empty site gets the path pages and the whole tree', async () => {
  const t = await setup();
  const { plan } = await t.run();

  assert.equal(plan.summary['create-root'], 2, 'products and docstack');
  assert.equal(plan.summary['create'], 6, 'the docs page plus five pages');
  assert.equal(plan.summary['update'], 6);

  assert.deepEqual(
    t.fake.pages.map((page) => page.slug),
    ['products', 'docstack', 'docs', 'alpha', 'first', 'second', 'beta', 'child'],
  );
  for (const page of t.fake.pages) assert.equal(page.status, 'publish', page.slug);

  // The navigation points at the documentation page, not at a placeholder.
  const docs = t.fake.pages.find((page) => page.slug === 'docs')!;
  const child = t.fake.pages.find((page) => page.slug === 'child')!;
  assert.ok(child.content.raw.includes(`"parentPageID":${docs.id}`), child.content.raw.slice(0, 200));
  await t.cleanup();
});

test('running twice changes nothing the second time', async () => {
  const t = await setup();
  await t.run();
  const { plan } = await t.run();

  assert.equal(plan.summary['create'], undefined);
  assert.equal(plan.summary['update'], undefined);
  assert.equal(plan.summary['unchanged'], 6);
  await t.cleanup();
});

test('a page edited on the site is put back, and the change is named', async () => {
  const t = await setup();
  await t.run();

  const child = t.fake.pages.find((page) => page.slug === 'child')!;
  child.content = { raw: '<!-- wp:paragraph --><p>Edited by hand.</p><!-- /wp:paragraph -->' };
  child.title = { raw: 'Renamed', rendered: 'Renamed' };

  const { plan } = await t.run();
  const update = plan.actions.find((action) => action.op === 'update')!;
  assert.deepEqual([...update.changed!].sort(), ['content', 'title']);
  assert.equal(t.fake.pages.find((page) => page.id === child.id)!.title.raw, 'Child');
  await t.cleanup();
});

test('a dry run reads but never writes', async () => {
  const t = await setup({ dryRun: true });
  const { plan } = await t.run();

  assert.equal(plan.dryRun, true);
  assert.equal(t.fake.calls.some((call) => call.routedAs !== 'GET'), false);
  assert.equal(t.fake.pages.length, 0);
  assert.ok((plan.summary['create'] ?? 0) > 0);

  const rendered = await fs.readFile(path.join(t.outDir, 'pages', 'en', 'current', 'index.html'), 'utf8');
  assert.ok(rendered.includes('wp:columns'));
  const written = JSON.parse(await fs.readFile(path.join(t.outDir, 'plan.json'), 'utf8')) as {
    rootPath: string;
  };
  assert.equal(written.rootPath, '/products/docstack/docs/');
  await t.cleanup();
});

test('a render with no target contacts nothing', async () => {
  const t = await setup();
  const { plan } = await runSync(t.config, {
    reader: t.reader,
    target: targetFor(t.config, t.fake),
    renderOnly: true,
  });
  assert.equal(t.fake.calls.length, 0);
  assert.equal(plan.actions.length, 0);
  await t.cleanup();
});

test('pages along the root path are created once and never edited again', async () => {
  const fake = createFakeWp({
    pages: [
      {
        id: 5,
        slug: 'products',
        parent: 0,
        title: { raw: 'Our products', rendered: 'Our products' },
        content: { raw: 'Hand written.' },
      },
    ],
  });
  const t = await setup({}, fake);
  await t.run();

  const products = fake.pages.find((page) => page.id === 5)!;
  assert.equal(products.title.raw, 'Our products');
  assert.equal(products.content.raw, 'Hand written.');
  assert.equal(fake.writes.includes(5), false, 'the existing page must not be written to');
  await t.cleanup();
});

/** Add a page under the documentation root that no document accounts for. */
function orphan(t: Awaited<ReturnType<typeof setup>>, id: number, content: string): void {
  const docs = t.fake.pages.find((page) => page.slug === 'docs')!;
  t.fake.pages.push({
    id,
    parent: docs.id,
    slug: `orphan-${id}`,
    status: 'publish',
    link: `https://example.test/orphan-${id}/`,
    title: { raw: 'Orphan', rendered: 'Orphan' },
    content: { raw: content },
    excerpt: { raw: '' },
    menu_order: 0,
    template: '',
    meta: {},
  });
}

test('a page with no source document is reported, and only trashed when asked', async () => {
  const t = await setup();
  await t.run();

  // Written by pterodocs: it carries the class prefix pterodocs composes with.
  orphan(t, 999, `<!-- wp:columns {"className":"${t.config.classPrefix}-docs"} --><div></div><!-- /wp:columns -->`);

  const reported = await t.run();
  const prune = reported.plan.actions.find((action) => action.op === 'prune')!;
  assert.equal(prune.id, 999);
  assert.equal(prune.applied, false);
  assert.equal(t.fake.pages.find((page) => page.id === 999)!.status, 'publish');

  const pruning = { ...t.config, prune: true };
  await runSync(pruning, { reader: t.reader, target: targetFor(pruning, t.fake) });
  assert.equal(t.fake.pages.find((page) => page.id === 999)!.status, 'trash');
  await t.cleanup();
});

test('a page somebody else put under the documentation root is never trashed', async () => {
  // Position inside the tree is not ownership. Pruning by position alone would
  // make pterodocs delete work it did not do.
  const t = await setup();
  await t.run();

  orphan(t, 998, '<!-- wp:paragraph --><p>Written by a person.</p><!-- /wp:paragraph -->');

  const pruning = { ...t.config, prune: true };
  const { plan } = await runSync(pruning, { reader: t.reader, target: targetFor(pruning, t.fake) });

  assert.equal(t.fake.pages.find((page) => page.id === 998)!.status, 'publish');
  assert.equal(plan.actions.some((action) => action.op === 'prune' && action.id === 998), false);
  assert.ok(plan.issues.some((issue) => issue.code === 'prune-skipped-foreign'));
  await t.cleanup();
});

test('--only restricts the writes and turns pruning off', async () => {
  const t = await setup();
  await t.run();
  for (const page of t.fake.pages) page.content = { raw: 'wiped' };

  const scoped = { ...t.config, only: 'alpha', prune: true };
  const { plan } = await runSync(scoped, { reader: t.reader, target: targetFor(scoped, t.fake) });

  assert.deepEqual(
    plan.actions.filter((action) => action.op === 'update').map((action) => action.path).sort(),
    ['alpha', 'alpha/first', 'alpha/second'],
  );
  assert.equal(t.fake.pages.find((page) => page.slug === 'child')!.content.raw, 'wiped');
  assert.ok(plan.issues.some((issue) => issue.code === 'prune-skipped'));
  await t.cleanup();
});

test('--only on an empty site creates the scope and its parents, nothing else', async () => {
  const t = await setup({ only: 'alpha' });
  await t.run();

  assert.deepEqual(
    t.fake.pages.map((page) => page.slug).sort(),
    ['alpha', 'docs', 'docstack', 'first', 'products', 'second'],
  );
  for (const page of t.fake.pages) {
    assert.notEqual(page.content.raw, '', `${page.slug} should have been rendered`);
    assert.equal(page.status, 'publish');
  }
  await t.cleanup();
});

test('the run writes a manifest and a plan that describe what happened', async () => {
  const t = await setup();
  const { plan } = await t.run();

  const manifest = JSON.parse(await fs.readFile(path.join(t.outDir, 'manifest.json'), 'utf8')) as {
    path: string;
    href: string;
    locale: string;
  }[];
  assert.equal(manifest.length, 6);
  assert.equal(manifest.find((entry) => entry.path === 'beta/child')!.href, '/products/docstack/docs/beta/child/');
  assert.equal(manifest[0]!.locale, 'en');

  assert.equal(plan.versions.pterodocs.length > 0, true);
  assert.equal(plan.artifactError, null);
  assert.ok(plan.requests > 0);
  await t.cleanup();
});

/* ---------------------------------------------------------------------- *
 * llms.txt
 * ---------------------------------------------------------------------- */

test('the documentation root carries the files an LLM reads', async () => {
  // The plugin serves what it finds here, so this is the whole delivery.
  const t = await setup();
  await t.run();

  const docs = t.fake.pages.find((page) => page.slug === 'docs')!;
  const index = docs.meta['_pterodocs_llms_index'] as string;

  assert.ok(index, 'no index was stored');
  assert.ok(index.startsWith('# '), index.slice(0, 40));
  assert.ok(typeof docs.meta['_pterodocs_llms_full'] === 'string');
  await t.cleanup();
});

test('the links in it are the target’s, not the source site’s', async () => {
  // The reason this is generated rather than copied from a build.
  const t = await setup();
  await t.run();

  const docs = t.fake.pages.find((page) => page.slug === 'docs')!;
  const index = docs.meta['_pterodocs_llms_index'] as string;

  for (const line of index.split('\n').filter((l) => l.includes(']('))) {
    assert.ok(line.includes('/products/docstack/docs/'), line);
  }
  await t.cleanup();
});

test('nothing is stored on the site when publishing them is turned off', async () => {
  const t = await setup({ llms: { index: true, full: true, publish: false, title: '', description: '' } });
  await t.run();

  const docs = t.fake.pages.find((page) => page.slug === 'docs')!;
  assert.equal(docs.meta['_pterodocs_llms_index'], undefined);
  await t.cleanup();
});

test('they are written to the output directory whether or not they are published', async () => {
  const t = await setup({ llms: { index: true, full: true, publish: false, title: '', description: '' } });
  await t.run();

  const index = await fs.readFile(path.join(t.outDir, 'llms.txt'), 'utf8');
  assert.ok(index.startsWith('# '), index.slice(0, 40));
  await t.cleanup();
});

test('turning both off writes neither file and stores nothing', async () => {
  const t = await setup({ llms: { index: false, full: false, publish: true, title: '', description: '' } });
  await t.run();

  await assert.rejects(() => fs.readFile(path.join(t.outDir, 'llms.txt'), 'utf8'));
  const docs = t.fake.pages.find((page) => page.slug === 'docs')!;
  assert.equal(docs.meta['_pterodocs_llms_index'], undefined);
  await t.cleanup();
});

test('a site that refuses the metadata is warned about, not failed', async () => {
  // Refusing it is what a site without the plugin does, and the pages matter
  // more than the index.
  const fake = createFakeWp();
  const inner = fake.fetch;
  fake.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    if (body.includes('_pterodocs_llms_index')) {
      return new Response(JSON.stringify({ code: 'rest_invalid_param' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    return inner(url, init);
  };

  const t = await setup({}, fake);
  const { plan } = await t.run();

  assert.ok(
    plan.issues.some((issue) => issue.code === 'llms-not-stored'),
    JSON.stringify(plan.issues.map((i) => i.code)),
  );
  // The publish itself still happened.
  assert.equal(plan.summary['create'], 6);
  await t.cleanup();
});

/* ---------------------------------------------------------------------- *
 * Pages that cannot reach themselves
 * ---------------------------------------------------------------------- */

/**
 * Answer front-end requests with the body class WordPress writes.
 *
 * `served` decides which page id the site claims to have rendered; null omits
 * the class entirely, which is what a theme that never calls `body_class()`
 * looks like from outside.
 */
function servesPage(fake: FakeWp, served: (url: string) => number | null): void {
  const inner = fake.fetch;
  fake.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('/wp-json/')) return inner(url, init);

    const id = served(href);
    const body =
      id === null
        ? '<html><body class="page"></body></html>'
        : `<html><body class="page page-id-${id}"></body></html>`;
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  };
}

/** The id of the page whose slug ends the URL, as the real site would serve. */
const itself = (fake: FakeWp) => (url: string): number | null => {
  const slug = url.replace(/\/+$/, '').split('/').pop() ?? '';
  return fake.pages.find((page) => page.slug === slug)?.id ?? null;
};

test('a published page that does not serve itself is reported', async () => {
  // The failure this exists for: a rewrite endpoint claims the path, so the
  // URL answers 200 with somebody else's page and nothing else notices.
  const fake = createFakeWp();
  servesPage(fake, () => 4242);

  const t = await setup({}, fake);
  const { plan } = await t.run();

  const shadowed = plan.issues.filter((issue) => issue.code === 'page-shadowed');
  assert.ok(shadowed.length > 0, 'nothing was reported');
  assert.match(shadowed[0]!.message, /does not serve itself/);
  assert.match(shadowed[0]!.message, /4242/);
  await t.cleanup();
});

test('a page that serves itself is not reported', async () => {
  const fake = createFakeWp();
  servesPage(fake, itself(fake));

  const t = await setup({}, fake);
  const { plan } = await t.run();

  assert.deepEqual(plan.issues.filter((issue) => issue.code === 'page-shadowed'), []);
  await t.cleanup();
});

test('a site that cannot be identified is left alone rather than guessed at', async () => {
  // No `page-id` class means the check has no answer. A warning nobody can act
  // on is worse than none.
  const fake = createFakeWp();
  servesPage(fake, () => null);

  const t = await setup({}, fake);
  const { plan } = await t.run();

  assert.deepEqual(plan.issues.filter((issue) => issue.code === 'page-shadowed'), []);
  await t.cleanup();
});

test('only pages that were created are checked', async () => {
  // A page that merely changed resolved on an earlier run already, so checking
  // it again is a request each to learn nothing.
  const fake = createFakeWp();
  const t = await setup({}, fake);
  await t.run();

  // Now make every URL answer with the wrong page, and run again. Nothing is
  // created this time, so nothing should be checked.
  servesPage(fake, () => 4242);
  const { plan } = await t.run();

  assert.deepEqual(plan.issues.filter((issue) => issue.code === 'page-shadowed'), []);
  await t.cleanup();
});

/* ---------------------------------------------------------------------- *
 * Where a header entry points
 * ---------------------------------------------------------------------- */

/** The stored content of one published page. */
const contentOf = (fake: FakeWp, slug: string): string =>
  fake.pages.find((page) => page.slug === slug)!.content.raw;

/** A run whose site declares a navbar covering each kind of destination. */
async function withNavbar() {
  const t = await setup();
  t.config.layout = { ...t.config.layout, header: true };

  const published = t.model.instances[0]!.versions[0]!.docs[0]!;
  t.model.navbar = {
    title: 'Fixture',
    items: [
      { label: 'Published', href: published.permalink, position: 'left' },
      { label: 'Elsewhere', href: '/docs/api/reference', position: 'left' },
      { label: 'Workbench', href: 'pathname:///app/index.html', position: 'right' },
      { label: 'Repo', href: 'https://example.test/repo', position: 'right' },
    ],
  };
  return t;
}

test('a header entry naming a published page points at the target', async () => {
  const t = await withNavbar();
  await t.run();

  const published = t.model.instances[0]!.versions[0]!.docs[0]!;
  const content = contentOf(t.fake, 'docs');

  assert.ok(content.includes('>Published<'), 'the entry is missing');
  assert.equal(content.includes(`href="${published.permalink}"`), false, 'it kept the Docusaurus URL');
  assert.ok(/href="\/products\/docstack\/docs\/[^"]*">Published</.test(content), content.slice(content.indexOf('Published') - 120, content.indexOf('Published') + 20));
  await t.cleanup();
});

test('a header entry nothing publishes points at the documentation site', async () => {
  // A site-relative path means something different on WordPress, and usually
  // nothing at all. It becomes the URL Docusaurus itself serves -- the same
  // answer a link inside a document gets.
  const t = await withNavbar();
  await t.run();

  const content = contentOf(t.fake, 'docs');
  assert.ok(
    content.includes(`href="${t.model.url}/docs/api/reference">Elsewhere<`),
    content.slice(content.indexOf('Elsewhere') - 140, content.indexOf('Elsewhere') + 20),
  );
  await t.cleanup();
});

test('a pathname:// entry loses the prefix Docusaurus reads', async () => {
  // Left as written it is not a URL at all, and the link goes nowhere.
  const t = await withNavbar();
  await t.run();

  const content = contentOf(t.fake, 'docs');
  assert.equal(content.includes('pathname://'), false, 'the prefix survived');
  assert.ok(content.includes(`href="${t.model.url}/app/index.html">Workbench<`), 'not pointed at the site');
  await t.cleanup();
});

test('an entry that already names a host is left alone', async () => {
  const t = await withNavbar();
  await t.run();

  assert.ok(contentOf(t.fake, 'docs').includes('href="https://example.test/repo">Repo<'));
  await t.cleanup();
});

/**
 * A run against a tree that owns a collection of its own.
 *
 * Everything a release-notes run does differently, short of the config profile
 * that will select it: a post type of its own, no page at the root, and a path
 * that belongs to the post type's rewrite base rather than to any page.
 */
async function namespaced(overrides: Partial<ResolvedConfig> = {}) {
  return setup(
    {
      rootSegments: ['products', 'docstack', 'releases'],
      baseSegments: [],
      restBase: 'pterodocs_release',
      ownership: 'namespace',
      layout: { ...DEFAULT_LAYOUT, nav: 'none' },
      ...overrides,
    },
    createFakeWp({ restBase: 'pterodocs_release' }),
  );
}

test('a namespaced tree creates no stub pages and no root of its own', async () => {
  // The path is the post type's rewrite base, so `products` and `docstack` are
  // not pages here -- writing them would be pterodocs inventing pages nobody
  // asked for, in a collection WordPress generates the index for.
  const t = await namespaced();
  const { plan } = await t.run();

  assert.equal(plan.summary['create-root'], undefined, 'it created stubs');
  assert.deepEqual(
    t.fake.pages.map((page) => page.slug),
    ['alpha', 'first', 'second', 'beta', 'child'],
    'the tree root was published as a post',
  );

  // The top of the tree hangs from the collection, not from a page.
  for (const slug of ['alpha', 'beta']) {
    assert.equal(t.fake.pages.find((page) => page.slug === slug)!.parent, 0, slug);
  }
  const alpha = t.fake.pages.find((page) => page.slug === 'alpha')!;
  assert.equal(t.fake.pages.find((page) => page.slug === 'first')!.parent, alpha.id, 'nesting was lost');
  await t.cleanup();
});

test('a namespaced run is idempotent', async () => {
  const t = await namespaced();
  await t.run();
  const { plan } = await t.run();

  assert.equal(plan.summary['create'], undefined);
  assert.equal(plan.summary['update'], undefined);
  assert.equal(plan.summary['unchanged'], 5);
  await t.cleanup();
});

test('a namespaced run never touches the pages collection', async () => {
  // The whole point of the post type is that release notes are not pages. A
  // route literal left behind would not fail -- it would quietly read, and
  // then write, the site's real pages.
  const t = await namespaced();
  await t.run();

  const pages = t.fake.calls.filter((call) => /^\/pages(\/|$)/.test(call.path));
  assert.deepEqual(pages, [], 'it reached the pages collection');
  assert.ok(
    t.fake.calls.some((call) => call.path === '/pterodocs_release'),
    'it never reached its own collection either',
  );
  await t.cleanup();
});

test('a post nothing accounts for is pruned without a root to anchor on', async () => {
  // The collection holds this tree and nothing else, so the walk starts at 0.
  // That is only safe because the index is the post type's own -- against
  // `pages` it would be every page on the site.
  const t = await namespaced({ prune: true });
  await t.run();

  t.fake.pages.push({
    id: 5000,
    parent: 0,
    slug: 'withdrawn',
    status: 'publish',
    link: 'https://example.test/products/docstack/releases/withdrawn/',
    title: { raw: 'Withdrawn', rendered: 'Withdrawn' },
    content: { raw: '<div class="x-docs"></div>' },
    excerpt: { raw: '' },
    menu_order: 0,
    template: '',
    meta: {},
  });

  const { plan } = await t.run();
  assert.equal(plan.summary['prune'], 1);
  assert.equal(t.fake.pages.find((page) => page.id === 5000)!.status, 'trash');
  await t.cleanup();
});
