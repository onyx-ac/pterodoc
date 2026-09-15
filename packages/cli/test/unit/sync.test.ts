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
import { createFakeWp, makePage, type FakeWp } from '../../../wordpress/test/fixtures/fake-wp';

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
      taxonomy: config.taxonomy,
      categoryPath: config.categoryPath,
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
async function setup(
  overrides: Partial<ResolvedConfig> = {},
  fake = createFakeWp(),
  mutate: (model: SiteModel, dir: string) => Promise<void> | void = () => {},
) {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pterodocs-out-'));
  const { model, dir } = await siteOnDisk();
  await mutate(model, dir);
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
  t.fake.pages.push(
    makePage({
      id,
      parent: docs.id,
      slug: `orphan-${id}`,
      title: { raw: 'Orphan', rendered: 'Orphan' },
      content: { raw: content },
    }),
  );
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
 * A run against a flat collection: posts, not a page subtree.
 *
 * Everything a release-notes run does differently, short of the config profile
 * that selects it: ordinary posts, no page at the root, nothing above them
 * created, and no nesting -- a post has no parent to nest under.
 */
async function flatRun(overrides: Partial<ResolvedConfig> = {}) {
  return setup(
    {
      restBase: 'posts',
      ownership: 'flat',
      menuOrder: 'none',
      layout: { ...DEFAULT_LAYOUT, kind: 'single', nav: 'none' },
      ...overrides,
    },
    createFakeWp({ restBase: 'posts' }),
  );
}

test('a flat run creates no stub pages and no root of its own', async () => {
  // Nothing above a post is a page: `products` and `docstack` are a path the
  // documentation uses, and writing them here would be pterodocs inventing
  // pages nobody asked for.
  const t = await flatRun();
  const { plan } = await t.run();

  assert.equal(plan.summary['create-root'], undefined, 'it created stubs');
  assert.deepEqual(
    t.fake.pages.map((page) => page.slug),
    ['alpha', 'first', 'second', 'beta', 'child'],
    'the tree root was published as a post',
  );
  await t.cleanup();
});

test('a post is never given a parent or a position', async () => {
  // Neither field is on a post's REST schema. Sending them is at best ignored
  // and at worst a 400, and either way the values would mean nothing.
  const t = await flatRun();
  await t.run();

  for (const call of t.fake.calls.filter((one) => one.routedAs === 'POST')) {
    assert.equal(call.body['parent'], undefined, JSON.stringify(call.body).slice(0, 120));
    assert.equal(call.body['menu_order'], undefined, JSON.stringify(call.body).slice(0, 120));
  }
  await t.cleanup();
});

test('a flat run is idempotent', async () => {
  const t = await flatRun();
  await t.run();
  const { plan } = await t.run();

  assert.equal(plan.summary['create'], undefined);
  assert.equal(plan.summary['update'], undefined);
  assert.equal(plan.summary['unchanged'], 5);
  await t.cleanup();
});

test('a flat run never touches the pages collection', async () => {
  // A release note is not a page. A route literal left behind would not fail
  // -- it would quietly read, and then write, the site's real pages.
  const t = await flatRun();
  await t.run();

  const pages = t.fake.calls.filter((call) => /^\/pages(\/|$)/.test(call.path));
  assert.deepEqual(pages, [], 'it reached the pages collection');
  assert.ok(t.fake.calls.some((call) => call.path === '/posts'), 'it never reached posts either');
  await t.cleanup();
});

test('only posts pterodocs wrote are pruned, never the site’s own', async () => {
  // The collection is every post on the site, so the walk from 0 reaches
  // other people's writing. The ownership marker is the only thing between
  // that and pterodocs trashing it.
  const t = await flatRun({ prune: true });
  await t.run();

  t.fake.pages.push(
    makePage({ id: 5000, slug: 'withdrawn', meta: { _pterodocs_source: 'pterodocs' } }),
    makePage({ id: 5001, slug: 'someones-post', content: { raw: '<p>Mine.</p>' } }),
  );

  const { plan } = await t.run();
  assert.equal(plan.summary['prune'], 1, JSON.stringify(plan.summary));
  assert.equal(t.fake.pages.find((page) => page.id === 5000)!.status, 'trash');
  assert.equal(t.fake.pages.find((page) => page.id === 5001)!.status, 'publish', 'it took a post of theirs');
  await t.cleanup();
});

/**
 * A model holding a blog beside its documentation, which is what Docusaurus
 * hands back for a site that has both.
 */
async function withBlog(overrides: Partial<ResolvedConfig> = {}, fake = createFakeWp()) {
  return setup(overrides, fake, async (model, dir) => {
    const file = path.join(dir, 'blog', '2026-01-01-v2.md');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `What changed in v2.${String.fromCharCode(10)}`);

    model.instances.push({
      id: 'blog',
      kind: 'blog',
      routeBasePath: 'blog',
      contentDirName: 'blog',
      admonitionKeywords: [],
      breadcrumbs: false,
      versions: [
        {
          name: 'current',
          label: 'Release notes',
          isLast: true,
          pathPrefix: '/blog',
          contentPath: path.join(dir, 'blog'),
          contentPathLocalized: path.join(dir, 'blog'),
          banner: null,
          noIndex: false,
          draftCount: 0,
          sidebars: {
            blog: [{ type: 'doc', id: 'v2', label: 'v2' }],
          },
          docs: [
            {
              id: 'v2',
              versionName: 'current',
              title: 'v2',
              description: 'What changed in v2.',
              sourceAliased: '@site/blog/2026-01-01-v2.md',
              sourceAbsolutePath: file,
              sourceRelativePath: 'blog/2026-01-01-v2.md',
              sourceDirName: '.',
              slug: '/v2',
              permalink: '/blog/v2',
              treePath: 'v2',
              draft: false,
              unlisted: false,
              frontMatter: {},
              sidebarName: 'blog',
              date: '2026-01-01T09:30:00.482Z',
              authors: [{ name: 'Onyx' }],
              tags: [
                { label: 'release', permalink: '/blog/tags/release' },
                { label: 'client', permalink: '/blog/tags/client' },
              ],
              format: 'md',
            },
          ],
        },
      ],
    });
  });
}

test('a docs run leaves the blog where it found it', async () => {
  // Both are instances of the same model. Without the filter a `sidebars: all`
  // run picks the blog's sidebar up and publishes release notes as pages.
  const t = await withBlog({ sidebars: 'all' });
  await t.run();

  assert.equal(
    t.fake.pages.some((page) => page.slug === 'v2'),
    false,
    'a release note was published as a page',
  );
  await t.cleanup();
});

test('a blog run publishes the blog and nothing else', async () => {
  const t = await withBlog({ publish: 'blog', sidebars: ['blog'] });
  await t.run();

  const published = t.fake.pages.map((page) => page.slug);
  assert.ok(published.includes('v2'), published.join(', '));
  for (const slug of ['alpha', 'first', 'beta', 'child']) {
    assert.equal(published.includes(slug), false, `${slug} came along`);
  }
  await t.cleanup();
});

test('a dated post is sent as an instant, and stays put on a second run', async () => {
  // The two ways this churns forever: `date` is the site's timezone, so two
  // sites disagree about the same moment; and WordPress returns `date_gmt`
  // with no zone marker and whole seconds, so a string compare always differs.
  const t = await withBlog({ publish: 'blog', sidebars: ['blog'] });
  await t.run();

  const sent = t.fake.calls.filter((call) => call.body['date_gmt'] !== undefined);
  assert.equal(sent.length, 1, 'the date was never sent');
  assert.equal(sent[0]!.body['date_gmt'], '2026-01-01T09:30:00', 'not the stored shape');
  assert.equal(sent[0]!.body['date'], undefined, 'the site-timezone field was sent');
  assert.equal(t.fake.pages.find((page) => page.slug === 'v2')!.date_gmt, '2026-01-01T09:30:00');

  const { plan } = await t.run();
  assert.equal(plan.summary['update'], undefined, JSON.stringify(plan.summary));
  await t.cleanup();
});

test('a post dated ahead of now is scheduled, said so, and not fought over', async () => {
  const t = await withBlog({ publish: 'blog', sidebars: ['blog'] });
  t.model.instances.at(-1)!.versions[0]!.docs[0]!.date = '2099-01-01T00:00:00.000Z';

  const first = await t.run();
  assert.equal(t.fake.pages.find((page) => page.slug === 'v2')!.status, 'future');
  assert.ok(
    first.plan.issues.some((issue) => /in the future/.test(issue.message)),
    'the reader was not told it would be held back',
  );

  // And the held-back status is not a difference to be corrected every run.
  const { plan } = await t.run();
  assert.equal(plan.summary['update'], undefined, JSON.stringify(plan.summary));
  await t.cleanup();
});

/**
 * A full `--blog` run: the config profile selects everything, rather than the
 * test setting the seven scalars it happens to know about.
 */
async function blogRun(withTags = true) {
  const fake = createFakeWp({
    restBase: 'posts',
    taxonomy: 'tags',
    terms: withTags ? [{ id: 40, name: 'release', slug: 'release' }] : [],
  });
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pterodocs-out-'));
  // No `outDir` of its own: the profile decides it, and that is the thing
  // under test in the second case below.
  const config = resolveConfig({
    flags: { blog: true },
    env: { WP_URL: 'https://example.test', WP_USER: 'someone', WP_APP_PASSWORD: 'secret' },
    file: {
      target: { root: '/products/docstack', base: 'docs' },
      render: { classPrefix: 'x' },
      media: { upload: false },
      blog: { category: 'Release notes', tags: withTags },
    },
    fileDir: outDir,
  });

  return withBlog(config, fake);
}

test('a --blog run publishes ordinary posts, filed under a category', async () => {
  const t = await blogRun();
  const { plan } = await t.run();

  assert.equal(plan.summary['create-root'], undefined, 'it created stub pages');
  assert.deepEqual(t.fake.pages.map((page) => page.slug), ['v2']);

  const post = t.fake.pages[0]!;
  assert.equal(post.date_gmt, '2026-01-01T09:30:00');
  assert.equal(post.meta['_pterodocs_source'], 'pterodocs', 'nothing marks it as ours');

  // A post is a body: nothing beside it to navigate, nothing to page through,
  // and `page-list` with no root would list every page on the site.
  assert.equal(post.content.raw.includes('page-list'), false, post.content.raw.slice(0, 300));

  const { plan: second } = await t.run();
  assert.equal(second.summary['create'], undefined);
  assert.equal(second.summary['update'], undefined);
  assert.equal(second.summary['unchanged'], 1);
  await t.cleanup();
});

test('the category is created as a path, mirroring the documentation root', async () => {
  // A post's URL cannot be moved under the documentation, so the category is
  // where the two are made to line up.
  const t = await blogRun();
  await t.run();

  const named = (name: string) => t.fake.terms.find((term) => term.name === name && term.taxonomy === 'categories');
  const products = named('Products');
  const docstack = named('Docstack');
  const releases = named('Release notes');

  assert.ok(products && docstack && releases, t.fake.terms.map((term) => term.name).join(', '));
  assert.equal(products!.parent, 0);
  assert.equal(docstack!.parent, products!.id);
  assert.equal(releases!.parent, docstack!.id);

  // Filed under the leaf, not under every level of the path.
  assert.deepEqual(t.fake.pages[0]!['categories'], [releases!.id]);
  await t.cleanup();
});

test('the category path is walked once, not once per post', async () => {
  const t = await blogRun();
  await t.run();
  const created = t.fake.terms.filter((term) => term.taxonomy === 'categories').length;

  await t.run();
  assert.equal(
    t.fake.terms.filter((term) => term.taxonomy === 'categories').length,
    created,
    'it made the category tree again',
  );
  await t.cleanup();
});

test('a --blog run writes where a docs run would not overwrite it', async () => {
  // Writing the artefacts clears the directory they go into, so sharing one
  // would mean whichever run went second destroyed the other's output.
  const t = await blogRun();
  await t.run();

  assert.equal(path.basename(t.config.outDir), 'blog', t.config.outDir);
  assert.ok((await fs.readdir(t.config.outDir)).includes('pages'));
  await t.cleanup();
});

test('tags become real terms, existing ones reused and new ones created', async () => {
  // WordPress takes term ids over REST, not names, so a tag can only be
  // written once the site has a term for it.
  const t = await blogRun();
  await t.run();

  const release = t.fake.terms.find((term) => term.name === 'release' && term.taxonomy === 'tags')!;
  const client = t.fake.terms.find((term) => term.name === 'client' && term.taxonomy === 'tags');
  assert.equal(release.id, 40, 'the existing term was duplicated rather than reused');
  assert.ok(client, 'the missing term was never created');

  assert.deepEqual(
    (t.fake.pages[0]!['tags'] as number[]).slice().sort((a, b) => a - b),
    [release.id, client!.id].sort((a, b) => a - b),
  );
  await t.cleanup();
});

test('tags do not churn on a second run', async () => {
  // Terms come back in whatever order WordPress likes, and as ids where the
  // document wrote names -- either would differ forever if compared naively.
  const t = await blogRun();
  await t.run();
  const created = t.fake.terms.length;

  const { plan } = await t.run();
  assert.equal(plan.summary['update'], undefined, JSON.stringify(plan.summary));
  assert.equal(t.fake.terms.length, created, 'it created the terms all over again');
  await t.cleanup();
});

test('tags turned off publish the posts, not nothing', async () => {
  const t = await blogRun(false);
  await t.run();

  assert.ok(t.fake.pages.find((page) => page.slug === 'v2'), 'the post was not published');
  assert.equal(t.fake.calls.some((call) => call.path === '/tags'), false, 'it asked for tags anyway');
  await t.cleanup();
});

test('an author the source names is reported, not silently dropped', async () => {
  // WordPress renders the byline itself, from the account that wrote the post.
  // Publishing our own would duplicate or contradict it, and mapping the name
  // to a user means creating or matching accounts -- so it is said instead.
  const t = await blogRun();
  const { plan } = await t.run();

  const said = plan.issues.find((issue) => issue.code === 'authors-not-mapped');
  assert.ok(said, plan.issues.map((issue) => issue.code).join(', '));
  assert.match(said!.message, /Onyx/);
  await t.cleanup();
});

test('documentation with no authors says nothing about them', async () => {
  const t = await setup();
  const { plan } = await t.run();

  assert.equal(plan.issues.some((issue) => issue.code === 'authors-not-mapped'), false);
  await t.cleanup();
});
