/**
 * Removing documentation pterodocs published.
 *
 * The property that matters is not that it deletes, but what it refuses to
 * delete: a page it cannot recognise as its own is left standing, however
 * squarely it sits inside the tree being removed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { purgeTree, findByPath } from '@pterodocs/core';
import { createWordpressTarget } from '@pterodocs/wordpress';
import { createFakeWp, type FakeWp } from '../../../wordpress/test/fixtures/fake-wp';

const PREFIX = 'docstack';

/** Markup that carries pterodocs's signature. */
const generated = (): string =>
  `<!-- wp:columns {"className":"${PREFIX}-docs"} --><div class="wp-block-columns ${PREFIX}-docs"></div><!-- /wp:columns -->`;

/** A site with a documentation tree at /product/docstack/docs. */
function siteWithDocs(): FakeWp {
  const fake = createFakeWp();
  let next = 100;

  const add = (parent: number, slug: string, content: string): number => {
    const id = (next += 1);
    fake.pages.push({
      id,
      parent,
      slug,
      status: 'publish',
      link: `https://example.test/${slug}/`,
      title: { raw: slug, rendered: slug },
      content: { raw: content },
      excerpt: { raw: '' },
      menu_order: 0,
      template: '',
      meta: {},
    });
    return id;
  };

  // Above the documentation root: a stub and a page a person authored.
  const product = add(0, 'product', '<!-- wp:page-list /-->');
  const docstack = add(product, 'docstack', '<!-- wp:paragraph --><p>The product.</p><!-- /wp:paragraph -->');

  // The documentation itself.
  const docs = add(docstack, 'docs', generated());
  const guides = add(docs, 'guides', generated());
  add(guides, 'first', generated());
  add(docs, 'intro', generated());

  return fake;
}

/** Open a session on the fake. */
async function open(fake: FakeWp) {
  const target = createWordpressTarget(
    {
      url: 'https://example.test',
      user: 'someone',
      appPassword: 'pw',
      policy: { rootSegments: ['product', 'docstack'], baseSegments: ['docs'] },
      restBase: 'pages',
      status: 'publish',
      template: '',
      lang: '',
      mediaSlugPrefix: 'pterodoc',
      methodOverride: false,
      retry: { attempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
    },
    { fetch: fake.fetch, sleep: async () => {} },
  );

  return target.open({ locale: 'en', dryRun: false });
}

/** Status of one page in the fake. */
const statusOf = (fake: FakeWp, slug: string): string =>
  fake.pages.find((page) => page.slug === slug)!.status;

test('a path is found by walking it from the site root', async () => {
  const fake = siteWithDocs();
  const session = await open(fake);
  const index = await session.loadIndex();

  assert.equal(findByPath(index, ['product', 'docstack', 'docs'])!.slug, 'docs');
  assert.equal(findByPath(index, ['product', 'nope']), undefined);
});

test('purging reports without removing anything until asked', async () => {
  const fake = siteWithDocs();
  const session = await open(fake);

  const report = await purgeTree(session, {
    segments: ['product', 'docstack', 'docs'],
    classPrefix: PREFIX,
    apply: false,
  });

  assert.equal(report.applied, false);
  assert.equal(report.removed.length, 4);
  for (const slug of ['docs', 'guides', 'first', 'intro']) {
    assert.equal(statusOf(fake, slug), 'publish', `${slug} should still be published`);
  }
});

test('purging removes the tree, root included, deepest first', async () => {
  const fake = siteWithDocs();
  const session = await open(fake);

  const report = await purgeTree(session, {
    segments: ['product', 'docstack', 'docs'],
    classPrefix: PREFIX,
    apply: true,
  });

  // The root goes last, so a parent is never removed before its children.
  assert.equal(report.removed[report.removed.length - 1]!.slug, 'docs');
  for (const slug of ['docs', 'guides', 'first', 'intro']) {
    assert.equal(statusOf(fake, slug), 'trash', `${slug} should be trashed`);
  }
});

test('nothing above the documentation root is touched', async () => {
  // The product page is somebody's own, and the stub above it was created once
  // and never edited. Purging the documentation must not reach either.
  const fake = siteWithDocs();
  const session = await open(fake);

  await purgeTree(session, {
    segments: ['product', 'docstack', 'docs'],
    classPrefix: PREFIX,
    apply: true,
  });

  assert.equal(statusOf(fake, 'product'), 'publish');
  assert.equal(statusOf(fake, 'docstack'), 'publish');
});

test('a page pterodocs did not write is left standing inside the tree', async () => {
  const fake = siteWithDocs();
  const docs = fake.pages.find((page) => page.slug === 'docs')!;
  fake.pages.push({
    id: 900,
    parent: docs.id,
    slug: 'hand-written',
    status: 'publish',
    link: 'https://example.test/hand-written/',
    title: { raw: 'Hand written', rendered: 'Hand written' },
    content: { raw: '<!-- wp:paragraph --><p>Mine.</p><!-- /wp:paragraph -->' },
    excerpt: { raw: '' },
    menu_order: 0,
    template: '',
    meta: {},
  });

  const session = await open(fake);
  const report = await purgeTree(session, {
    segments: ['product', 'docstack', 'docs'],
    classPrefix: PREFIX,
    apply: true,
  });

  assert.equal(report.kept.length, 1);
  assert.equal(report.kept[0]!.slug, 'hand-written');
  assert.equal(statusOf(fake, 'hand-written'), 'publish');
});

test('a class prefix that does not match recognises nothing, and so removes nothing', async () => {
  // The prefix is configurable, and purging a site published under a different
  // one must not guess.
  const fake = siteWithDocs();
  const session = await open(fake);

  const report = await purgeTree(session, {
    segments: ['product', 'docstack', 'docs'],
    classPrefix: 'somethingelse',
    apply: true,
  });

  assert.equal(report.removed.length, 0);
  assert.equal(report.kept.length, 4);
  assert.equal(statusOf(fake, 'docs'), 'publish');
});

test('purging a path with nothing published there does nothing at all', async () => {
  const fake = siteWithDocs();
  const session = await open(fake);

  const report = await purgeTree(session, {
    segments: ['product', 'elsewhere', 'docs'],
    classPrefix: PREFIX,
    apply: true,
  });

  assert.equal(report.root, undefined);
  assert.equal(report.removed.length, 0);
  assert.equal(statusOf(fake, 'docs'), 'publish');
});
