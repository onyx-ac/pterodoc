/**
 * Every class name and every human-readable string the renderer emits.
 *
 * Kept in one place so a site can restyle the output without patching the
 * renderer, and so a non-English site can translate it.
 */

/** Human-readable strings, with `{placeholders}` substituted at use. */
export interface Strings {
  /** Heading above a generated list of child pages. */
  indexHeading: string;
  /** Separator between breadcrumb entries. */
  breadcrumbSeparator: string;
  /** Label on the control that opens the navigation on a small screen. */
  navToggle: string;
  /** Opens the site header's menu on a narrow screen. */
  headerToggle: string;
  /** Link to the previous page; `{title}` is the page's title. */
  previous: string;
  /** Link to the next page; `{title}` is the page's title. */
  next: string;
  /** Fallback title for the documentation root. */
  documentation: string;
  /** Summary for a section page; `{count}` is the number of children. */
  pageCount: string;
  /** Singular form of `pageCount`. */
  pageCountOne: string;
  /** Banner on a version that is not the current one; `{label}` is the version label. */
  versionBanner: string;
  /** Placeholder left where content could not be represented; `{what}` names it. */
  unsupportedNotice: string;
}

/** The strings used when a site configures none. */
export const DEFAULT_STRINGS: Strings = {
  indexHeading: 'In this section',
  breadcrumbSeparator: ' › ',
  navToggle: 'Menu',
  headerToggle: 'Site menu',
  previous: '← {title}',
  next: '{title} →',
  documentation: 'Documentation',
  pageCount: '{count} pages',
  pageCountOne: '1 page',
  versionBanner: 'This is documentation for {label}.',
  unsupportedNotice: 'Content omitted: {what}',
};

import type { StylePolicy } from './stylesheet';

/**
 * Which block vocabulary to emit.
 *
 * `core` is core blocks and nothing else, which is what a site with no plugin
 * installed can display. `plugin` additionally carries instructions the
 * WordPress plugin understands, in block-comment attributes only — never in the
 * saved markup, so the two are the same content to WordPress either way.
 */
export type BlockVocabulary = 'core' | 'plugin';

/** Class names and strings, resolved for one run. */
export interface Theme {
  /** Prefix on every generated class name. */
  readonly classPrefix: string;
  /** Whether the WordPress plugin is expected to be there. */
  readonly blocks: BlockVocabulary;
  /** Whether a stylesheet is published with the pages. */
  readonly styles: StylePolicy;
  /** Whether fences are tokenised at publish time. */
  readonly highlight: boolean;
  /** The resolved strings. */
  readonly strings: Strings;
  /** A prefixed class name: `cls('docs-nav')` with prefix `x` gives `x-docs-nav`. */
  cls(name: string): string;
  /** A string with `{placeholders}` filled in. */
  text(key: keyof Strings, values?: Record<string, string | number>): string;
}

/**
 * Build a theme.
 *
 * @param options Class prefix and any string overrides.
 */
export function createTheme(options: {
  classPrefix?: string;
  strings?: Partial<Strings>;
  blocks?: BlockVocabulary;
  styles?: StylePolicy;
  highlight?: boolean;
} = {}): Theme {
  const classPrefix = options.classPrefix ?? 'pterodocs';
  const strings: Strings = { ...DEFAULT_STRINGS, ...options.strings };
  return {
    classPrefix,
    blocks: options.blocks ?? 'core',
    styles: options.styles ?? 'inline',
    highlight: options.highlight !== false,
    strings,
    cls(name: string): string {
      return `${classPrefix}-${name}`;
    },
    text(key, values = {}): string {
      return strings[key].replace(/\{(\w+)\}/g, (match, name: string) =>
        name in values ? String(values[name]) : match,
      );
    },
  };
}
