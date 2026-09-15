/**
 * The reconciler.
 *
 * Two phases, because WordPress's navigation block needs a page id before any
 * body can reference it: first make sure every page exists, then render every
 * body against the real ids and write only what differs.
 */

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { VERSION } from '../version';
import { IssueCollector, type Issue } from '../util/issues';
import { contentHash } from '../util/hash';
import { mimeTypeFor } from '../util/mime';
import { titleCase } from '../util/paths';
import { buildPageTree, type PageNode, type PageTree } from '../model/tree';
import type { Doc, DocsVersion, NavbarItem, SiteModel, SiteNavbar } from '../model/types';
import type { SourceReader } from '../model/reader';
import { renderDoc, excerptFor } from '../render/index';
import {
  composePage,
  renderVersionBanner,
  type HeaderLike,
  type HeaderLink,
  type PageLayout,
} from '../render/page';
import { createTheme, type Theme } from '../render/theme';
import { stylesheetFor } from '../render/stylesheet';
import { collectImages, resolveImage } from '../render/images';
import type { LinkResolver } from '../render/links';
import type { MediaRef, RenderedPage, Target, TargetSession } from '../target/target';
import type { ResolvedConfig } from '../config/load';
import { isOwnPage } from './purge';
import { summarise, type Action, type Plan } from './plan';
import { writeArtifacts, type Artifacts, type ManifestEntry } from './artifacts';
import {
  renderLlmsIndex,
  renderLlmsFull,
  LLMS_META_INDEX,
  LLMS_META_FULL,
  type LlmsInput,
  type LlmsPage,
} from './llms';

/** What a run needs beyond its configuration. */
export interface RunSyncDeps {
  /** Where the site model comes from. */
  reader: SourceReader;
  /**
   * Where pages are published.
   *
   * Always supplied, even for a run that publishes nothing: the target owns
   * URL policy, so rendering needs it to know what a page's address will be.
   */
  target?: Target | undefined;
  /** Render only: build no session and contact nothing. */
  renderOnly?: boolean | undefined;
  /** Progress worth seeing under `--verbose`. */
  log?: (message: string) => void;
}

/** What a run produced. */
export interface RunResult {
  plan: Plan;
  artifacts: Artifacts;
}

/** One page, ready to be compared and written. */
interface PreparedPage {
  node: PageNode;
  page: RenderedPage;
  locale: string;
  versionName: string;
  /** The document as markdown, when `llms-full.txt` asked for it. */
  markdown?: string | undefined;
}

/** Run the sync. */
export async function runSync(config: ResolvedConfig, deps: RunSyncDeps): Promise<RunResult> {
  const log = deps.log ?? ((): void => {});
  const issues = new IssueCollector();
  const actions: Action[] = [];
  const prepared: PreparedPage[] = [];
  const mediaRecords: Artifacts['media'] = [];
  let requests = 0;
  let mediaPending = 0;
  let docusaurusVersion: string | null = null;
  let siteTitle = '';
  let llms: Artifacts['llms'] = null;
  let published: string | undefined;

  const locales = await selectLocales(config, deps.reader);

  for (const locale of locales) {
    const model = await deps.reader.read(locale);
    docusaurusVersion ??= model.docusaurusVersion;
    siteTitle ||= model.siteTitle;

    const theme = createTheme({
      classPrefix: config.classPrefix,
      blocks: config.blocks,
      styles: config.styles,
      highlight: config.highlight,
      strings: { ...config.strings, ...config.localeStrings[model.locale] },
    });

    const session =
      deps.target && !deps.renderOnly && !config.offline
        ? await deps.target.open({ locale: model.locale, dryRun: config.dryRun })
        : undefined;

    let rootId: number | null = null;

    for (const instance of model.instances) {
      // One run publishes one tree. A blog and its documentation are both
      // instances of the same model, so the run says which it came for.
      if ((instance.kind ?? 'docs') !== config.publish) continue;

      for (const version of instance.versions) {
        const result = await syncVersion({
          config,
          model,
          instance: { admonitionKeywords: instance.admonitionKeywords },
          version,
          theme,
          target: deps.target,
          session,
          issues,
          log,
        });
        actions.push(...result.actions);
        prepared.push(...result.prepared);
        mediaRecords.push(...result.media);
        mediaPending += result.mediaPending;
        rootId ??= result.rootId;
      }
    }

    // After the instances, not before: the target only knows where it listed
    // them once the session has resolved it, which happens on the first write.
    published ??= session?.publishedIndex?.();

    // A post's byline is the target's to render, from the account that wrote
    // it -- so saying who a document names would either duplicate what the
    // site already shows or contradict it. Mapping the name to a user is the
    // only honest alternative, and that means creating or matching accounts,
    // which is not something a publish should do on its own. So it is said
    // once, and left.
    const named = new Set<string>();
    for (const entry of prepared) {
      for (const author of entry.node.doc?.authors ?? []) named.add(author.name);
    }
    if (named.size > 0) {
      issues.add({
        code: 'authors-not-mapped',
        severity: 'info',
        message:
          `${[...named].sort().join(', ')} ${named.size === 1 ? 'is named as an author' : 'are named as authors'} in the source, but posts are attributed to the account running the sync. ` +
          'Mapping a name to a user would mean creating or matching accounts, which a publish does not do.',
      });
    }

    // Built at the end of the primary locale's turn, which is the first time
    // every page it will describe has been rendered — and the last time this
    // locale's session is still open to write it with.
    if (locale === locales[0]) {
      llms = buildLlms(config, prepared, locales, siteTitle, deps.target, issues);
      await publishLlms(llms, config, session, rootId, issues);
    }

    if (session) requests += session.requestCount();
  }

  // What the target says, where it knows better than the path does.
  const rootPath = published ?? deps.target?.rootPath ?? '/';
  const plan: Plan = {
    generatedAt: new Date().toISOString(),
    versions: { pterodocs: VERSION, docusaurus: docusaurusVersion, node: process.version },
    dryRun: config.dryRun,
    offline: config.offline,
    site: config.targetUrl || null,
    rootPath,
    locales,
    versionNames: [...new Set(prepared.map((entry) => entry.versionName))],
    actions,
    issues: issues.issues,
    summary: summarise(actions),
    requests,
    mediaPending,
    artifactError: null,
  };

  const artifacts: Artifacts = {
    stylesheet: stylesheetFor(
      createTheme({ classPrefix: config.classPrefix, styles: config.styles, highlight: config.highlight }),
      { navWidth: config.layout.navWidth },
    ),
    pages: prepared.map(({ page, locale, versionName }) => ({ page, locale, versionName })),
    manifest: prepared.map(({ node, page, locale, versionName }) => ({
      path: page.path,
      title: page.title,
      slug: page.slug,
      parent: node.parent ? node.parent.path : null,
      menuOrder: page.menuOrder,
      locale,
      versionName,
      file: page.file ?? null,
      href: deps.target ? deps.target.hrefFor(page.path, { versionName, locale }) : page.path,
    })) satisfies ManifestEntry[],
    media: mediaRecords,
    plan,
    llms,
  };

  try {
    await writeArtifacts(config.outDir, artifacts, { writePages: config.writePages });
  } catch (error) {
    plan.artifactError = error instanceof Error ? error.message : String(error);
  }

  return { plan, artifacts };
}

/**
 * Make a target path absolute, when the site's URL is known.
 *
 * `hrefFor` returns a path, because that is what a link inside a page needs.
 * These files are fetched from outside the site, so they need the whole URL —
 * and when no site URL is configured, the path is still better than nothing.
 *
 * @param siteUrl The target site's URL, or empty.
 * @param href A path on that site.
 */
function absoluteHref(siteUrl: string, href: string): string {
  if (!siteUrl) return href;
  try {
    return new URL(href, siteUrl).toString();
  } catch {
    return href;
  }
}

/**
 * Store the two files on the documentation root, for the target to serve.
 *
 * A write of its own rather than metadata carried by the root page, because
 * the root page is written while the tree is still being rendered and neither
 * file is known until every page is done.
 *
 * Never fails a run. A site without the pterodocs plugin has nothing
 * registered to receive these, and the publish is worth more than the index.
 *
 * @param llms What was built, or null when neither file was asked for.
 * @param config The resolved configuration.
 * @param session The open session, when there is one.
 * @param rootId Id of the documentation root page.
 * @param issues Where a refusal is recorded.
 */
async function publishLlms(
  llms: Artifacts['llms'],
  config: ResolvedConfig,
  session: TargetSession | undefined,
  rootId: number | null,
  issues: IssueCollector,
): Promise<void> {
  if (!llms || !config.llms.publish || !session || rootId === null) return;

  const meta: Record<string, string> = {};
  if (llms.index) meta[LLMS_META_INDEX] = llms.index;
  if (llms.full) meta[LLMS_META_FULL] = llms.full;
  if (Object.keys(meta).length === 0) return;

  const { warnings } = await session.writeMeta(rootId, meta);
  for (const warning of warnings) {
    issues.add({ code: 'llms-not-stored', severity: 'warning', message: warning });
  }
}

/**
 * Build the two files an LLM reads instead of the site.
 *
 * @param config The resolved configuration.
 * @param prepared Every page this run rendered.
 * @param locales The locales published, primary first.
 * @param siteTitle The site's own title, as a fallback heading.
 * @param target The target, for turning tree paths into URLs.
 * @param issues Where the multi-locale note is recorded.
 */
function buildLlms(
  config: ResolvedConfig,
  prepared: PreparedPage[],
  locales: string[],
  siteTitle: string,
  target: Target | undefined,
  issues: IssueCollector,
): Artifacts['llms'] {
  if (!config.llms.index && !config.llms.full) return null;

  // There is one site root, so there is one llms.txt. When a run publishes
  // several locales the index describes the primary one; interleaving three
  // languages under one heading would serve nobody, and saying so out loud is
  // better than dropping them quietly.
  const primary = locales[0] ?? '';
  if (locales.length > 1) {
    issues.add({
      code: 'llms-single-locale',
      severity: 'info',
      message: `llms.txt describes the "${primary}" documentation; the other ${locales.length - 1} locale(s) published are not indexed.`,
    });
  }

  const pages: LlmsPage[] = prepared
    .filter((entry) => entry.locale === primary)
    .map((entry) => ({
      path: entry.page.path,
      title: entry.page.title,
      description: entry.page.excerpt,
      href: absoluteHref(
        config.targetUrl,
        target
          ? target.hrefFor(entry.page.path, {
              versionName: entry.versionName,
              locale: entry.locale,
            })
          : entry.page.path,
      ),
      markdown: entry.markdown,
    }));

  const input: LlmsInput = {
    title: config.llms.title || siteTitle || 'Documentation',
    description: config.llms.description || pages.find((page) => page.path === '')?.description || '',
    pages,
  };

  return {
    index: config.llms.index ? renderLlmsIndex(input) : null,
    full: config.llms.full ? renderLlmsFull(input) : null,
  };
}

/** Which locales to publish. */
async function selectLocales(config: ResolvedConfig, reader: SourceReader): Promise<string[]> {
  if (Array.isArray(config.locales)) return config.locales;
  if (config.locales === 'all') return reader.locales();
  const model = await reader.read();
  return [model.defaultLocale ?? model.locale];
}

/** Everything one version's sync needs. */
interface SyncVersionInput {
  config: ResolvedConfig;
  model: SiteModel;
  instance: { admonitionKeywords: string[] };
  version: DocsVersion;
  theme: Theme;
  target: Target | undefined;
  session: TargetSession | undefined;
  issues: IssueCollector;
  log: (message: string) => void;
}

/** Publish one version of one docs instance. */
async function syncVersion(input: SyncVersionInput): Promise<{
  actions: Action[];
  prepared: PreparedPage[];
  /** Id of this version's documentation root, when the target has one. */
  rootId: number | null;
  media: Artifacts['media'];
  mediaPending: number;
}> {
  const { config, model, version, theme, target, session, issues, log } = input;
  const actions: Action[] = [];
  const locale = model.locale;

  const tree = buildPageTree({
    version,
    sidebars: config.sidebars,
    rootTitle: config.docsTitle,
    includeUnlisted: config.includeUnlisted,
    includeOrphans: config.includeOrphans,
    issues,
  });

  const context = { versionName: version.name, locale };

  // Where the target decides a page's URL rather than the path deciding it --
  // a WordPress post's permalink comes from the site's own settings -- the
  // only place it can be learned is from the target, when the page is ensured.
  // Only consulted where the target says the path is not enough. A target
  // that can work a URL out is the authority on it -- reading one back from a
  // page that already exists would let a bad stored link outlive the fix.
  const links = new Map<string, string>();
  const reportsUrls = target?.capabilities.predictableUrls === false;
  const href = (treePath: string): string =>
    (reportsUrls ? links.get(treePath) : undefined) ??
    (target ? target.hrefFor(treePath, context) : `/${treePath}`);

  // Phase 0 and 1: make sure the pages exist, so their ids are known.
  const ids = new Map<string, number | null>();
  const created = new Set<string>();
  let rootParentId: number | null = null;

  if (session) {
    await session.loadIndex();
    const root = await session.ensureRootParent();
    rootParentId = root.id;
    for (const entry of root.created) {
      actions.push({ op: 'create-root', path: entry.path, id: entry.id, locale });
    }
  }

  const inScope = (treePath: string): boolean =>
    !config.only || treePath === config.only || treePath.startsWith(`${config.only}/`);
  const isNeeded = (treePath: string): boolean =>
    inScope(treePath) || treePath === '' || config.only.startsWith(`${treePath}/`);

  // Where the target puts a tree with no root page of its own, the root node
  // is not published and its children hang from the collection instead. It is
  // still in the tree -- breadcrumbs and the navigation are built from it --
  // it simply never becomes a page.
  const publishesRoot = target?.capabilities.publishesTreeRoot !== false;
  const nodes = publishesRoot ? [tree.root, ...tree.chain] : tree.chain;

  /**
   * Where a page sits among its siblings.
   *
   * Zero throughout where the order is not to be published: a newest-first
   * archive numbered in sidebar order renumbers every older post the moment a
   * new one is written, and rewrites the whole tree on the next run.
   */
  const orderOf = (node: PageNode): number => (config.menuOrder === 'none' ? 0 : node.menuOrder);

  /** The id a node hangs from, or null while it is not known. */
  const parentOf = (node: PageNode): number | null =>
    node.parent && (publishesRoot || node.parent.path !== '')
      ? (ids.get(node.parent.path) ?? null)
      : rootParentId;

  for (const node of nodes) {
    if (!isNeeded(node.path)) continue;
    const parentId = parentOf(node);

    if (!session) {
      ids.set(node.path, null);
      continue;
    }

    const result = await session.ensurePage({
      path: node.path,
      slug: node.slug,
      parentId,
      title: node.title,
      menuOrder: orderOf(node),
      isRoot: node.path === '',
    });
    for (const warning of result.warnings) {
      issues.add({ code: 'target-warning', severity: 'warning', message: warning, path: node.path });
    }
    ids.set(node.path, result.id);
    if (result.link) links.set(node.path, result.link);
    if (result.created) {
      created.add(node.path);
      actions.push({
        op: 'create',
        path: node.path,
        id: result.id,
        locale,
        versionName: version.name,
        file: node.doc?.sourceRelativePath ?? null,
      });
      if (result.id !== null) log(`created ${node.path || '(root)'} (id ${result.id})`);
    }
  }

  // Media: resolve every referenced file, upload what is new, and remember
  // where each one ended up so the renderer can point at it.
  const media = new Map<string, { id: number; url: string }>();
  const mediaRecords: Artifacts['media'] = [];
  let mediaPending = 0;

  if (config.uploadMedia) {
    const result = await syncMedia({ config, model, version, tree, session, issues });
    for (const [url, ref] of result.byUrl) media.set(url, ref);
    mediaRecords.push(...result.records);
    mediaPending = result.pending;
    actions.push(...result.actions);
  }

  // Phase 2: render against the real ids, and write what differs.
  const navRootId = ids.get('') ?? null;
  const prepared: PreparedPage[] = [];
  const banner =
    version.banner && !version.isLast
      ? renderVersionBanner(theme, version.label, version.banner)
      : undefined;

  for (const node of nodes) {
    const { page, markdown } = renderPageFor({
      node,
      tree,
      config,
      model,
      version,
      theme,
      href,
      navRootId,
      admonitionKeywords: input.instance.admonitionKeywords,
      media,
      issues,
      emitMarkdown: config.llms.full,
      ...(banner ? { banner } : {}),
    });
    prepared.push({ node, page, locale, versionName: version.name, markdown });

    const id = ids.get(node.path);
    if (!session || id === null || id === undefined) continue;
    if (!inScope(node.path) && !created.has(node.path)) continue;

    const parentId = parentOf(node) ?? 0;
    const remote = await session.fetchPage(id);
    const changed = session.diffPage(remote, page, parentId ?? 0);

    if (changed.length === 0) {
      actions.push({
        op: 'unchanged',
        path: node.path,
        id,
        locale,
        versionName: version.name,
        file: page.file ?? null,
      });
      continue;
    }

    actions.push({
      op: 'update',
      path: node.path,
      id,
      changed,
      locale,
      versionName: version.name,
      file: page.file ?? null,
    });
    if (config.dryRun) continue;

    const { warnings } = await session.writePage(id, page, parentId ?? 0);
    for (const warning of warnings) {
      issues.add({ code: 'target-warning', severity: 'warning', message: warning, path: node.path });
    }
    log(`updated ${node.path || '(root)'} (${changed.join(', ')})`);
  }

  // A page that was created carries a slug the site has never had to route
  // before, which is the only moment a collision can appear. Pages that merely
  // changed already resolved on an earlier run, so checking them again would be
  // a request each to learn nothing.
  if (session) {
    for (const treePath of created) {
      const id = ids.get(treePath);
      if (typeof id !== 'number') continue;

      const url = absoluteHref(config.targetUrl, href(treePath));
      const { verdict, servedId } = await session.verifyResolution(id, url);

      if (verdict === 'shadowed') {
        issues.add({
          code: 'page-shadowed',
          severity: 'warning',
          path: treePath,
          message:
            `${url} was published but does not serve itself: the site answered with page ${servedId} instead. ` +
            'Something claims that path before WordPress looks for a page — a rewrite endpoint registered by ' +
            'another plugin is the usual cause, and it shadows every page with that slug anywhere on the site. ' +
            'Give the document a different slug, or remove whatever registers the endpoint.',
        });
      }
    }
  }

  // Anything under this version's root that no document accounts for. Where
  // there is no root page the collection itself is the tree, so the walk
  // starts at 0 -- which is only safe because the index is that post type's
  // alone, and is why this is anchored on the capability and not on an id.
  const pruneRootId = publishesRoot ? navRootId : 0;
  if (session && pruneRootId !== null) {
    if (config.only) {
      issues.add({
        code: 'prune-skipped',
        severity: 'info',
        message: 'Pruning was skipped because --only limited the run.',
      });
    } else {
      const index = await session.loadIndex();
      const keep = new Set<number>();
      for (const id of ids.values()) if (typeof id === 'number') keep.add(id);
      for (const page of session.computePrune(index, pruneRootId, keep)) {
        // Position inside the tree is not ownership. Somebody may have added a
        // page under the documentation root, and trashing it because this run
        // did not account for it would be pterodocs deleting someone else's work.
        const full = await session.fetchPage(page.id);
        if (!isOwnPage(full, config.classPrefix)) {
          issues.add({
            code: 'prune-skipped-foreign',
            severity: 'info',
            message: `${page.link} sits under the documentation root but was not written by pterodocs, so it was left alone.`,
          });
          continue;
        }

        actions.push({
          op: 'prune',
          path: page.slug,
          id: page.id,
          locale,
          versionName: version.name,
          applied: config.prune && !config.dryRun,
        });
        if (config.prune && !config.dryRun) {
          await session.removePage(page);
          log(`trashed ${page.link}`);
        }
      }
    }
  }

  return { actions, prepared, media: mediaRecords, mediaPending, rootId: navRootId };
}

/**
 * Turn the site's navbar into what the renderer wants.
 *
 * Two things happen here, and both are the reconciler's to do. A destination
 * that names a page this run published becomes that page's URL on the target;
 * anything else -- an external link, a page left on the Docusaurus site --
 * keeps the address it already had, which is the same rule links inside a
 * document follow.
 *
 * @param navbar The navbar as Docusaurus declared it.
 * @param tree The published tree, for recognising an internal destination.
 * @param href Where a tree path lives on the target.
 * @returns The header, or undefined when the site declares no navbar.
 */
function headerFor(
  navbar: SiteNavbar | undefined,
  tree: PageTree,
  href: (treePath: string) => string,
  config: ResolvedConfig,
  model: SiteModel,
): HeaderLike | undefined {
  if (!navbar) return undefined;

  const siteUrl = (config.siteUrl || model.url).replace(/\/+$/, '');

  const retarget = (link: string): string => {
    if (!link) return '';

    // `pathname://` tells Docusaurus not to treat what follows as a route. What
    // follows is a path on the Docusaurus site, so that is where it points.
    const target = link.startsWith('pathname://') ? link.slice('pathname://'.length) : link;

    // Already somewhere else entirely.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || target.startsWith('//')) return target;

    const node = tree.byPermalink.get(target) ?? tree.byPermalink.get(`${target.replace(/\/+$/, '')}/`);
    if (node) return href(node.path);

    // Nothing here publishes it. A site-relative path would mean something
    // different on the target -- and usually nothing at all -- so it becomes
    // the absolute URL Docusaurus itself serves, which is the same answer a
    // link inside a document gets.
    if (!target.startsWith('/')) return target;
    return config.unpublishedLinks === 'drop' ? '' : `${siteUrl}${target}`;
  };

  const convert = (item: NavbarItem): HeaderLink => ({
    label: item.label,
    href: retarget(item.href),
    ...(item.items ? { items: item.items.map(convert) } : {}),
  });

  return {
    title: navbar.title,
    href: href(''),
    items: navbar.items.map((item) => ({ ...convert(item), position: item.position })),
  };
}

/** Render one page, body and all. */
function renderPageFor(input: {
  emitMarkdown: boolean;
  node: PageNode;
  tree: PageTree;
  config: ResolvedConfig;
  model: SiteModel;
  version: DocsVersion;
  theme: Theme;
  href: (treePath: string) => string;
  navRootId: number | null;
  admonitionKeywords: string[];
  media: Map<string, { id: number; url: string }>;
  issues: IssueCollector;
  banner?: string;
}): { page: RenderedPage; markdown: string | undefined } {
  const { node, tree, config, model, theme, issues } = input;
  const doc = node.doc;

  let body = '';
  let links = new Set<string>();
  let firstParagraph = '';
  let llmsMarkdown: string | undefined;

  if (doc) {
    const markdown = readDocument(doc, issues);
    if (markdown !== undefined) {
      const rendered = renderDoc({
        markdown,
        file: doc.sourceRelativePath,
        permalink: doc.permalink,
        format: doc.format,
        theme,
        admonitionKeywords: input.admonitionKeywords,
        maintainCase: model.maintainCase,
        dedupeTitle: config.dedupeTitle,
        onUnknownJsx: config.mdxOnUnknown,
        media: input.media,
        issues,
        resolveLink: makeLinkResolver(doc, tree, config, model, input.href),
        emitMarkdown: input.emitMarkdown,
      });
      body = rendered.body;
      links = rendered.links;
      firstParagraph = rendered.firstParagraph;
      llmsMarkdown = rendered.markdown;
    }
  }

  const header = headerFor(model.navbar, tree, input.href, config, model);

  const content = composePage({
    node,
    body,
    links,
    href: input.href,
    lookup: (treePath) => tree.byPath.get(treePath),
    theme,
    layout: config.layout satisfies PageLayout,
    ...(header ? { header } : {}),
    navRootId: input.navRootId,
    ...(input.banner ? { banner: input.banner } : {}),
  });

  const excerpt = excerptFor(doc?.description ?? '', firstParagraph, config.excerptLength);
  const meta: Record<string, string> = {};
  if (config.metaDescriptionKey && excerpt) meta[config.metaDescriptionKey] = excerpt;

  return {
    page: {
      path: node.path,
      slug: node.slug,
      title: node.title,
      content,
      excerpt,
      menuOrder: config.menuOrder === 'none' ? 0 : node.menuOrder,
      meta,
      ...(doc?.date ? { date: doc.date } : {}),
      ...(doc?.tags?.length ? { tags: doc.tags.map((tag) => tag.label) } : {}),
      file: doc?.sourceRelativePath,
      versionName: node.versionName,
    },
    markdown: llmsMarkdown,
  };
}

/** Read a document's source, reporting rather than throwing when it is gone. */
function readDocument(doc: Doc, issues: IssueCollector): string | undefined {
  try {
    return readFileSync(doc.sourceAbsolutePath, 'utf8');
  } catch (error) {
    issues.addFor(doc, {
      code: 'source-unreadable',
      severity: 'error',
      message: `Could not read ${doc.sourceRelativePath}: ${(error as Error).message}`,
    });
    return undefined;
  }
}

/** Decide where each link in a document should point. */
function makeLinkResolver(
  doc: Doc,
  tree: PageTree,
  config: ResolvedConfig,
  model: SiteModel,
  href: (treePath: string) => string,
): LinkResolver {
  const siteUrl = (config.siteUrl || model.url).replace(/\/+$/, '');
  const baseUrl = model.baseUrl.replace(/\/+$/, '');

  /**
   * A root-relative markdown link is relative to the site, not to the server.
   * Docusaurus's router prepends the base URL, so a link written as
   * `/docs/api/` on a site served from `/project/` really means
   * `/project/docs/api/`.
   */
  const withBaseUrl = (urlPath: string): string =>
    !baseUrl || urlPath === baseUrl || urlPath.startsWith(`${baseUrl}/`)
      ? urlPath
      : `${baseUrl}${urlPath}`;

  return (rawHref: string): ReturnType<LinkResolver> => {
    if (!rawHref || rawHref.startsWith('#')) return { href: rawHref };
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawHref) || rawHref.startsWith('//')) {
      return { href: rawHref };
    }

    const hashIndex = rawHref.indexOf('#');
    const hash = hashIndex === -1 ? '' : rawHref.slice(hashIndex);
    const target = hashIndex === -1 ? rawHref : rawHref.slice(0, hashIndex);

    const node = target.startsWith('/')
      ? findByUrl(tree, withBaseUrl(target))
      : findBySourcePath(tree, doc, target);

    if (node) return { href: `${href(node.path)}${hash}`, path: node.path };
    if (config.unpublishedLinks === 'drop') return { href: null };

    // Nothing here publishes it, so point at the documentation site, using the
    // URL Docusaurus itself would serve.
    const urlPath = target.startsWith('/')
      ? withBaseUrl(path.posix.normalize(target))
      : path.posix.normalize(path.posix.join(doc.permalink, '..', target.replace(/\.mdx?$/, '')));
    return { href: `${siteUrl}${urlPath}${hash}` };
  };
}

/** A page whose document is served at this URL. */
function findByUrl(tree: PageTree, target: string): PageNode | undefined {
  const urlPath = path.posix.normalize(target).replace(/\.mdx?$/, '');
  return tree.byPermalink.get(urlPath) ?? tree.byPermalink.get(`${urlPath}/`);
}

/**
 * A page whose source file a relative link points at.
 *
 * Relative links are resolved against the file, which is how Docusaurus
 * resolves them. Resolving against the URL instead would break every document
 * whose front matter gives it a slug of its own.
 */
function findBySourcePath(tree: PageTree, from: Doc, target: string): PageNode | undefined {
  const base = path.posix.dirname(from.sourceRelativePath);
  const resolved = path.posix.normalize(path.posix.join(base, target));
  const withoutExtension = resolved.replace(/\.mdx?$/, '');

  const candidates = [
    resolved,
    `${withoutExtension}.md`,
    `${withoutExtension}.mdx`,
    `${withoutExtension}/index.md`,
    `${withoutExtension}/index.mdx`,
    `${withoutExtension}/README.md`,
  ];
  for (const candidate of candidates) {
    const node = tree.bySourcePath.get(candidate);
    if (node) return node;
  }
  return undefined;
}

/** Resolve, upload and record every file the documents reference. */
async function syncMedia(input: {
  config: ResolvedConfig;
  model: SiteModel;
  version: DocsVersion;
  tree: PageTree;
  session: TargetSession | undefined;
  issues: IssueCollector;
}): Promise<{
  byUrl: Map<string, { id: number; url: string }>;
  records: Artifacts['media'];
  actions: Action[];
  pending: number;
}> {
  const { config, model, version, tree, session, issues } = input;
  const byUrl = new Map<string, { id: number; url: string }>();
  const records: Artifacts['media'] = [];
  const actions: Action[] = [];
  let pending = 0;

  const remote: Map<string, MediaRef> = session ? await session.loadMediaIndex() : new Map();
  const uploadedThisRun = new Map<string, MediaRef>();

  for (const node of [tree.root, ...tree.chain]) {
    const doc = node.doc;
    if (!doc) continue;

    let markdown: string;
    try {
      markdown = await fs.readFile(doc.sourceAbsolutePath, 'utf8');
    } catch {
      continue;
    }

    for (const image of collectImages(markdown, doc.format)) {
      if (byUrl.has(image.url)) continue;

      const resolved = resolveImage(image.url, {
        sourceAbsolutePath: doc.sourceAbsolutePath,
        contentPath: version.contentPath,
        contentPathLocalized: version.contentPathLocalized,
        staticDirs: model.staticDirs,
        baseUrl: model.baseUrl,
        siteDir: model.siteDir,
      });

      if (resolved.kind === 'external') continue;

      if (resolved.kind === 'missing') {
        if (config.mediaOnMissing !== 'ignore') {
          issues.addFor(doc, {
            code: 'asset-missing',
            severity: config.mediaOnMissing,
            message: `The file "${image.url}" was not found, so the reference was left as written.`,
          });
        }
        continue;
      }

      const bytes = await fs.readFile(resolved.file);
      const hash = contentHash(bytes);
      const known = uploadedThisRun.get(hash) ?? remote.get(hash);

      if (known) {
        byUrl.set(image.url, { id: known.id, url: known.url });
        records.push({ hash, file: resolved.file, url: known.url, uploaded: false });
        actions.push({ op: 'reuse-media', path: node.path, id: known.id, file: resolved.file });
        continue;
      }

      if (!session || config.dryRun) {
        pending += 1;
        records.push({ hash, file: resolved.file, url: null, uploaded: false });
        actions.push({ op: 'upload-media', path: node.path, id: null, file: resolved.file });
        continue;
      }

      const filename = path.basename(resolved.file);
      const mime = mimeTypeFor(filename);
      if (!mime) {
        issues.addFor(doc, {
          code: 'asset-unknown-type',
          severity: 'warning',
          message: `Not uploading "${image.url}": its file type is not one WordPress accepts.`,
        });
        continue;
      }

      const uploaded = await session.uploadMedia({
        bytes,
        filename,
        hash,
        mime,
        alt: image.alt,
        title: image.title ?? titleCase(path.parse(filename).name),
      });
      uploadedThisRun.set(hash, uploaded);
      byUrl.set(image.url, { id: uploaded.id, url: uploaded.url });
      records.push({ hash, file: resolved.file, url: uploaded.url, uploaded: true });
      actions.push({ op: 'upload-media', path: node.path, id: uploaded.id, file: resolved.file });
    }
  }

  return { byUrl, records, actions, pending };
}

/** Issues, for callers that want them without the plan. */
export type { Issue };
