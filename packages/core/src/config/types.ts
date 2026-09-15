/**
 * The configuration a site writes, and the resolved shape the tool reads.
 *
 * Credentials never appear here: the config names the environment variables
 * that hold them, so a config file is safe to commit.
 */

import type { Severity } from '../util/issues';
import type { PageLayout } from '../render/page';
import type { Strings } from '../render/theme';

/** Which documents to publish. */
export interface SiteConfig {
  /** Docusaurus site directory. Relative paths resolve against the config file. */
  dir?: string;
  /** Explicit `docusaurus.config.*` path. */
  config?: string;
  /** Docs plugin instances to publish, or 'all'. */
  instances?: string[] | 'all';
  /** Sidebars to publish. A document no kept sidebar reaches is not published. */
  sidebars?: string[] | 'all';
  /** Versions to publish: 'last', 'all', or explicit names. */
  versions?: string[] | 'all' | 'last';
  /** Locales to publish: 'default', 'all', or explicit codes. */
  locales?: string[] | 'all' | 'default';
  /** Publish documents Docusaurus marks as drafts. */
  includeDrafts?: boolean;
  /** Publish documents Docusaurus marks as unlisted. */
  includeUnlisted?: boolean;
  /** Publish documents that belong to no sidebar. */
  includeOrphans?: boolean;
}

/** Where to publish. */
export interface TargetConfig {
  /** The only implementation today. */
  type?: 'wordpress';
  /** Site origin. Usually supplied by the environment instead. */
  url?: string;
  /** Which environment variables hold the credentials. */
  auth?: { userEnv?: string; passwordEnv?: string };
  /** Path the documentation tree hangs from. */
  root?: string;
  /** Segment below the root holding the docs; '' publishes under the root. */
  base?: string;
  /** Title of the documentation root when no document claims it. */
  title?: string;
  /** Status applied to every synced page. */
  status?: 'publish' | 'draft' | 'private';
  /** Page template slug. */
  template?: string;
  /** Polylang language code. */
  lang?: string;
  /** Map a rendered field onto a target metadata key. */
  meta?: { description?: string };
  /** Send DELETE as POST with an override header. */
  methodOverride?: boolean;
  /** How hard to retry a busy site. */
  retry?: { attempts?: number; baseDelayMs?: number; maxDelayMs?: number };
}

/** How pages are rendered. */
export interface RenderConfig {
  /** Prefix on every generated class name. */
  classPrefix?: string;
  /**
   * Which block vocabulary to emit.
   *
   * `core` is the default and emits core blocks only. `plugin` additionally
   * carries instructions the pterodocs WordPress plugin understands — chiefly
   * highlighted line ranges, which core blocks cannot express at all — in block
   * comments rather than in markup, so WordPress stores the same content either
   * way. Set it once the plugin is installed; `pterodocs doctor` says whether it
   * is.
   */
  blocks?: 'core' | 'plugin';
  /**
   * Whether a stylesheet is published with the pages.
   *
   * `inline` is the default and stores one with each page, because a site that
   * has installed nothing has nowhere else to read it from: WordPress renders
   * core blocks with almost no opinion, and documentation that arrives with
   * none of its own looks like an unstyled outline. Set `none` when the theme
   * already dresses these class names, or when the WordPress plugin is
   * installed and bringing its own.
   */
  styles?: 'inline' | 'none';
  /**
   * Tokenise fences at publish time.
   *
   * On by default. What is stored is Prism's classes, never colours, so the
   * palette stays in the stylesheet and restyling code never means publishing
   * every page again.
   */
  highlight?: boolean;
  /** Drop a leading H1 that repeats the page title. */
  dedupeTitle?: boolean;
  /** Where links to unpublished documents point: the site, or nowhere. */
  unpublishedLinks?: 'site' | 'drop';
  /** Overrides the documentation site URL used by `unpublishedLinks: 'site'`. */
  siteUrl?: string;
  /** Longest excerpt, in characters. */
  excerptLength?: number;
  /** Human strings, overriding the defaults. */
  strings?: Partial<Strings>;
  /** Per-locale string overrides. */
  localeStrings?: Record<string, Partial<Strings>>;
}

/** How MDX is handled. */
export interface MdxConfig {
  /** What to do about JSX with no translation. */
  onUnknown?: 'report' | 'placeholder' | 'error';
}

/** How assets are handled. */
export interface MediaConfig {
  /** Upload local files to the target. */
  upload?: boolean;
  /** Also upload files that already point at another origin. */
  uploadRemote?: boolean;
  /** What to do when a referenced file is missing. */
  onMissing?: Severity | 'ignore';
  /** Prefix of the media slug that carries the content hash. */
  slugPrefix?: string;
}

/** Where the run writes what it did. */
export interface OutputConfig {
  /** Directory for rendered pages, the manifest and the plan. */
  dir?: string;
  /** Write each rendered page body as a file. */
  pages?: boolean;
}

/**
 * The files an LLM reads instead of the site.
 *
 * Both are described at https://llmstxt.org. They are built from what this run
 * published and carry the target's URLs, so they describe the documentation as
 * it exists on WordPress rather than as it exists in Docusaurus.
 */
export interface LlmsConfig {
  /** Write `llms.txt`, an index of every published page. On by default. */
  index?: boolean;
  /**
   * Write `llms-full.txt`, the same index with every document inlined. On by
   * default; it costs one extra serialisation of each document.
   */
  full?: boolean;
  /**
   * Store them on the target as well as writing them to the output directory.
   *
   * On by default. The pterodocs WordPress plugin serves what it finds; without
   * the plugin the write is refused and the run says so, having changed
   * nothing.
   */
  publish?: boolean;
  /** Heading for both files. The site's own title by default. */
  title?: string;
  /** Summary under the heading. The documentation root's description by default. */
  description?: string;
}

/**
 * Publishing the site's blog, rather than its documentation.
 *
 * A blog is not documentation and does not want to be published as one. Its
 * posts are dated, they accumulate, and they belong in the site's own feed and
 * categories alongside everything else written there -- so `--blog` publishes
 * them as ordinary WordPress posts.
 *
 * That means their URLs are the site's to decide, not pterodocs's: a post sits
 * wherever the permalink structure puts it, and nothing can move it under the
 * documentation. What can line the two up is the category, which is the only
 * hierarchy a post has -- so the posts are filed under a category built from
 * the documentation's own root path.
 *
 * Everything not named here is taken from the run it is folded over: the same
 * site, the same credentials, the same class prefix, the same locale handling.
 */
export interface BlogConfig {
  /**
   * Which blog instance to publish.
   *
   * Only needed when the site has more than one; publishing several at once
   * would be several trees in one run, which this deliberately is not.
   */
  instance?: string;
  /**
   * What the posts' own category is called, e.g. `Release notes`.
   *
   * It is created under a category path built from `target.root`, so a site
   * whose documentation is at `/products/docstack` files its release notes
   * under Products > DocStack > Release notes.
   */
  category?: string;
  /**
   * File the posts under this category path instead, outermost first.
   *
   * For a site whose categories do not mirror its paths. Given, `category` is
   * ignored and `target.root` is not consulted.
   */
  categoryPath?: string[];
  /** Publish the posts' tags. On by default. */
  tags?: boolean;
  /** Status applied to every post. Defaults to the target's. */
  status?: 'publish' | 'draft' | 'private';
  /** Template slug. Defaults to none. */
  template?: string;
  /** Layout overrides. A post is published as a single column, with no navigation. */
  layout?: Partial<PageLayout>;
  /**
   * Output subdirectory, below the configured one.
   *
   * A separate directory because writing artefacts clears the one it writes
   * to, so sharing it would mean each run destroyed the other's output.
   */
  out?: string;
}

/** A pterodocs configuration file. */
export interface PterodocsConfig {
  site?: SiteConfig;
  target?: TargetConfig;
  layout?: Partial<PageLayout>;
  render?: RenderConfig;
  mdx?: MdxConfig;
  media?: MediaConfig;
  output?: OutputConfig;
  llms?: LlmsConfig;
  /** Publishing the blog, for a run given `--blog`. */
  blog?: BlogConfig;
  /** With `--strict`, an issue at this severity or above fails the run. */
  strict?: Severity;
}

/**
 * Identity function that types a configuration file.
 *
 * @param config The configuration.
 */
export function defineConfig(config: PterodocsConfig): PterodocsConfig {
  return config;
}
