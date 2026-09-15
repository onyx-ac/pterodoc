/**
 * Normalising Docusaurus's loaded state into the site model.
 *
 * The mapping is deliberately thin: almost every field is copied, because the
 * point of loading Docusaurus is to inherit its answers rather than to
 * second-guess them.
 */

import path from 'node:path';
import { detectFormat, type MarkdownFormat } from '@pterodocs/core/render';
import { relativeToPrefix, resolveAliasedPath, toPosix } from '@pterodocs/core/util';
import { DEFAULT_ADMONITION_KEYWORDS } from '@pterodocs/core/render';
import { loadDocusaurusServer, type LoadedSite } from './server';
import type {
  Doc,
  DocAuthor,
  DocsInstance,
  DocsVersion,
  NavbarItem,
  SidebarItem,
  SiteNavbar,
  SiteModel,
} from '@pterodocs/core/model';

/** Name Docusaurus gives the docs plugin. */
const DOCS_PLUGIN = 'docusaurus-plugin-content-docs';
const BLOG_PLUGIN = 'docusaurus-plugin-content-blog';

/** What to load, and which parts of it to keep. */
export interface LoadModelOptions {
  /** Absolute path of the Docusaurus site directory. */
  siteDir: string;
  /** Locale to load; one call loads exactly one locale. */
  locale?: string | undefined;
  /** Explicit `docusaurus.config.*` path. */
  configPath?: string | undefined;
  /** Docs plugin instance ids to keep, or 'all'. */
  instances?: string[] | 'all' | undefined;
  /** Versions to keep: 'last', 'all', or explicit names. */
  versions?: string[] | 'all' | 'last' | undefined;
  /** Publish draft documents. Docusaurus normally drops them from a build. */
  includeDrafts?: boolean | undefined;
  /**
   * Also read the blog, as instances of kind `blog`.
   *
   * Off unless asked. A site's blog is not documentation, and publishing one
   * without being told to would put posts on a target that never expected
   * them. `true` takes every blog instance; a list names them.
   */
  blog?: boolean | string[] | undefined;
  /** Called with warnings raised while loading. */
  warn?: ((message: string) => void) | undefined;
}

/** Read a nested property without pretending to know the whole shape. */
function get<T>(source: unknown, keys: string[], fallback: T): T {
  let current: unknown = source;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return fallback;
    current = (current as Record<string, unknown>)[key];
  }
  return (current ?? fallback) as T;
}

/** Docusaurus's admonition option is `true`, or an object that may extend the defaults. */
function admonitionKeywords(options: Record<string, unknown>): string[] {
  const admonitions = options['admonitions'];
  if (admonitions === false) return [];
  if (admonitions === true || admonitions === undefined) return [...DEFAULT_ADMONITION_KEYWORDS];

  const keywords = get<string[] | undefined>(admonitions, ['keywords'], undefined);
  const extendDefaults = get<boolean>(admonitions, ['extendDefaults'], true);
  if (!keywords) return [...DEFAULT_ADMONITION_KEYWORDS];
  return extendDefaults ? [...new Set([...DEFAULT_ADMONITION_KEYWORDS, ...keywords])] : [...keywords];
}

/** Turn one of Docusaurus's loaded documents into ours. */
function toDoc(
  raw: Record<string, unknown>,
  version: { name: string; pathPrefix: string },
  siteDir: string,
  siteFormat: 'md' | 'mdx' | 'detect',
): Doc {
  const sourceAliased = String(raw['source'] ?? '');
  const sourceAbsolutePath = resolveAliasedPath(sourceAliased, siteDir);
  const permalink = String(raw['permalink'] ?? '');
  const frontMatter = (raw['frontMatter'] ?? {}) as Record<string, unknown>;

  const declaredFormat = frontMatter['format'];
  const format: MarkdownFormat =
    declaredFormat === 'md' || declaredFormat === 'mdx'
      ? declaredFormat
      : siteFormat === 'detect'
        ? detectFormat(sourceAbsolutePath)
        : siteFormat;

  return {
    id: String(raw['id'] ?? ''),
    versionName: version.name,
    title: String(raw['title'] ?? ''),
    description: String(raw['description'] ?? ''),
    sourceAliased,
    sourceAbsolutePath,
    sourceRelativePath: toPosix(path.relative(siteDir, sourceAbsolutePath)),
    sourceDirName: String(raw['sourceDirName'] ?? '.'),
    slug: String(raw['slug'] ?? ''),
    permalink,
    // The position in the published tree is the permalink with the version's
    // own prefix removed, so front-matter slugs are honoured for free.
    treePath: relativeToPrefix(permalink, version.pathPrefix) ?? '',
    draft: raw['draft'] === true,
    unlisted: raw['unlisted'] === true,
    frontMatter,
    sidebarName: (raw['sidebar'] as string | undefined) ?? undefined,
    sidebarPosition: (raw['sidebarPosition'] as number | undefined) ?? undefined,
    previous: (raw['previous'] as Doc['previous']) ?? undefined,
    next: (raw['next'] as Doc['next']) ?? undefined,
    tags: (raw['tags'] as Doc['tags']) ?? [],
    format,
  };
}

/**
 * Turn one blog post into a document.
 *
 * A post is very nearly a document already: it has an id, a title, a
 * description, a source file, a permalink and front matter, and the body is
 * the same markdown or MDX. What it has instead of a sidebar position is a
 * date, and what it has that a document never does is authors.
 *
 * @param raw One entry from the blog plugin's loaded content.
 * @param version The synthetic version posts belong to.
 * @param siteDir The site directory, for resolving the source path.
 * @param siteFormat The site's markdown flavour.
 */
function toPost(
  raw: Record<string, unknown>,
  version: { name: string; pathPrefix: string },
  siteDir: string,
  siteFormat: 'md' | 'mdx' | 'detect',
): Doc {
  const sourceAliased = String(raw['source'] ?? '');
  const sourceAbsolutePath = resolveAliasedPath(sourceAliased, siteDir);
  const permalink = String(raw['permalink'] ?? '');
  const frontMatter = (raw['frontMatter'] ?? {}) as Record<string, unknown>;

  const declaredFormat = frontMatter['format'];
  const format: MarkdownFormat =
    declaredFormat === 'md' || declaredFormat === 'mdx'
      ? declaredFormat
      : siteFormat === 'detect'
        ? detectFormat(sourceAbsolutePath)
        : siteFormat;

  const treePath = relativeToPrefix(permalink, version.pathPrefix) ?? '';

  return {
    id: String(raw['id'] ?? permalink),
    versionName: version.name,
    title: String(raw['title'] ?? ''),
    description: String(raw['description'] ?? ''),
    sourceAliased,
    sourceAbsolutePath,
    sourceRelativePath: toPosix(path.relative(siteDir, sourceAbsolutePath)),
    // Posts are flat however their files are foldered, so the tree path is the
    // whole of what sits below the blog's own base.
    sourceDirName: '.',
    slug: treePath,
    permalink,
    treePath,
    draft: raw['draft'] === true,
    unlisted: raw['unlisted'] === true,
    frontMatter,
    previous: neighbour(raw['prevItem']),
    next: neighbour(raw['nextItem']),
    tags: (raw['tags'] as Doc['tags']) ?? [],
    date: dateOf(raw['date']),
    authors: authorsOf(raw['authors']),
    format,
  };
}

/** A neighbouring post, in the shape a document's neighbour has. */
function neighbour(raw: unknown): Doc['previous'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const item = raw as Record<string, unknown>;
  return { title: String(item['title'] ?? ''), permalink: String(item['permalink'] ?? '') };
}

/** Docusaurus hands the date back as a Date; the model carries strings. */
function dateOf(raw: unknown): string | undefined {
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === 'string' && raw) return new Date(raw).toISOString();
  return undefined;
}

/** Authors, already resolved against the site's authors map. */
function authorsOf(raw: unknown): DocAuthor[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((entry) => {
    const author = (entry ?? {}) as Record<string, unknown>;
    const name = String(author['name'] ?? author['key'] ?? '');
    const title = author['title'] === undefined ? undefined : String(author['title']);
    const url = author['url'] === undefined ? undefined : String(author['url']);
    return { name, ...(title ? { title } : {}), ...(url ? { url } : {}) };
  });
}

/** Turn one of Docusaurus's loaded versions into ours. */
function toVersion(
  raw: Record<string, unknown>,
  siteDir: string,
  siteFormat: 'md' | 'mdx' | 'detect',
  includeDrafts: boolean,
): DocsVersion {
  const name = String(raw['versionName'] ?? 'current');
  const pathPrefix = String(raw['path'] ?? '');
  const contentPath = String(raw['contentPath'] ?? '');

  const published = (raw['docs'] as Record<string, unknown>[] | undefined) ?? [];
  const drafts = (raw['drafts'] as Record<string, unknown>[] | undefined) ?? [];
  const source = includeDrafts ? [...published, ...drafts] : published;

  return {
    name,
    label: String(raw['label'] ?? name),
    isLast: raw['isLast'] === true,
    pathPrefix,
    contentPath,
    contentPathLocalized: String(raw['contentPathLocalized'] ?? contentPath),
    banner: (raw['banner'] as DocsVersion['banner']) ?? null,
    noIndex: raw['noIndex'] === true,
    sidebars: (raw['sidebars'] as Record<string, SidebarItem[]> | undefined) ?? {},
    docs: source.map((doc) => toDoc(doc, { name, pathPrefix }, siteDir, siteFormat)),
    draftCount: drafts.length,
  };
}

/**
 * Turn a blog plugin instance into one of ours.
 *
 * The blog has no sidebar, so one is made: every post as a doc item, newest
 * first, which is the order a changelog is read in. That is the whole trick —
 * with a sidebar in hand, `buildPageTree` and everything downstream of it
 * treats a blog exactly as it treats documentation, and none of it had to
 * learn what a post is.
 *
 * @param plugin The loaded blog plugin.
 * @param siteDir The site directory.
 * @param siteFormat The site's markdown flavour.
 * @param includeDrafts Whether to publish posts Docusaurus marks as drafts.
 */
function toBlogInstance(
  plugin: { name: string; options: Record<string, unknown>; content: unknown },
  siteDir: string,
  siteFormat: 'md' | 'mdx' | 'detect',
  includeDrafts: boolean,
): DocsInstance {
  const routeBasePath = String(plugin.options['routeBasePath'] ?? 'blog');
  const contentDirName = String(plugin.options['path'] ?? 'blog');
  const entries = get<Record<string, unknown>[]>(plugin.content, ['blogPosts'], []) ?? [];

  // Docusaurus hands back `{ id, metadata, content }` per post.
  const raw = entries.map((entry) => (entry['metadata'] ?? entry) as Record<string, unknown>);

  // The permalink of the first post, minus its own slug, is the blog's base —
  // read rather than assembled, so a `baseUrl` or a localised prefix is
  // already accounted for.
  const first = raw[0];
  const pathPrefix = first
    ? String(first['permalink'] ?? '').replace(/[^/]*\/?$/, '').replace(/\/$/, '')
    : routeBasePath;

  const version = { name: 'current', pathPrefix };
  const posts = raw
    .map((entry) => toPost(entry, version, siteDir, siteFormat))
    .filter((post) => includeDrafts || !post.draft);

  // Newest first. Docusaurus already sorts them, but a post with no date at
  // all must not silently jump to the front.
  const ordered = [...posts].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  const synthetic: DocsVersion = {
    name: 'current',
    label: String(plugin.options['blogTitle'] ?? 'Blog'),
    isLast: true,
    pathPrefix,
    contentPath: path.resolve(siteDir, contentDirName),
    contentPathLocalized: path.resolve(siteDir, contentDirName),
    banner: null,
    noIndex: false,
    sidebars: {
      blog: ordered
        .filter((post) => !post.unlisted)
        .map((post): SidebarItem => ({ type: 'doc', id: post.id })),
    },
    docs: ordered,
    draftCount: posts.length - ordered.filter((post) => !post.draft).length,
  };

  return {
    id: String(plugin.options['id'] ?? 'default'),
    kind: 'blog',
    routeBasePath,
    contentDirName,
    admonitionKeywords: admonitionKeywords(plugin.options),
    breadcrumbs: false,
    versions: [synthetic],
  };
}

/**
 * The first document a sidebar leads to.
 *
 * A `docSidebar` entry in the navbar names a sidebar, not a page; Docusaurus
 * resolves it to whatever that sidebar opens on. Doing the same here is what
 * keeps the published header pointing where the site's own header points.
 *
 * @param instances Everything loaded, since a navbar may name any instance's sidebar.
 * @param sidebarId The sidebar the entry names.
 * @returns The permalink, or empty when nothing was found.
 */
function firstDocOf(instances: DocsInstance[], sidebarId: string): string {
  for (const instance of instances) {
    for (const version of instance.versions) {
      const items = version.sidebars[sidebarId];
      if (!items) continue;

      // Depth first: a category's own link, then whatever it contains.
      const walk = (entries: SidebarItem[]): string => {
        for (const entry of entries) {
          if (entry.type === 'doc' || entry.type === 'ref') {
            const doc = version.docs.find((candidate) => candidate.id === entry.id);
            if (doc) return doc.permalink;
          }
          if (entry.type === 'category') {
            if (entry.link?.type === 'generated-index') return entry.link.permalink;
            const found = walk(entry.items);
            if (found) return found;
          }
        }
        return '';
      };

      const found = walk(items);
      if (found) return found;
    }
  }

  return '';
}

/**
 * Turn one navbar entry into ours.
 *
 * Docusaurus accepts several shapes here, and a few of them describe behaviour
 * rather than a destination — a search box, a locale switcher, a version
 * dropdown. Those have no counterpart in a published page, so they come back
 * with no label and are dropped by the caller, which reports them.
 *
 * @param raw One entry from `themeConfig.navbar.items`.
 * @param baseUrl The site's base URL, for a site-relative `to`.
 * @param instances Everything loaded, for resolving a `docSidebar`.
 */
function toNavbarItem(
  raw: Record<string, unknown>,
  baseUrl: string,
  instances: DocsInstance[],
): NavbarItem | undefined {
  const type = String(raw['type'] ?? '');
  const label = String(raw['label'] ?? raw['title'] ?? '');
  const position = raw['position'] === 'right' ? 'right' : 'left';

  // Entries that are a control rather than a link.
  if (['search', 'localeDropdown', 'docsVersionDropdown', 'html', 'custom'].includes(type)) {
    return undefined;
  }
  if (!label) return undefined;

  const children = Array.isArray(raw['items'])
    ? (raw['items'] as Record<string, unknown>[])
        .map((child) => toNavbarItem(child, baseUrl, instances))
        .filter((child): child is NavbarItem => child !== undefined)
    : [];

  let href = '';
  if (typeof raw['href'] === 'string') {
    href = raw['href'];
  } else if (typeof raw['to'] === 'string') {
    const to = raw['to'];
    href = to.startsWith('/') ? `${baseUrl.replace(/\/+$/, '')}${to}` : to;
  } else if (type === 'docSidebar' && typeof raw['sidebarId'] === 'string') {
    href = firstDocOf(instances, raw['sidebarId']);
  } else if (type === 'doc' && typeof raw['docId'] === 'string') {
    const id = raw['docId'];
    for (const instance of instances) {
      for (const version of instance.versions) {
        const doc = version.docs.find((candidate) => candidate.id === id);
        if (doc) href = doc.permalink;
      }
    }
  }

  return { label, href, position, ...(children.length > 0 ? { items: children } : {}) };
}

/**
 * The site's navigation bar, as configured.
 *
 * @param siteConfig Docusaurus's own configuration.
 * @param baseUrl The site's base URL.
 * @param instances Everything loaded, for resolving entries that name a sidebar.
 */
function toNavbar(
  siteConfig: Record<string, unknown>,
  baseUrl: string,
  instances: DocsInstance[],
  warn: (message: string) => void,
): SiteNavbar | undefined {
  const navbar = get<Record<string, unknown> | undefined>(siteConfig, ['themeConfig', 'navbar'], undefined);
  if (!navbar) return undefined;

  const raw = Array.isArray(navbar['items']) ? (navbar['items'] as Record<string, unknown>[]) : [];
  const items = raw
    .map((entry) => toNavbarItem(entry, baseUrl, instances))
    .filter((entry): entry is NavbarItem => entry !== undefined);

  // A link with nowhere to go is worse than no link. Say which, rather than
  // publishing a header entry that does nothing when clicked.
  const unresolved = (entry: NavbarItem): string[] => [
    ...(entry.href === '' && !entry.items ? [entry.label] : []),
    ...(entry.items ?? []).flatMap(unresolved),
  ];
  for (const label of items.flatMap(unresolved)) {
    warn(`The navbar entry "${label}" names a destination that could not be resolved, so the header omits its link.`);
  }

  return { title: String(navbar['title'] ?? siteConfig['title'] ?? ''), items };
}

/** Keep only the versions the caller asked for. */
function selectVersions(versions: DocsVersion[], selector: LoadModelOptions['versions']): DocsVersion[] {
  if (selector === 'all') return versions;
  if (Array.isArray(selector)) return versions.filter((version) => selector.includes(version.name));
  const last = versions.find((version) => version.isLast);
  return last ? [last] : versions.slice(0, 1);
}

/**
 * Normalise a loaded Docusaurus site into the model.
 *
 * Exposed separately from {@link loadModel} so the plugin, which already has
 * the loaded state, can reuse it without loading the site again.
 */
export function toSiteModel(site: LoadedSite, options: LoadModelOptions): SiteModel {
  const { props } = site;
  const siteDir = props.siteDir;
  const siteConfig = props.siteConfig;
  const siteFormat = get<'md' | 'mdx' | 'detect'>(siteConfig, ['markdown', 'format'], 'mdx');
  const staticDirectories = get<string[]>(siteConfig, ['staticDirectories'], ['static']);

  const instances: DocsInstance[] = props.plugins
    .filter((plugin) => plugin.name === DOCS_PLUGIN)
    .map((plugin) => {
      const loadedVersions =
        get<Record<string, unknown>[]>(plugin.content, ['loadedVersions'], []) ?? [];
      const versions = loadedVersions.map((version) =>
        toVersion(version, siteDir, siteFormat, options.includeDrafts === true),
      );
      return {
        id: String(plugin.options['id'] ?? 'default'),
        routeBasePath: String(plugin.options['routeBasePath'] ?? 'docs'),
        contentDirName: String(plugin.options['path'] ?? 'docs'),
        admonitionKeywords: admonitionKeywords(plugin.options),
        breadcrumbs: plugin.options['breadcrumbs'] !== false,
        versions: selectVersions(versions, options.versions),
      };
    })
    .filter(
      (instance) =>
        options.instances === undefined ||
        options.instances === 'all' ||
        options.instances.includes(instance.id),
    );

  const blogSelector = options.blog;
  const blogInstances: DocsInstance[] =
    blogSelector === undefined || blogSelector === false
      ? []
      : props.plugins
          .filter((plugin) => plugin.name === BLOG_PLUGIN)
          .map((plugin) => toBlogInstance(plugin, siteDir, siteFormat, options.includeDrafts === true))
          .filter(
            (instance) => blogSelector === true || (blogSelector as string[]).includes(instance.id),
          );

  return {
    siteDir,
    url: String(siteConfig['url'] ?? ''),
    baseUrl: props.baseUrl,
    trailingSlash: siteConfig['trailingSlash'] as boolean | undefined,
    locale: props.i18n.currentLocale,
    defaultLocale: props.i18n.defaultLocale,
    locales: props.i18n.locales,
    markdownFormat: siteFormat,
    maintainCase: get<boolean>(siteConfig, ['markdown', 'anchors', 'maintainCase'], false),
    siteTitle: String(siteConfig['title'] ?? ''),
    staticDirs: staticDirectories.map((dir) => path.resolve(siteDir, dir)),
    docusaurusVersion: props.siteMetadata.docusaurusVersion,
    navbar: toNavbar(siteConfig, props.baseUrl, [...instances, ...blogInstances], options.warn ?? ((): void => {})),
    instances: [...instances, ...blogInstances],
  };
}

/**
 * Load a Docusaurus site and normalise it.
 *
 * One call loads one locale, because that is what Docusaurus's own loader
 * does; publishing several locales means calling this once for each.
 */
export async function loadModel(options: LoadModelOptions): Promise<SiteModel> {
  const warn = options.warn ?? (() => {});
  const server = loadDocusaurusServer(options.siteDir, warn);

  // Docusaurus's own CLI always runs from the site directory, and plugins rely
  // on it: a typedoc entry point of `../client/src/index.ts`, for instance, is
  // resolved against the working directory rather than the site. Loading from
  // anywhere else makes those plugins look in the wrong place.
  const previousCwd = process.cwd();
  process.chdir(options.siteDir);

  // Docusaurus only drops drafts and applies production behaviour when
  // NODE_ENV says so, and publishing is a production act. Without this a draft
  // reaches the site, which is precisely what marking it a draft asked to
  // avoid.
  const previousNodeEnv = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'production';

  try {
    const site = await server.loadSite({
      siteDir: options.siteDir,
      locale: options.locale,
      config: options.configPath,
    });
    return toSiteModel(site, options);
  } finally {
    process.chdir(previousCwd);
    if (previousNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = previousNodeEnv;
  }
}
