/**
 * WordPress posts: finding them, comparing them, writing them, removing them.
 *
 * A post's identity is its parent and its slug, which is what makes a re-run
 * rewrite only what actually differs.
 *
 * Every route here is built from a REST base rather than written out, because
 * a page and a release note are the same thing to everything above this file —
 * only the route differs. The base belongs here and not on `WpClient`: the
 * client is shared with `/media` and `/settings`, which have bases of their own.
 */

import { TargetError } from '@pterodocs/core/util';
import type { RemotePage, RenderedPage } from '@pterodocs/core/target';
import { FULL_PAGE_FIELDS, PAGE_FIELDS, withTaxonomy, type WpClient } from './client';

/** WordPress's own post shape, narrowed to what is read. */
interface WpPage {
  id: number;
  parent: number;
  slug: string;
  status: string;
  link: string;
  title?: { raw?: string; rendered?: string };
  content?: { raw?: string };
  excerpt?: { raw?: string };
  menu_order: number;
  template: string;
  meta?: Record<string, unknown>;
  date_gmt?: string | null;
  /** Term ids, under a field named after the taxonomy. */
  [taxonomy: string]: unknown;
}

/**
 * Read a WordPress date as an instant.
 *
 * WordPress returns `date_gmt` with no zone marker -- it is UTC by definition,
 * and `Date.parse` would otherwise read it as local time. It also stores whole
 * seconds, so anything finer is dropped before comparing: keeping it would
 * make a post with milliseconds in its front matter differ on every run.
 */
export function toInstant(value: unknown): number | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const utc = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`;
  const ms = Date.parse(utc);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000) * 1000;
}

/**
 * Write a date the way WordPress stores it.
 *
 * Whole seconds and no zone suffix, which is what comes back -- so the value
 * sent and the value read compare equal without either end normalising.
 */
export function toWpDate(iso: string): string | undefined {
  const ms = toInstant(iso);
  return ms === undefined ? undefined : new Date(ms).toISOString().slice(0, 19);
}

/** Convert a WordPress post into the shape the reconciler compares. */
export function toRemotePage(page: WpPage): RemotePage {
  return {
    id: page.id,
    parent: page.parent,
    slug: page.slug,
    status: page.status,
    link: page.link,
    title: page.title?.raw ?? page.title?.rendered ?? '',
    ...(page.content?.raw !== undefined ? { content: page.content.raw } : {}),
    ...(page.excerpt?.raw !== undefined ? { excerpt: page.excerpt.raw } : {}),
    menuOrder: page.menu_order,
    template: page.template,
    meta: page.meta,
    ...(page.date_gmt ? { date: page.date_gmt } : {}),
  };
}

/** Body sent when creating or updating a post. */
export interface PageInput {
  title?: string;
  content?: string;
  excerpt?: string;
  parent?: number;
  slug?: string;
  status?: string;
  menu_order?: number;
  template?: string;
  meta?: Record<string, unknown>;
  /** Publication instant in UTC. Never `date`, which is the site's timezone. */
  date_gmt?: string;
  /** Term ids, under a field named after the taxonomy. */
  [taxonomy: string]: unknown;
}

/** The six things a sync does to a post type, bound to one REST base. */
export interface PostsApi {
  /** The REST base these routes are built from. */
  readonly restBase: string;
  /** Fetch every post of this type on the site. */
  fetchIndex(): Promise<RemotePage[]>;
  /** Fetch one post with the fields needed to compare it. */
  fetchOne(id: number): Promise<RemotePage>;
  /** Find a post by its position in the tree. */
  find(
    parent: number,
    slug: string,
    index?: RemotePage[],
    log?: (message: string) => void,
  ): Promise<RemotePage | undefined>;
  /** Create a post, checking that WordPress honoured the slug we asked for. */
  create(input: PageInput): Promise<RemotePage>;
  /** Update a post. */
  update(id: number, input: PageInput): Promise<RemotePage>;
  /**
   * Move a post to the trash.
   *
   * Never a permanent delete: recovering from a mistaken prune should not
   * require a database backup.
   */
  trash(id: number): Promise<void>;
}

/**
 * Bind the post routes to one REST base.
 *
 * @param client The site to talk to.
 * @param restBase The collection, without a slash: `pages`, or a post type's
 *   own `rest_base`.
 */
export function createPostsApi(client: WpClient, restBase: string, taxonomy = ''): PostsApi {
  const collection = `/${restBase}`;
  const one = (id: number): string => `${collection}/${id}`;
  const listFields = withTaxonomy(PAGE_FIELDS, taxonomy);
  const fullFields = withTaxonomy(FULL_PAGE_FIELDS, taxonomy);

  /** A post's own terms, when a taxonomy was named. */
  const tagsOf = (page: WpPage): number[] | undefined => {
    if (!taxonomy) return undefined;
    const value = page[taxonomy];
    return Array.isArray(value) ? value.map(Number) : [];
  };

  const convert = (page: WpPage): RemotePage => {
    const tags = tagsOf(page);
    return { ...toRemotePage(page), ...(tags ? { tags } : {}) };
  };

  return {
    restBase,

    async fetchIndex(): Promise<RemotePage[]> {
      const pages = await client.listAll<WpPage>(collection, {
        status: 'any',
        context: 'edit',
        _fields: listFields,
      });
      return pages.map(convert);
    },

    async fetchOne(id: number): Promise<RemotePage> {
      const { data } = await client.request<WpPage>('GET', one(id), {
        query: { context: 'edit', _fields: fullFields },
      });
      return convert(data);
    },

    async find(parent, slug, index, log = () => {}): Promise<RemotePage | undefined> {
      let candidates: RemotePage[];
      // The index is searched when one was supplied, because a whole-site index
      // is one request where per-page lookups are hundreds.
      if (index) {
        candidates = index.filter((page) => page.parent === parent && page.slug === slug);
      } else {
        const { data } = await client.request<WpPage[]>('GET', collection, {
          query: { parent, slug, status: 'any', context: 'edit', per_page: 100, _fields: listFields },
        });
        candidates = (Array.isArray(data) ? data : []).map(convert);
      }
      if (candidates.length > 1) {
        log(`${candidates.length} pages share parent ${parent} and slug "${slug}"; using id ${candidates[0]!.id}.`);
      }
      return candidates[0];
    },

    async create(input: PageInput): Promise<RemotePage> {
      const { data } = await client.request<WpPage>('POST', collection, { body: input });
      if (input.slug && data.slug !== input.slug) {
        throw new TargetError(
          `WordPress stored the new page as "${data.slug}" rather than "${input.slug}". Another page, possibly one in the trash, already holds that slug. The page it created is id ${data.id}.`,
          { status: 200, method: 'POST', url: collection },
        );
      }
      return convert(data);
    },

    async update(id: number, input: PageInput): Promise<RemotePage> {
      const { data } = await client.request<WpPage>('POST', one(id), { body: input });
      return convert(data);
    },

    async trash(id: number): Promise<void> {
      await client.request('DELETE', one(id));
    },
  };
}

/** Normalise a value for comparison, so whitespace alone is not a difference. */
const normalise = (value: unknown): string =>
  String(value ?? '').replace(/\r\n/g, '\n').trim();

/**
 * Which fields of an existing page differ from the rendered one.
 *
 * @param remote The page as WordPress holds it.
 * @param rendered The page as pterodocs would publish it.
 * @param context The expected parent, slug, status and template.
 */
export function diffPage(
  remote: RemotePage,
  rendered: RenderedPage,
  context: {
    parentId: number;
    status: string;
    template: string;
    isRoot: boolean;
    slug: string;
    /** Now, so a scheduled post can be recognised. Defaults to the clock. */
    now?: number;
    /**
     * The rendered page's tags as term ids, when this site has a taxonomy.
     *
     * Resolved by the caller, because the labels a document writes mean nothing
     * to WordPress and turning them into ids is a request -- which this cannot
     * make, being synchronous by design.
     */
    tags?: number[];
  },
): string[] {
  const changed: string[] = [];
  if (normalise(remote.title) !== normalise(rendered.title)) changed.push('title');
  if (normalise(remote.content) !== normalise(rendered.content)) changed.push('content');
  if (normalise(remote.excerpt) !== normalise(rendered.excerpt)) changed.push('excerpt');

  // Only where the rendered page has one: documentation never does, and a
  // remote date would otherwise make every page differ forever.
  const wanted = rendered.date ? toInstant(rendered.date) : undefined;
  if (wanted !== undefined && wanted !== toInstant(remote.date)) changed.push('date');

  // A post dated ahead of now cannot be published, whatever was asked for:
  // WordPress holds it as `future` until the date arrives. Reading that back
  // as a difference would rewrite the post on every run until then.
  const scheduled =
    remote.status === 'future' &&
    context.status === 'publish' &&
    wanted !== undefined &&
    wanted > (context.now ?? Date.now());
  if (!scheduled && remote.status !== context.status) changed.push('status');
  if (!context.isRoot && remote.menuOrder !== rendered.menuOrder) changed.push('menu_order');
  if ((remote.template ?? '') !== context.template) changed.push('template');
  if (remote.parent !== context.parentId) changed.push('parent');
  if (remote.slug !== context.slug) changed.push('slug');

  // Only where both ends have them: a page has no tags and a site with no
  // taxonomy returns no field, and neither is a difference.
  if (context.tags && remote.tags) {
    const want = [...context.tags].sort((a, b) => a - b).join(',');
    const have = [...remote.tags].sort((a, b) => a - b).join(',');
    if (want !== have) changed.push('tags');
  }

  // Metadata is only compared where the site actually exposes the field, so a
  // site without the SEO plugin does not report a difference on every run.
  for (const [key, value] of Object.entries(rendered.meta)) {
    if (remote.meta && key in remote.meta && normalise(remote.meta[key]) !== normalise(value)) {
      changed.push(`meta.${key}`);
    }
  }
  return changed;
}

/**
 * Pages below a root that no rendered page accounts for.
 *
 * Deepest first, so a parent is never trashed before its children.
 */
export function computePrune(
  index: RemotePage[],
  rootId: number,
  keepIds: Set<number>,
): RemotePage[] {
  const childrenOf = new Map<number, RemotePage[]>();
  for (const page of index) {
    const siblings = childrenOf.get(page.parent);
    if (siblings) siblings.push(page);
    else childrenOf.set(page.parent, [page]);
  }

  const owned: { page: RemotePage; depth: number }[] = [];
  const walk = (parentId: number, depth: number): void => {
    for (const page of childrenOf.get(parentId) ?? []) {
      owned.push({ page, depth });
      walk(page.id, depth + 1);
    }
  };
  walk(rootId, 0);

  return owned
    .filter(({ page }) => !keepIds.has(page.id))
    .sort((a, b) => b.depth - a.depth)
    .map(({ page }) => page);
}
