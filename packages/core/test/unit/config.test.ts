/** Configuration precedence and validation. */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveConfig, discoverConfigFile, CONFIG_NAMES } from '../../src/config/load';

const CREDENTIALS = {
  WP_URL: 'https://example.test',
  WP_USER: 'someone',
  WP_APP_PASSWORD: 'abcd efgh ijkl mnop',
};

test('flags win over the environment, which wins over the file', () => {
  const config = resolveConfig({
    flags: { root: '/from-flag' },
    env: { ...CREDENTIALS, PTERODOCS_WP_ROOT: '/from-env' },
    file: { target: { root: '/from-file' } },
  });
  assert.deepEqual(config.rootSegments, ['from-flag']);

  const withoutFlag = resolveConfig({
    env: { ...CREDENTIALS, PTERODOCS_WP_ROOT: '/from-env' },
    file: { target: { root: '/from-file' } },
  });
  assert.deepEqual(withoutFlag.rootSegments, ['from-env']);

  const fileOnly = resolveConfig({ env: CREDENTIALS, file: { target: { root: '/from-file' } } });
  assert.deepEqual(fileOnly.rootSegments, ['from-file']);
});

test('the older unprefixed variable names still work, and say so', () => {
  const config = resolveConfig({ env: { ...CREDENTIALS, WP_ROOT_PATH: '/legacy' } });
  assert.deepEqual(config.rootSegments, ['legacy']);
  assert.ok(config.notices.some((notice) => notice.includes('WP_ROOT_PATH')));
  // The credential and URL names did not change, so using them says nothing.
  assert.equal(
    resolveConfig({ env: CREDENTIALS }).notices.some((notice) => notice.includes('WP_URL')),
    false,
  );
});

test('an empty base publishes straight under the root', () => {
  const config = resolveConfig({
    flags: { base: '' },
    env: CREDENTIALS,
    file: { target: { base: 'docs' } },
  });
  assert.deepEqual(config.baseSegments, []);
});

test('the application password loses its display spaces', () => {
  const config = resolveConfig({ env: CREDENTIALS });
  assert.equal(config.appPassword, 'abcdefghijklmnop');
  assert.equal(config.offline, false);
  assert.equal(config.dryRun, false);
});

test('missing credentials downgrade the run instead of failing it', () => {
  const config = resolveConfig({ env: { WP_URL: 'https://example.test' } });
  assert.equal(config.offline, true);
  assert.equal(config.dryRun, true);
  assert.ok(config.notices.some((notice) => /offline/.test(notice)), config.notices.join('; '));
});

test('credentials are read from the variables the config names', () => {
  const config = resolveConfig({
    env: { WP_URL: 'https://example.test', DOCS_USER: 'a', DOCS_PASS: 'b' },
    file: { target: { auth: { userEnv: 'DOCS_USER', passwordEnv: 'DOCS_PASS' } } },
  });
  assert.equal(config.user, 'a');
  assert.equal(config.offline, false);
});

test('invalid values are refused with the setting named', () => {
  assert.throws(() => resolveConfig({ flags: { status: 'published' }, env: CREDENTIALS }), /publish/);
  assert.throws(() => resolveConfig({ env: { ...CREDENTIALS, WP_URL: 'example.test' } }), /http/);
  assert.throws(
    () => resolveConfig({ env: CREDENTIALS, file: { target: { root: '/Bad Slug' } } }),
    /not a slug/,
  );
  assert.throws(
    () => resolveConfig({ env: CREDENTIALS, file: { layout: { align: 'middle' as never } } }),
    /alignment/,
  );
});

test('layout and strings fall back to the defaults, and overrides merge', () => {
  const config = resolveConfig({
    env: CREDENTIALS,
    file: { layout: { navWidth: '30%' }, render: { strings: { indexHeading: 'Inside' } } },
  });
  assert.equal(config.layout.navWidth, '30%');
  assert.equal(config.layout.mainWidth, '75%', 'untouched settings keep their default');
  assert.equal(config.strings.indexHeading, 'Inside');
  assert.equal(config.strings.breadcrumbSeparator, ' › ');
});

test('--no-media turns uploads off whatever the file says', () => {
  const config = resolveConfig({
    flags: { noMedia: true },
    env: CREDENTIALS,
    file: { media: { upload: true } },
  });
  assert.equal(config.uploadMedia, false);
});

test('a configuration file is discovered by name, in order', () => {
  const siteDir = path.resolve('/site');
  const found = path.join(siteDir, 'pterodocs.config.js');
  const present = new Set([found]);
  assert.equal(discoverConfigFile(siteDir, { existsSync: (file) => present.has(file) }), found);
  assert.equal(discoverConfigFile(siteDir, { existsSync: () => false }), undefined);
  assert.equal(CONFIG_NAMES[0], 'pterodocs.config.mjs');
});

/** A run given `--blog`, with a config that names where the posts are filed. */
function blogConfig(over: Record<string, unknown> = {}) {
  return resolveConfig({
    flags: { blog: true },
    env: CREDENTIALS,
    file: {
      target: { root: '/products/docstack', base: 'docs' },
      blog: { category: 'Release notes', ...over },
    },
    fileDir: path.resolve('/site'),
  });
}

test('the blog profile folds down into the same shape, with different values', () => {
  const config = blogConfig();

  assert.equal(config.publish, 'blog');
  assert.equal(config.ownership, 'flat');
  assert.equal(config.restBase, 'posts');
  assert.equal(config.taxonomy, 'tags');
  assert.deepEqual(config.sidebars, ['blog']);
  assert.equal(config.layout.nav, 'none');
  assert.equal(config.layout.kind, 'single');
  assert.equal(config.layout.breadcrumb, false);
  assert.equal(config.layout.pagination, false);
  assert.equal(config.menuOrder, 'none');
  assert.deepEqual(config.llms, { index: false, full: false, publish: false, title: '', description: '' });
});

test('the category is built from the documentation’s own root', () => {
  // A post's URL is the site's to decide and cannot be moved under the docs.
  // The category is the one hierarchy a post has, so that is where the two
  // are made to line up.
  assert.deepEqual(blogConfig().categoryPath, ['Products', 'Docstack', 'Release notes']);
});

test('a post carries no header of ours, even where the documentation does', () => {
  // The theme renders one around a post. A second would repeat it, and could
  // not be built properly anyway: its menu comes from the documentation's
  // sidebars, which a blog run does not load.
  const config = resolveConfig({
    flags: { blog: true },
    env: CREDENTIALS,
    file: {
      target: { root: '/products/docstack' },
      layout: { header: true },
      blog: { category: 'Release notes' },
    },
  });

  assert.equal(config.layout.header, false);
  // Unless the site asks for one outright.
  assert.equal(
    resolveConfig({
      flags: { blog: true },
      env: CREDENTIALS,
      file: { blog: { category: 'Release notes', layout: { header: true } } },
    }).layout.header,
    true,
  );
});

test('a category tree that does not follow the paths can be named outright', () => {
  const config = blogConfig({ categoryPath: ['Engineering', 'Releases'], category: 'ignored' });
  assert.deepEqual(config.categoryPath, ['Engineering', 'Releases']);
});

test('a docs run is untouched by a blog section being present', () => {
  const config = resolveConfig({
    env: CREDENTIALS,
    file: {
      target: { root: '/products/docstack', base: 'docs' },
      blog: { category: 'Release notes' },
    },
  });

  assert.equal(config.publish, 'docs');
  assert.equal(config.ownership, 'tree');
  assert.equal(config.restBase, 'pages');
  assert.equal(config.menuOrder, 'sidebar');
  assert.deepEqual(config.categoryPath, []);
  assert.deepEqual(config.rootSegments, ['products', 'docstack']);
  assert.deepEqual(config.baseSegments, ['docs']);
});

test('the blog writes to a directory of its own', () => {
  // Writing the artefacts clears the directory they go into, so one directory
  // for both runs means each one destroys what the other wrote.
  const docs = resolveConfig({ env: CREDENTIALS, fileDir: path.resolve('/site') });
  assert.notEqual(blogConfig().outDir, docs.outDir);
  assert.equal(blogConfig().outDir.startsWith(docs.outDir), true);
});

test('publishing the blog with nowhere to file it is refused rather than guessed', () => {
  assert.throws(
    () => resolveConfig({ flags: { blog: true }, env: CREDENTIALS, file: {} }),
    /blog\.category/,
  );
});

test('a blog cannot ask for a page list, because it has no page to list from', () => {
  // `core/page-list` reads a missing parent as the site root and lists every
  // page on the site. Silently ignoring the setting would publish that.
  assert.throws(() => blogConfig({ layout: { nav: 'page-list' } }), /page-list/);
});

test('one blog instance, named when there is a choice', () => {
  assert.deepEqual(blogConfig().instances, []);
  assert.deepEqual(blogConfig({ instance: 'releases' }).instances, ['releases']);
});
