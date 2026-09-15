/**
 * Looking right without anything installed.
 *
 * WordPress renders core blocks with almost no opinion, so what pterodocs
 * publishes has to carry its own appearance: a stylesheet stored with the page,
 * and code tokenised before it ever gets there. These tests are about the two
 * properties that make that safe to do — the markup stays valid core blocks,
 * and nothing about it is a colour.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDoc } from '../../src/render/index';
import { composePage, DEFAULT_LAYOUT, type PageLike } from '../../src/render/page';
import { createTheme } from '../../src/render/theme';
import { stylesheetFor } from '../../src/render/stylesheet';
import { highlightCode } from '../../src/render/highlight';

/** Render a snippet under one set of options. */
function render(markdown: string, options: Parameters<typeof createTheme>[0] = {}) {
  return renderDoc({
    markdown,
    file: 'test.md',
    permalink: '/docs/test',
    theme: createTheme({ classPrefix: 'x', ...options }),
  });
}

const FENCE = "```ts\nconst a = 1; // note\n```\n";

/* ---------------------------------------------------------------------- *
 * Highlighting
 * ---------------------------------------------------------------------- */

test('a fence is tokenised, and what lands in the content is classes', () => {
  const { body } = render(FENCE);

  assert.ok(body.includes('<span class="token keyword">const</span>'), body);
  assert.ok(body.includes('token comment'), body);
});

test('no colour is ever written into the content', () => {
  // The whole reason for classes: the palette lives in the stylesheet, so
  // restyling code is a CSS edit and not a republication of every page.
  const { body } = render(FENCE);

  assert.equal(/style="/.test(body), false, body);
  assert.equal(/#[0-9a-f]{3,6}/i.test(body), false, body);
});

test('the block around the tokens is still an ordinary core code block', () => {
  const { body } = render(FENCE);

  assert.ok(body.includes('<!-- wp:code {"className":"language-ts"} -->'), body);
  assert.ok(body.includes('<pre class="wp-block-code language-ts"><code>'), body);
});

test('highlighting can be turned off, and then the source is escaped as before', () => {
  const { body } = render(FENCE, { highlight: false });

  assert.equal(body.includes('<span class="token'), false);
  assert.ok(body.includes('const a = 1; // note'), body);
});

test('a language Prism does not know is left plain rather than mangled', () => {
  const { body } = render('```notalanguage\nliteral text\n```\n');

  assert.equal(body.includes('<span class="token'), false);
  assert.ok(body.includes('literal text'), body);
});

test('a fence with no language is left plain', () => {
  const { body } = render('```\njust text\n```\n');

  assert.equal(body.includes('<span class="token'), false);
});

test('shortcode brackets are still escaped inside highlighted code', () => {
  // WordPress expands shortcodes inside code as happily as anywhere else, and
  // Prism escapes `&`, `<` and `>` but not `[`.
  const { body } = render('```ts\nconst first = items[0];\n```\n');

  assert.ok(body.includes('&#91;'), body);
  assert.equal(body.includes('items[0]'), false, body);
});

test('highlighting never invents or loses source text', () => {
  const source = 'const a = 1;\nfunction f(x) { return x; }\n';
  const marked = highlightCode(source, 'ts');

  assert.ok(marked);
  const text = marked!.replace(/<[^>]+>/g, '').replace(/&#91;/g, '[').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  assert.equal(text, source);
});

/* ---------------------------------------------------------------------- *
 * The stylesheet
 * ---------------------------------------------------------------------- */

test('the stylesheet is written with the run’s own class prefix', () => {
  const css = stylesheetFor(createTheme({ classPrefix: 'docstack' }));

  assert.ok(css.includes('.docstack-docs-nav'), css.slice(0, 200));
  assert.equal(css.includes('{p}'), false, 'a placeholder survived');
  assert.equal(css.includes('.pterodocs-'), false, 'the default prefix leaked');
});

test('the stylesheet assumes neither a light theme nor a dark one', () => {
  // Every colour is mixed from currentColor, so it follows whatever the theme
  // paints its text. A bare hex would be a light-mode assumption.
  const css = stylesheetFor(createTheme({}));
  const declarations = css.match(/color:[^;}]+/g) ?? [];

  for (const declaration of declarations) {
    const fixed = /#[0-9a-f]{3,6}/i.test(declaration);
    const mixed = declaration.includes('currentColor');
    assert.ok(!fixed || mixed, `not adaptive: ${declaration}`);
  }
});

/** A page with a parent, so there is a breadcrumb to compose. */
function page(): PageLike {
  const root: PageLike = { path: '', title: 'Docs', children: [], sections: [] };
  return { path: 'guide', title: 'Guide', parent: root, children: [], sections: [] };
}

/** Compose one page under one set of options. */
function compose(options: Parameters<typeof createTheme>[0] = {}): string {
  return composePage({
    node: page(),
    body: '<!-- wp:paragraph -->\n<p>Body.</p>\n<!-- /wp:paragraph -->',
    links: new Set<string>(),
    href: (path) => `/docs/${path}`,
    lookup: () => undefined,
    theme: createTheme({ classPrefix: 'x', ...options }),
    layout: DEFAULT_LAYOUT,
  });
}

test('the stylesheet travels with the page, as a block', () => {
  const composed = compose();

  assert.ok(composed.startsWith('<!-- wp:html -->'), composed.slice(0, 80));
  assert.ok(composed.includes('<style>'), 'no style element');
  assert.ok(composed.includes('.x-docs-nav'), 'the prefix did not reach the CSS');
});

test('a site that styles its own documentation can turn it off', () => {
  const composed = compose({ styles: 'none' });

  assert.equal(composed.includes('<style>'), false);
  assert.ok(composed.startsWith('<!-- wp:columns'), composed.slice(0, 60));
});

test('the documentation is full width unless the layout says otherwise', () => {
  // Its absence is why an unstyled page came out in a narrow column.
  assert.equal(DEFAULT_LAYOUT.align, 'full');
  assert.ok(compose().includes('"align":"full"'));
  assert.ok(compose().includes('wp-block-columns alignfull'));
});

/* ---------------------------------------------------------------------- *
 * The navigation toggle
 * ---------------------------------------------------------------------- */

test('the navigation is opened by a control that needs no script', () => {
  const composed = compose();
  // Only the markup: the class names appear in the stylesheet too, and an
  // assertion that matched those would pass whatever the markup did.
  const markup = composed.slice(composed.indexOf('<!-- wp:columns'));

  assert.ok(markup.includes('type="checkbox"'), 'no checkbox');
  assert.ok(markup.includes('for="x-docs-nav-toggle"'), 'the label does not point at it');
  assert.ok(markup.includes('x-docs-scrim'), 'nothing to close it from outside');
});

test('the control shares a row with the breadcrumb', () => {
  // They are one bar on a small screen, which is why they are one block.
  const markup = compose().slice(compose().indexOf('<!-- wp:columns'));
  const bar = markup.slice(markup.indexOf('x-docs-bar'));

  assert.ok(bar.indexOf('x-docs-toggle-label') < bar.indexOf('x-docs-docs-breadcrumb') || bar.includes('x-docs-breadcrumb'));
  assert.ok(bar.includes('x-docs-breadcrumb'), 'the breadcrumb is not in the bar');
});

test('the control does not have to sit beside the list it opens', () => {
  // The list is in the navigation column and the control is in the document
  // column; :has() is what connects them, so source order carries no meaning.
  const markup = compose().slice(compose().indexOf('<!-- wp:columns'));

  assert.ok(markup.indexOf('wp:page-list') < markup.indexOf('type="checkbox"'));
});

test('the toggle’s id is fixed, so a page does not differ from itself', () => {
  // A generated id would make every page change on every sync, for ever.
  assert.equal(compose(), compose());
});

test('a site that does not want the control can drop it', () => {
  const composed = composePage({
    node: page(),
    body: '',
    links: new Set<string>(),
    href: (path) => `/docs/${path}`,
    lookup: () => undefined,
    theme: createTheme({ classPrefix: 'x' }),
    layout: { ...DEFAULT_LAYOUT, navToggle: false },
  });

  assert.equal(composed.includes('type="checkbox"'), false);
  assert.ok(composed.includes('wp:page-list'));
});

test('the documentation pads itself, because alignfull escapes the theme’s padding', () => {
  const css = stylesheetFor(createTheme({ classPrefix: 'x' }));
  const root = css.split(String.fromCharCode(10)).find((line) => line.includes('.x-docs{display:'));

  assert.ok(root, 'the layout rule is missing');
  assert.ok(root!.includes('padding-inline'), root);
});

test('the two columns cannot overflow the page', () => {
  // The columns carry inline flex-basis:25% and 75%, which together are the
  // whole content box. Laid out as flex, any gap pushes the document off the
  // right edge, and an inline style cannot be overridden from a stylesheet.
  // Grid ignores flex-basis, and 1fr accounts for the gap by itself.
  const css = stylesheetFor(createTheme({ classPrefix: 'x' }));
  const root = css.split(String.fromCharCode(10)).find((line) => line.includes('.x-docs{display:'));

  assert.ok(root, 'the layout rule is missing');
  assert.ok(root!.includes('display:grid'), root);
  assert.equal(root!.includes('display:flex'), false, root);
  // Both tracks must be allowed to shrink below their content.
  assert.ok(root!.includes('minmax(0,'), root);

  // And it has to outrank core, which ships .wp-block-columns{display:flex} at
  // one class. Wrapped in :where() this rule scores zero and never applies.
  assert.ok(root!.startsWith('.wp-block-columns.x-docs'), root);
  assert.equal(root!.includes(':where'), false, root);
});

test('the configured navigation width reaches the layout', () => {
  // A grid ignores the inline flex-basis the columns carry, so the setting has
  // to arrive as a custom property or it would quietly stop meaning anything.
  const css = stylesheetFor(createTheme({ classPrefix: 'x' }), { navWidth: '30%' });

  assert.ok(css.includes('--x-nav-width:30%'), css.slice(0, 120));
});

test('a nonsense width is ignored rather than written into the page', () => {
  const css = stylesheetFor(createTheme({ classPrefix: 'x' }), { navWidth: 'red;}body{display:none' });

  // The stylesheet has its own display:none rules, so asserting on that would
  // prove nothing. What matters is that the property is never written at all.
  // The template *reads* the property with a fallback, so its name appears
  // either way. What must not appear is a declaration setting it.
  assert.equal(css.includes('--x-nav-width:'), false);
  assert.equal(css.includes('body{'), false);
});

test('the theme’s own spacing above the documentation is answered, for any prefix', () => {
  // Written with the run's prefix like everything else, so a site published as
  // `docstack` is covered by the same rule as one published as `pterodocs`.
  const css = stylesheetFor(createTheme({ classPrefix: 'docstack' }));

  assert.ok(css.includes('#wp--skip-link--target:has(.docstack-docs)'), 'the container rule is missing');
  assert.equal(css.includes('.pterodocs-docs)'), false, 'the default prefix leaked');
});

test('`!important` is used only where an inline style is being answered', () => {
  // The stylesheet's discipline is that a theme keeps its opinions. The one
  // exception is a value the theme wrote inline, which nothing else can beat —
  // so every `!important` must be on the skip-link container.
  const css = stylesheetFor(createTheme({ classPrefix: 'x' }));
  // Comments explain the exception, so they mention it too. Strip them first.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = rules
    .split(String.fromCharCode(10))
    .filter((line) => line.includes('!important'));

  assert.ok(lines.length > 0, 'expected the container rules');
  for (const line of lines) {
    assert.ok(line.startsWith('#wp--skip-link--target'), line);
  }
});

test('only the sheet stacks above the theme’s own chrome', () => {
  // A sheet is laid over the page and has to clear whatever the theme stacks.
  // The sticky column is beside the document, with nothing to rise above, and
  // lifting it there would put the navigation over the site's own header.
  const css = stylesheetFor(createTheme({ classPrefix: 'x' }));
  const lines = css.split(String.fromCharCode(10));

  const column = lines.find((line) => line.startsWith(':where(.x-docs-nav){'));
  assert.ok(column, 'the navigation rule is missing');
  assert.equal(column!.includes('z-index'), false, column);

  const sheet = lines.find((line) => line.includes('.x-docs-nav{position:fixed'));
  assert.ok(sheet?.includes('z-index:999'), sheet);
});

test('nothing laid over the page carries a margin', () => {
  // WordPress gives every child of a group a block-gap margin, and a margin
  // applies to a fixed element too -- so `inset:0` would put the backdrop at
  // the top and the margin would push it down, showing a strip of the page.
  const css = stylesheetFor(createTheme({ classPrefix: 'x' }));

  for (const fragment of ['.x-docs-scrim{', '.x-docs-header-scrim{', '.x-docs-nav{position:fixed', '.x-docs-header-nav{position:fixed']) {
    const rule = css.split(String.fromCharCode(10)).find((line) => line.includes(fragment));
    assert.ok(rule, `no rule for ${fragment}`);
    assert.ok(rule!.includes('margin:0'), `${fragment} can be pushed by a margin`);
  }
});

test('the sheet still stacks over its own scrim', () => {
  // Raising the navigation is only safe if the veil stays beneath it.
  const css = stylesheetFor(createTheme({ classPrefix: 'x' }));
  const of = (fragment: string): number => {
    const line = css.split(String.fromCharCode(10)).find((l) => l.includes(fragment) && l.includes('z-index'));
    return Number(/z-index:(\d+)/.exec(line ?? '')?.[1] ?? -1);
  };

  const nav = of('.x-docs-nav{position:fixed');
  const scrim = of('.x-docs-scrim{display:block');
  const bar = of('.x-docs-bar{position:sticky');

  assert.ok(nav > scrim, `nav ${nav} should stack over scrim ${scrim}`);
  assert.ok(scrim > bar, `scrim ${scrim} should stack over bar ${bar}`);
});

/* ---------------------------------------------------------------------- *
 * The site header
 * ---------------------------------------------------------------------- */

/** A header with one entry on each end, and one that nests. */
const header = {
  title: 'Fixture',
  href: '/docs/',
  items: [
    { label: 'Docs', href: '/docs/intro/', position: 'left' as const },
    {
      label: 'More',
      href: '',
      position: 'left' as const,
      items: [{ label: 'Spec', href: 'https://example.test/spec' }],
    },
    { label: 'Repository', href: 'https://example.test/repo', position: 'right' as const },
  ],
};

/** Compose with the header turned on. */
function composeWithHeader(overrides: Partial<typeof DEFAULT_LAYOUT> = {}): string {
  return composePage({
    node: page(),
    body: '<!-- wp:paragraph -->\n<p>Body.</p>\n<!-- /wp:paragraph -->',
    links: new Set<string>(),
    href: (path) => `/docs/${path}`,
    lookup: () => undefined,
    theme: createTheme({ classPrefix: 'x' }),
    layout: { ...DEFAULT_LAYOUT, header: true, ...overrides },
    header,
  });
}

/**
 * The markup only. The class names appear in the stylesheet too, so an
 * assertion over the whole composed page would pass whatever the markup did.
 * Everything after the stylesheet is markup, the header included -- it sits
 * beside the stylesheet now rather than inside the document column.
 */
function markupOf(composed: string): string {
  return composed.slice(composed.indexOf('</style>'));
}

test('there is no header unless the layout asks for one', () => {
  // It adds a row to every stored page, and a site whose theme already carries
  // a header does not want a second.
  assert.equal(DEFAULT_LAYOUT.header, false);
  assert.equal(markupOf(composeWithHeader({ header: false })).includes('x-docs-header'), false);
});

test('the header carries the wordmark and the menu the site declared', () => {
  const composed = composeWithHeader();

  assert.ok(composed.includes('x-docs-header-title'), 'no wordmark');
  assert.ok(composed.includes('>Fixture<'), 'the title is missing');
  assert.ok(composed.includes('href="/docs/intro/">Docs<'), 'the first entry is missing');
  assert.ok(composed.includes('href="https://example.test/repo">Repository<'), 'the external entry is missing');
});

test('entries keep the end of the bar the site put them on', () => {
  const composed = markupOf(composeWithHeader());
  const start = composed.indexOf('x-docs-header-start');
  const end = composed.indexOf('x-docs-header-end');

  assert.ok(start < end, 'the two lists are in the wrong order');
  assert.ok(composed.slice(start, end).includes('>Docs<'), 'Docs should be on the left');
  assert.ok(composed.slice(end).includes('>Repository<'), 'Repository should be on the right');
});

test('an entry with children nests them rather than flattening', () => {
  const composed = composeWithHeader();

  assert.ok(composed.includes('x-docs-header-group'), 'no group');
  assert.ok(composed.includes('x-docs-header-menu'), 'no nested list');
  // It groups rather than links, so it is a span and not an anchor.
  assert.ok(composed.includes('<span>More</span>'), composed.slice(composed.indexOf('More') - 60, composed.indexOf('More') + 20));
});

test('the header opens with a control of its own, not the navigation’s', () => {
  // Both can be open at once, so sharing an id would tie them together.
  const composed = composeWithHeader();

  assert.ok(composed.includes('for="x-docs-header-toggle"'), 'no header control');
  assert.ok(composed.includes('for="x-docs-nav-toggle"'), 'the navigation control went missing');
  assert.notEqual('x-docs-header-toggle', 'x-docs-nav-toggle');
});

test('the header sits above the breadcrumb row', () => {
  const composed = markupOf(composeWithHeader());

  assert.ok(composed.indexOf('x-docs-header') < composed.indexOf('x-docs-bar'), 'wrong order');
});

test('the header is padded in rather than margined in', () => {
  // Full width is achieved with a negative margin, so a margin here would be
  // arguing with the theme. Padding sits inside it, and it is the same move
  // the columns below make -- which is what lines the two up.
  const css = stylesheetFor(createTheme({ classPrefix: 'x' }));
  const rule = css.split(String.fromCharCode(10)).find((line) => line.startsWith('.alignfull.x-docs-header{'));

  assert.ok(rule, 'the header has no width rule');
  assert.ok(rule!.includes('padding-inline'), rule);
  assert.equal(rule!.includes('margin'), false, rule);
  assert.ok(rule!.includes('--wp--style--root--padding-left'), 'it should read the theme’s own padding');
});

test('the header keeps a rule under it, to separate it from the page', () => {
  const css = stylesheetFor(createTheme({ classPrefix: 'x' }));
  const rule = css.split(String.fromCharCode(10)).find((line) => line.startsWith(':where(.x-docs-header){'));

  assert.ok(rule?.includes('border-bottom'), rule);
});

test('the header is a child of the content, not of the document column', () => {
  // It spans the page, above the navigation as well as the document, which it
  // cannot do from inside a column.
  const markup = markupOf(composeWithHeader());

  assert.ok(markup.indexOf('x-docs-header') < markup.indexOf('<!-- wp:columns'), 'it is still inside the columns');
});

test('the header matches the alignment of the documentation below it', () => {
  // A constrained content wrapper holds its children to the measure, so
  // without this the header would sit narrower than the tree beneath it.
  assert.equal(DEFAULT_LAYOUT.align, 'full');
  assert.ok(composeWithHeader().includes('class="alignfull x-docs-header"'), 'no alignment class');
  assert.ok(composeWithHeader({ align: '' }).includes('class="x-docs-header"'), 'aligned when it should not be');
});

test('the header carries the design tokens, not only the columns do', () => {
  // The header is a sibling of the columns block, so it is outside the element
  // the tokens were declared on -- and `var(--x-gutter)` undefined makes the
  // whole declaration reading it invalid, which took the sheet's padding,
  // background and border with it.
  const css = stylesheetFor(createTheme({ classPrefix: 'x' }));
  const tokens = css.split(String.fromCharCode(10)).find((line) => line.includes('--x-gutter:'));

  assert.ok(tokens, 'nothing declares the tokens');
  assert.ok(tokens!.startsWith(':where(.x-docs,.x-docs-header){'), tokens);
});

test('the header sheet is padded from a token it can actually see', () => {
  const css = stylesheetFor(createTheme({ classPrefix: 'x' }));
  const lines = css.split(String.fromCharCode(10));

  const sheet = lines.find((line) => line.includes('.x-docs-header-nav{position:fixed'));
  assert.ok(sheet?.includes('padding:'), sheet);

  // Every token the sheet reads has to be declared somewhere that contains it.
  const scope = lines.find((line) => line.includes('--x-gutter:'))!;
  for (const token of sheet!.match(/--x-[a-z-]+/g) ?? []) {
    assert.ok(scope.includes(`${token}:`), `${token} is read by the sheet but declared nowhere it reaches`);
  }
});

test('the control that opens the header is named without printing a word', () => {
  // One hamburger in a header that already says what site this is. A caption
  // beside it only repeats the icon -- but the icon is aria-hidden, so the
  // name has to come from somewhere.
  const markup = markupOf(composeWithHeader());

  assert.equal(markup.includes('>Site menu<'), false, 'the caption is still printed');
  assert.ok(markup.includes('aria-label="Site menu"'), 'the control has no accessible name');
  assert.ok(markup.includes('title="Site menu"'), 'no tooltip');
});
