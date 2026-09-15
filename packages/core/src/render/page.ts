/**
 * Page composition: the navigation and layout wrapped around a rendered body.
 *
 * This module deliberately describes the page tree structurally rather than
 * importing it, so the renderer stays independent of where the model came from
 * and of where the page is going.
 */

import { escapeText, joinBlocks, serializeBlock, serializeVoidBlock } from './blocks';
import { stylesheetFor } from './stylesheet';
import { excerptFrom } from './excerpt';
import type { Theme } from './theme';

/** The parts of a page node this module reads. */
export interface PageLike {
  /** Path within the published tree; '' is the root. */
  path: string;
  /** Title shown on the page and in navigation. */
  title: string;
  /** Short description, when the document supplied one. */
  description?: string | undefined;
  /** Parent page, for the breadcrumb. */
  parent?: PageLike | undefined;
  /** Children, in order. */
  children: PageLike[];
  /** Children grouped by the section that named them. */
  sections: { label?: string | undefined; children: PageLike[] }[];
  /** Path of the previous page in reading order. */
  previousPath?: string | undefined;
  /** Path of the next page. */
  nextPath?: string | undefined;
}

/** How a page is laid out on the target. */
export interface PageLayout {
  /** `two-column` puts navigation beside the document; `single` omits it. */
  kind: 'two-column' | 'single';
  /** Width of the navigation column. */
  navWidth: string;
  /** Width of the document column. */
  mainWidth: string;
  /** Alignment of the columns block: '', 'wide' or 'full'. */
  align: '' | 'wide' | 'full';
  /** `page-list` renders the target's own page tree; `none` omits navigation. */
  nav: 'page-list' | 'none';
  /** Show a trail of links back to the root. */
  breadcrumb: boolean;
  /** Show previous and next links. */
  pagination: boolean;
  /** When to list child pages: automatically, always, or never. */
  childIndex: 'auto' | 'always' | 'never';
  /** Offer a control that opens the navigation on a small screen. */
  navToggle: boolean;
  /**
   * Put the site's own header above the breadcrumb row.
   *
   * Off by default: it adds a row to every stored page, and a site whose theme
   * already carries one does not want a second.
   */
  header: boolean;
}

/** The layout used when a site configures none. */
export const DEFAULT_LAYOUT: PageLayout = {
  kind: 'two-column',
  navWidth: '25%',
  mainWidth: '75%',
  align: 'full',
  nav: 'page-list',
  breadcrumb: true,
  pagination: true,
  childIndex: 'auto',
  navToggle: true,
  header: false,
};

/** One entry in the header's menu. */
export interface HeaderLink {
  /** What it reads. */
  label: string;
  /** Where it points; empty for an entry that only groups others. */
  href: string;
  /**
   * The destination is not on this site.
   *
   * Decided by whoever resolved the link, which is the only place the site's
   * own origin is known -- the renderer sees a string and could only guess.
   */
  external?: boolean | undefined;
  /** Entries below it. */
  items?: HeaderLink[] | undefined;
}

/**
 * The header, as the renderer needs it.
 *
 * Deliberately not the model's own navbar type: `render/` may not import from
 * `model/`, and turning one into the other is the reconciler's job -- which is
 * also where a URL stops being the Docusaurus site's and becomes the target's.
 */
export interface HeaderLike {
  /** The wordmark. */
  title: string;
  /** Where the wordmark points. */
  href: string;
  /** Entries, in declaration order, each knowing which end it belongs on. */
  items: (HeaderLink & { position: 'left' | 'right' })[];
}

/** Everything needed to compose one page. */
export interface ComposePageInput {
  /** The page being composed. */
  node: PageLike;
  /** The rendered document body; empty for a page with no document. */
  body: string;
  /** Tree paths this page's body already links to. */
  links: Set<string>;
  /** Absolute target URL for a tree path. */
  href: (treePath: string) => string;
  /** Look a page up by tree path, for previous and next. */
  lookup: (treePath: string) => PageLike | undefined;
  /** Class names and strings. */
  theme: Theme;
  /** The site's own header, when the layout asks for one. */
  header?: HeaderLike | undefined;
  /** How the page is laid out. */
  layout: PageLayout;
  /** Id of the page the navigation block should list from. */
  navRootId?: number | null | undefined;
  /** A notice shown above the body, such as an old-version banner. */
  banner?: string | undefined;
}

/** A short summary of a page, for an index listing. */
function summaryOf(node: PageLike, theme: Theme): string {
  if (node.description) return excerptFrom(node.description, 140);
  const count = node.children.length;
  if (count === 1) return theme.text('pageCountOne');
  if (count > 1) return theme.text('pageCount', { count });
  return '';
}

/** The trail of links back to the root. */
export function renderBreadcrumb(input: ComposePageInput): string {
  const trail: PageLike[] = [];
  for (let current = input.node.parent; current; current = current.parent) trail.unshift(current);
  if (trail.length === 0) return '';

  const links = trail.map(
    (ancestor) => `<a href="${input.href(ancestor.path)}">${escapeText(ancestor.title)}</a>`,
  );
  links.push(escapeText(input.node.title));

  const className = input.theme.cls('docs-breadcrumb');

  // Marked up, the plugin can swap the separator for a configured one exactly
  // rather than by guessing which run of text between two links is one. Left
  // bare, it is the same characters it has always been.
  const separator = escapeText(input.theme.strings.breadcrumbSeparator);
  const joined =
    input.theme.blocks === 'plugin'
      ? links.join(`<span class="${input.theme.cls('breadcrumb-separator')}">${separator}</span>`)
      : links.join(separator);

  return serializeBlock(
    'group',
    { className },
    `<div class="wp-block-group ${className}">${serializeBlock(
      'paragraph',
      undefined,
      `<p>${joined}</p>`,
    )}</div>`,
  );
}

/** Previous and next links, following the site's own order. */
export function renderPagination(input: ComposePageInput): string {
  const previous = input.node.previousPath === undefined ? undefined : input.lookup(input.node.previousPath);
  const next = input.node.nextPath === undefined ? undefined : input.lookup(input.node.nextPath);
  if (!previous && !next) return '';

  const parts: string[] = [];
  if (previous) {
    const className = input.theme.cls('docs-pagination-prev');
    parts.push(
      serializeBlock(
        'paragraph',
        { className },
        `<p class="${className}"><a href="${input.href(previous.path)}">${escapeText(
          input.theme.text('previous', { title: previous.title }),
        )}</a></p>`,
      ),
    );
  }
  if (next) {
    const className = input.theme.cls('docs-pagination-next');
    parts.push(
      serializeBlock(
        'paragraph',
        { className },
        `<p class="${className}"><a href="${input.href(next.path)}">${escapeText(
          input.theme.text('next', { title: next.title }),
        )}</a></p>`,
      ),
    );
  }

  const className = input.theme.cls('docs-pagination');
  return serializeBlock(
    'group',
    { className },
    `<div class="wp-block-group ${className}">${joinBlocks(parts)}</div>`,
  );
}

/** A list of the pages below this one, grouped as the sidebar grouped them. */
export function renderChildIndex(input: ComposePageInput, heading: string): string {
  const { node, theme } = input;
  if (node.children.length === 0) return '';

  const parts: string[] = [];
  if (heading) {
    const className = theme.cls('docs-index-heading');
    parts.push(
      serializeBlock(
        'heading',
        { className },
        `<h2 class="wp-block-heading ${className}" id="in-this-section">${escapeText(heading)}</h2>`,
      ),
    );
  }

  for (const section of node.sections.length > 0 ? node.sections : [{ label: undefined, children: node.children }]) {
    if (section.label) {
      parts.push(
        serializeBlock('heading', { level: 3 }, `<h3 class="wp-block-heading">${escapeText(section.label)}</h3>`),
      );
    }
    const items = section.children
      .map((child) => {
        const summary = summaryOf(child, theme);
        const link = `<a href="${input.href(child.path)}">${escapeText(child.title)}</a>`;
        return serializeBlock(
          'list-item',
          undefined,
          `<li>${link}${summary ? ` — ${escapeText(summary)}` : ''}</li>`,
        );
      })
      .join('\n\n');

    const className = theme.cls('docs-index');
    parts.push(
      serializeBlock(
        'list',
        { className },
        `<ul class="wp-block-list ${className}">${items}</ul>`,
      ),
    );
  }

  return joinBlocks(parts);
}

/**
 * The stylesheet, as a block.
 *
 * Stored with the page because a site that has installed nothing has nowhere
 * else to read it from. A theme that already dresses these class names, or a
 * site running the WordPress plugin, should turn this off.
 */
function renderStyles(theme: Theme, layout: PageLayout): string {
  if (theme.styles === 'none') return '';

  const css = stylesheetFor(theme, { navWidth: layout.navWidth });

  return serializeBlock('html', undefined, `<style>${css}</style>`);
}

/** The navigation column's contents. */
function renderNavigation(input: ComposePageInput): string {
  if (input.layout.nav === 'none') return '';

  return serializeVoidBlock('page-list', { parentPageID: input.navRootId ?? 0 });
}


/**
 * The row above the document: where the reader is, and the way into the
 * navigation.
 *
 * The two travel together because on a small screen they share one fixed row.
 * The control is a checkbox and a label, so opening and closing the navigation
 * needs no script: a label toggles its own checkbox both ways, and a second
 * label laid over the page closes it from outside. Which of them the navigation
 * listens to is settled in CSS with `:has()`, so the control does not have to
 * be a sibling of the list it opens — it is in the other column entirely.
 */
function renderDocsBar(input: ComposePageInput): string {
  const { theme, layout } = input;
  const breadcrumb = layout.breadcrumb ? renderBreadcrumb(input) : '';

  if (layout.nav === 'none' || layout.navToggle === false) return breadcrumb;

  // Fixed rather than generated: there is one navigation to a page, and an id
  // that changed between runs would make every page differ from itself.
  const id = theme.cls('docs-nav-toggle');
  const control = serializeBlock(
    'html',
    undefined,
    `<input type="checkbox" id="${id}" class="${theme.cls('docs-toggle')}">` +
      `<label class="${theme.cls('docs-toggle-label')}" for="${id}">` +
      `<span class="${theme.cls('docs-toggle-icon')}" aria-hidden="true"></span>` +
      `<span class="${theme.cls('docs-toggle-text')}">${escapeText(theme.text('navToggle'))}</span>` +
      `</label>` +
      `<label class="${theme.cls('docs-scrim')}" for="${id}" aria-hidden="true"></label>`,
  );

  const className = theme.cls('docs-bar');
  return serializeBlock(
    'group',
    { className },
    `<div class="wp-block-group ${className}">${joinBlocks([control, breadcrumb])}</div>`,
  );
}

/** One menu entry, and anything nested under it. */
function renderHeaderLink(item: HeaderLink, theme: Theme): string {
  const label = escapeText(item.label);
  // Docusaurus opens an external navbar entry in a new tab, so the published
  // header does too -- the same menu should not behave differently depending
  // on which copy of it you are reading. `noopener` because a new tab would
  // otherwise get a handle on this one.
  const away = item.external ? ' target="_blank" rel="noopener noreferrer"' : '';
  const self = item.href
    ? `<a href="${escapeText(item.href)}"${away}>${label}</a>`
    : `<span>${label}</span>`;

  if (!item.items || item.items.length === 0) return `<li>${self}</li>`;

  // A dropdown is a nested list and nothing more. It opens on hover and on
  // focus, both from the stylesheet, so it needs no script and it is still
  // reachable from a keyboard.
  const children = item.items.map((child) => renderHeaderLink(child, theme)).join('');
  return (
    `<li class="${theme.cls('docs-header-group')}">${self}` +
    `<ul class="${theme.cls('docs-header-menu')}">${children}</ul></li>`
  );
}

/**
 * The site's own header: the wordmark, and the menu it declares.
 *
 * Sits above the breadcrumb row rather than above the columns, so it lines up
 * with the document rather than spanning the navigation as well.
 *
 * The menu collapses to one control on a narrow screen, opened by a checkbox
 * the same way the navigation is -- so it works with no JavaScript, and needs
 * its own id because both can be open at once.
 */
function renderHeader(input: ComposePageInput): string {
  const { theme, header } = input;
  if (!input.layout.header || !header || header.items.length === 0) return '';

  const side = (position: 'left' | 'right'): string =>
    header.items
      .filter((item) => item.position === position)
      .map((item) => renderHeaderLink(item, theme))
      .join('');

  const id = theme.cls('docs-header-toggle');
  // Named by attribute rather than by a visible word. The control is one
  // hamburger in a header that already says what site this is, so a caption
  // beside it only repeats the icon; `aria-label` is not optional, though --
  // the icon is `aria-hidden`, so without it the control has no name at all.
  const toggle = escapeText(theme.text('headerToggle'));
  const title = header.href
    ? `<a href="${escapeText(header.href)}">${escapeText(header.title)}</a>`
    : escapeText(header.title);

  const align = input.layout.align ? `align${input.layout.align} ` : '';
  const markup =
    `<div class="${align}${theme.cls('docs-header')}">` +
    `<span class="${theme.cls('docs-header-title')}">${title}</span>` +
    `<input type="checkbox" id="${id}" class="${theme.cls('docs-header-check')}">` +
    `<label class="${theme.cls('docs-header-label')}" for="${id}" title="${toggle}" aria-label="${toggle}">` +
    `<span class="${theme.cls('docs-header-icon')}" aria-hidden="true"></span>` +
    `</label>` +
    `<label class="${theme.cls('docs-header-scrim')}" for="${id}" aria-hidden="true"></label>` +
    `<nav class="${theme.cls('docs-header-nav')}">` +
    `<ul class="${theme.cls('docs-header-start')}">${side('left')}</ul>` +
    `<ul class="${theme.cls('docs-header-end')}">${side('right')}</ul>` +
    `</nav></div>`;

  return serializeBlock('html', undefined, markup);
}

/** Compose the stored content of one page. */
export function composePage(input: ComposePageInput): string {
  const { node, theme, layout } = input;

  let index = '';
  if (node.children.length > 0 && layout.childIndex !== 'never') {
    // A page that already links all of its children does not need a generated
    // list; one that links none of them does.
    const linksAllChildren = node.children.every((child) => input.links.has(child.path));
    if (layout.childIndex === 'always' || !linksAllChildren) {
      index = renderChildIndex(input, input.body ? theme.text('indexHeading') : '');
    }
  }

  const main = joinBlocks([
    input.banner ?? '',
    renderDocsBar(input),
    input.body,
    index,
    layout.pagination ? renderPagination(input) : '',
  ]);

  if (layout.kind === 'single' || layout.nav === 'none') {
    return joinBlocks([renderStyles(theme, layout), renderHeader(input), main]);
  }

  const navClass = theme.cls('docs-nav');
  const mainClass = theme.cls('docs-main');
  const navColumn = serializeBlock(
    'column',
    { width: layout.navWidth, className: navClass },
    `<div class="wp-block-column ${navClass}" style="flex-basis:${layout.navWidth}">${renderNavigation(input)}</div>`,
  );
  const mainColumn = serializeBlock(
    'column',
    { width: layout.mainWidth, className: mainClass },
    `<div class="wp-block-column ${mainClass}" style="flex-basis:${layout.mainWidth}">${main}</div>`,
  );

  const columnsClass = theme.cls('docs');
  const attributes: Record<string, unknown> = { className: columnsClass };
  if (layout.align) attributes['align'] = layout.align;
  const alignClass = layout.align ? ` align${layout.align}` : '';

  const columns = serializeBlock(
    'columns',
    attributes,
    `<div class="wp-block-columns${alignClass} ${columnsClass}">${navColumn}\n\n${mainColumn}</div>`,
  );

  return joinBlocks([renderStyles(theme, layout), renderHeader(input), columns]);
}

/**
 * Whether a page's stored content is something pterodocs composed.
 *
 * There is no marker to look for, and deliberately so: a marker would have to
 * live in post metadata, which WordPress will not accept over REST unless a
 * plugin registered it first, and requiring a plugin to be able to clean up
 * after yourself is the wrong trade. What pterodocs does leave on every page it
 * composes is its own class prefix, so that is the signature.
 *
 * Wrong in the safe direction. A page it wrote but cannot recognise is left
 * alone; only a page carrying pterodocs's own classes is ever a candidate for
 * removal, so a page somebody else wrote is never one.
 *
 * @param content The page's stored content.
 * @param classPrefix The prefix this site was published with.
 */
export function isGeneratedPage(content: string, classPrefix: string): boolean {
  return content.includes(`${classPrefix}-docs`);
}

/** Body for a path segment that exists only so the documentation has a parent. */
export function renderNavigationStub(selfId: number): string {
  return serializeVoidBlock('page-list', { parentPageID: selfId });
}

/** A notice shown on every page of a version that is not the current one. */
export function renderVersionBanner(theme: Theme, label: string, kind: string): string {
  const className = `${theme.cls('version-banner')} ${theme.cls(`version-banner-${kind}`)}`;
  return serializeBlock(
    'group',
    { className },
    `<div class="wp-block-group ${className}">${serializeBlock(
      'paragraph',
      undefined,
      `<p>${escapeText(theme.text('versionBanner', { label }))}</p>`,
    )}</div>`,
  );
}
