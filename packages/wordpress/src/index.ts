/** The WordPress target. */

import { renderNavigationStub } from '@pterodocs/core/render';
import {
  OWNERSHIP_META,
  OWNERSHIP_VALUE,
} from '@pterodocs/core/target';
import type {
  EnsureRequest,
  EnsureResult,
  MediaRef,
  MediaUpload,
  RemotePage,
  RenderedPage,
  Target,
  TargetCapabilities,
  TargetSession,
} from '@pterodocs/core/target';
import { TargetError, titleCase } from '@pterodocs/core/util';
import { DEFAULT_RETRY, WpClient, type RetryPolicy } from './client';
import { loadMediaIndex, uploadMedia } from './media';
import { loadTermIndex, type TermIndex } from './terms';
import {
  computePrune,
  createPostsApi,
  diffPage,
  toInstant,
  toWpDate,
  type PageInput,
} from './pages';
import { hrefFor, splitOwnership, type WordpressUrlPolicy } from './url';
import { verifyResolution, type Resolution } from './resolve';

/** What WordPress can do. */
export const WORDPRESS_CAPABILITIES: TargetCapabilities = {
  // The navigation block lists children of a page id, so ids must exist first.
  needsIdsBeforeRender: true,
  supportsMedia: true,
  supportsPrune: true,
  supportsHierarchy: true,
  supportsExcerpt: true,
  supportsMeta: true,
  supportsTemplates: true,
  supportsDrafts: true,
  publishesTreeRoot: true,
  predictableUrls: true,
};

/** Content a page holds between being created and being rendered. */
const PLACEHOLDER = '<!-- wp:paragraph -->\n<p>Publishing…</p>\n<!-- /wp:paragraph -->';

/** How to reach and shape a WordPress site. */
export interface WordpressTargetOptions {
  /** Site origin. */
  url: string;
  /** Username of the Application Password. */
  user: string;
  /** The Application Password. */
  appPassword: string;
  /** Where the tree hangs and how versions and locales are addressed. */
  policy: WordpressUrlPolicy;
  /** Status applied to every synced page. */
  status: 'publish' | 'draft' | 'private';
  /** Page template slug, or empty for the theme default. */
  template: string;
  /** Polylang language code. */
  lang: string;
  /** Prefix of the slug that identifies uploaded media. */
  mediaSlugPrefix: string;
  /**
   * The REST collection the tree is published into.
   *
   * `pages` unless a post type registered by the plugin is being published,
   * in which case it is that type's own `rest_base`.
   */
  restBase: string;
  /**
   * The shape the tree is published in.
   *
   * `tree` is the documentation case: pages nest, the last segment of the path
   * is a page pterodocs writes, and anything above it is created once as a
   * stub.
   *
   * `flat` is the post case: posts do not nest, there is no root, nothing
   * above them is created, and their URLs come from the site's own permalink
   * settings rather than from the path. They are recognised later by the
   * metadata marker rather than by where they sit.
   */
  ownership: 'tree' | 'flat';
  /**
   * Category the posts are filed under, outermost first.
   *
   * Created if missing. Empty files nothing, which is what a documentation run
   * wants.
   */
  categoryPath: string[];
  /**
   * Taxonomy carrying a post's tags, or empty for none.
   *
   * Its REST base, which the plugin registers as the taxonomy's own name.
   */
  taxonomy: string;
  /** Send DELETE as POST with an override header. */
  methodOverride: boolean;
  /** Retry policy. */
  retry?: RetryPolicy;
}

/** Injected so the target can be exercised without a network. */
export interface WordpressTargetDeps {
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

/** Create the WordPress target. */
export function createWordpressTarget(
  options: WordpressTargetOptions,
  deps: WordpressTargetDeps = {},
): Target {
  const log = deps.log ?? ((): void => {});
  const flat = options.ownership === 'flat';

  // Posts have no path of pterodocs's choosing: nothing above them is a page,
  // and there is no page at the root either.
  const { stubSegments, rootSlug } = flat
    ? { stubSegments: [] as string[], rootSlug: '' }
    : splitOwnership(options.policy);

  // The documentation root has no path of its own in the tree, so its slug is
  // the last segment of the configured path rather than anything the model
  // supplied.
  const slugFor = (page: { path: string; slug: string }): string =>
    !flat && page.path === '' ? rootSlug : page.slug;

  const makeClient = (locale: string): WpClient =>
    new WpClient({
      baseUrl: options.url,
      user: options.user,
      appPassword: options.appPassword,
      // A site with one language per subtree wants each subtree tagged.
      lang: options.lang || (options.policy.primaryLocale && locale !== options.policy.primaryLocale ? locale : ''),
      methodOverride: options.methodOverride,
      retry: options.retry ?? DEFAULT_RETRY,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      log,
    });

  return {
    name: 'wordpress',
    capabilities: {
      ...WORDPRESS_CAPABILITIES,
      publishesTreeRoot: !flat,
      supportsHierarchy: !flat,
      predictableUrls: !flat,
    },
    rootPath: hrefFor(options.policy, '', { versionName: '', locale: options.policy.primaryLocale ?? '' }),

    hrefFor(treePath, context) {
      return hrefFor(options.policy, treePath, context);
    },

    async open(context): Promise<TargetSession> {
      const client = makeClient(context.locale);
      const posts = createPostsApi(client, options.restBase, { taxonomy: options.taxonomy, flat });
      const dryRun = context.dryRun;
      let index: RemotePage[] | undefined;
      let terms: TermIndex | undefined;
      let categoryId: number | undefined;
      let categoryLink: string | undefined;
      const categoryWarnings: string[] = [];
      let markerChecked = false;

      return {
        async loadIndex(): Promise<RemotePage[]> {
          index ??= await posts.fetchIndex();
          // Read here and not where it is wanted: `diffPage` is synchronous,
          // so by the time a post's tags are compared there is no opportunity
          // left to ask what each label is called numerically.
          if (options.taxonomy && !terms) {
            terms = await loadTermIndex(client, options.taxonomy, dryRun);
          }

          // Once for the whole run: every post is filed under the same one,
          // and walking the path is a request per level.
          //
          // A documentation run resolves it too, but must never create it: it
          // files nothing, and inventing categories on a site because its
          // config mentions a blog would be pterodocs changing a taxonomy
          // nobody asked it to touch. Lookup-only is what `dryRun` already
          // means to `ensurePath`.
          if (options.categoryPath.length > 0 && categoryId === undefined) {
            const categories = await loadTermIndex(client, 'categories', dryRun || !flat);
            const { id, link, warnings } = await categories.ensurePath(options.categoryPath);
            categoryId = id ?? 0;
            categoryLink = link;
            categoryWarnings.push(...warnings);
          }
          return index;
        },

        publishedIndex(): string | undefined {
          // Only for a flat tree. A documentation tree is at its own path,
          // which says where it is perfectly well.
          return flat ? categoryLink : undefined;
        },

        blogIndex(): string | undefined {
          // The same archive, asked for by a run that is not publishing into
          // it -- the documentation, wanting somewhere to point its header.
          return categoryLink;
        },

        async ensureRootParent(): Promise<{
          id: number | null;
          created: { path: string; id: number | null }[];
        }> {
          const created: { path: string; id: number | null }[] = [];
          let parentId: number | null = 0;

          // Nothing to walk: a post is not under anything.
          if (flat) return { id: 0, created };

          for (const slug of stubSegments) {
            if (parentId === null) {
              created.push({ path: `/${slug}/`, id: null });
              continue;
            }
            const existing = await posts.find(parentId, slug, index, log);
            if (existing) {
              if (existing.status === 'trash') {
                throw new TargetError(
                  `The page "/${slug}/" is in the trash. Restore it, or delete it permanently, and run again.`,
                  { status: 409, method: 'GET', url: `/pages?slug=${slug}` },
                );
              }
              parentId = existing.id;
              continue;
            }
            if (dryRun) {
              created.push({ path: `/${slug}/`, id: null });
              parentId = null;
              continue;
            }
            // A page created only so the documentation has a parent: it lists
            // what is below it and claims nothing else.
            const page = await posts.create({
              title: titleCase(slug),
              slug,
              parent: parentId,
              status: 'publish',
              content: PLACEHOLDER,
            });
            await posts.update(page.id, { content: renderNavigationStub(page.id) });
            created.push({ path: `/${slug}/`, id: page.id });
            parentId = page.id;
          }
          return { id: parentId, created };
        },

        async ensurePage(request: EnsureRequest): Promise<EnsureResult> {
          const warnings: string[] = [];
          if (request.parentId === null) return { id: null, created: true, warnings };

          const slug = request.isRoot ? rootSlug : request.slug;
          const existing = await posts.find(request.parentId, slug, index, log);
          if (existing) {
            if (existing.status === 'trash') {
              warnings.push(
                `${request.path || '(root)'} matches a page in the trash. It will be republished; restore or delete it permanently if that is not what you want.`,
              );
            }
            return { id: existing.id, created: false, warnings, link: existing.link };
          }
          if (dryRun) return { id: null, created: true, warnings };

          // Created as a draft: a placeholder must never appear in navigation.
          const created = await posts.create({
            title: request.title,
            slug,
            // A post has neither; the fields are absent from its REST schema.
            ...(flat ? {} : { parent: request.parentId, menu_order: request.menuOrder }),
            status: 'draft',
            content: PLACEHOLDER,
          });
          return { id: created.id, created: true, warnings, link: created.link };
        },

        async fetchPage(id: number): Promise<RemotePage> {
          return posts.fetchOne(id);
        },

        diffPage(remote: RemotePage, rendered: RenderedPage, parentId: number): string[] {
          // Only the tags this site already has a term for. One it does not is
          // a difference by definition -- it cannot be on the post yet -- and
          // `writePage` is where it gets created.
          const known = rendered.tags && terms
            ? rendered.tags.map((label) => terms!.idFor(label)).filter((id): id is number => id !== undefined)
            : undefined;
          const tags = known && rendered.tags && known.length === rendered.tags.length ? known : undefined;

          return diffPage(remote, rendered, {
            parentId,
            status: options.status,
            template: options.template,
            isRoot: rendered.path === '',
            slug: slugFor(rendered),
            hierarchical: !flat,
            ...(tags ? { tags } : {}),
          });
        },

        async writePage(id, page, parentId): Promise<{ warnings: string[] }> {
          const warnings: string[] = [];
          const body: PageInput = {
            title: page.title,
            content: page.content,
            excerpt: page.excerpt,
            slug: slugFor(page),
            status: options.status,
            template: options.template,
            // Neither field exists on a post, and a post is never nested.
            ...(flat ? {} : { parent: parentId, menu_order: page.menuOrder }),
          };

          // Only a post has categories. A page would silently drop the field,
          // and asking it to is how a docs run would end up filing pages.
          if (flat && categoryId) body.categories = [categoryId];
          warnings.push(...categoryWarnings.splice(0));
          const meta: Record<string, unknown> = { ...page.meta };

          // A post type registers this key, so it can be written; `pages` does
          // not, and WordPress silently drops meta it does not know. Sending it
          // where it cannot be stored would achieve nothing and risk a 400 on
          // a site that is strict about unregistered keys.
          if (flat) meta[OWNERSHIP_META] = OWNERSHIP_VALUE;
          if (Object.keys(meta).length > 0) body.meta = meta;

          if (page.tags && terms) {
            const { ids, warnings: refused } = await terms.ensure(page.tags);
            warnings.push(...refused);
            body[options.taxonomy] = ids;
          }

          if (page.date) {
            const when = toWpDate(page.date);
            if (when) body.date_gmt = when;

            // WordPress will not publish something dated ahead of now; it
            // holds it as `future` and publishes it when the date arrives.
            // That is the right behaviour and not an error, but it is not what
            // "published" usually means, so it is said out loud once.
            const instant = toInstant(page.date);
            if (options.status === 'publish' && instant !== undefined && instant > Date.now()) {
              warnings.push(
                `${page.path || '(root)'} is dated ${page.date}, which is in the future, so WordPress will hold it until then rather than publishing it now.`,
              );
            }
          }

          try {
            const written = await posts.update(id, body);

            // WordPress does not reject metadata it has no registration for --
            // it ignores it. So a site without the plugin publishes perfectly
            // well and stores no marker, and nothing would notice until a
            // prune failed to recognise its own posts and left them standing.
            if (flat && !markerChecked) {
              markerChecked = true;
              if (written.meta?.[OWNERSHIP_META] !== OWNERSHIP_VALUE) {
                warnings.push(
                  'WordPress stored no ownership marker on the post, so pterodocs will not recognise what it published here later: prune and purge will leave these posts standing. The pterodocs plugin registers the key, so this usually means it is not installed, not active, or older than 0.5.0.',
                );
              }
            }
          } catch (error) {
            // A locked-down site may reject the metadata or the template. The
            // page itself matters more than either, so try again without them.
            const status = (error as { status?: number }).status;
            if (status === 400 && (body.meta || body.template)) {
              delete body.template;
              // Everything but the ownership marker, which is not decoration:
              // without it nothing can tell later that pterodocs wrote this,
              // and prune and purge would leave it standing forever. Its own
              // post type registers the key, so if this is refused too the
              // problem is not the key and the error is worth raising.
              if (flat) body.meta = { [OWNERSHIP_META]: OWNERSHIP_VALUE };
              else delete body.meta;

              warnings.push(
                `${page.path || '(root)'}: WordPress refused the template or the metadata, so the page was published without them.`,
              );
              await posts.update(id, body);
            } else throw error;
          }
          return { warnings };
        },

        async writeMeta(id, meta): Promise<{ warnings: string[] }> {
          if (Object.keys(meta).length === 0) return { warnings: [] };
          if (dryRun) return { warnings: [] };

          try {
            await posts.update(id, { meta });
          } catch (error) {
            // Every key here is registered by the pterodocs plugin, so the
            // usual reason to be refused is that it is not installed. That is
            // a fact about the site, not a failure of the publish.
            const status = (error as { status?: number }).status;
            if (status === 400 || status === 403) {
              return {
                warnings: [
                  'WordPress refused the llms.txt metadata. The pterodocs plugin registers it, so this usually means it is not installed or not active.',
                ],
              };
            }
            throw error;
          }

          return { warnings: [] };
        },

        async verifyResolution(id, url): Promise<Resolution> {
          // A page nobody can see yet cannot be checked from the outside, and a
          // dry run has written nothing to check.
          if (dryRun || options.status !== 'publish') return { verdict: 'unknown' };

          return verifyResolution(id, url, deps);
        },

        computePrune(pages, rootId, keepIds): RemotePage[] {
          // A flat collection is every post on the site, most of them written
          // by people rather than by pterodocs. The reconciler checks each
          // candidate's ownership before trashing it, but that is a request
          // each -- so the ones that plainly are not ours never get that far.
          const candidates = flat
            ? pages.filter((page) => page.meta?.[OWNERSHIP_META] === OWNERSHIP_VALUE)
            : pages;

          return computePrune(candidates, rootId, keepIds);
        },

        async removePage(page: RemotePage): Promise<void> {
          await posts.trash(page.id);
        },

        async loadMediaIndex(): Promise<Map<string, MediaRef>> {
          return loadMediaIndex(client, options.mediaSlugPrefix);
        },

        async uploadMedia(upload: MediaUpload): Promise<MediaRef> {
          return uploadMedia(client, upload, options.mediaSlugPrefix);
        },

        requestCount(): number {
          return client.requestCount;
        },
      };
    },
  };
}

export { splitOwnership, hrefFor, prefixSegments } from './url';
export type { WordpressUrlPolicy } from './url';
export { WpClient, DEFAULT_RETRY } from './client';
export { detectPlugin } from './plugin';
export type { PluginStatus } from './plugin';
export type { RetryPolicy, WpClientOptions } from './client';
export { renderNavigationStub };
export { PLACEHOLDER };
