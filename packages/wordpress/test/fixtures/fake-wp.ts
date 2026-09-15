/**
 * An in-memory stand-in for the WordPress REST API.
 *
 * It implements only the routes the client calls, but it implements them the
 * way WordPress does: trashing rather than deleting, deriving a media slug
 * from the filename on create, and honouring the method-override header.
 */

/** A page as the fake holds it. */
export interface FakePage {
  id: number;
  parent: number;
  slug: string;
  status: string;
  link: string;
  title: { raw: string; rendered: string };
  content: { raw: string };
  excerpt: { raw: string };
  menu_order: number;
  template: string;
  meta: Record<string, unknown>;
  date_gmt: string;
  /** Term ids, under a field named after the taxonomy. */
  [taxonomy: string]: unknown;
}

/** A taxonomy term as the fake holds it. */
export interface FakeTerm {
  id: number;
  name: string;
  slug: string;
  /** 0 for a term with no parent; only categories nest. */
  parent?: number;
  /** Which taxonomy it belongs to. Defaults to whichever one was configured. */
  taxonomy?: string;
}

/** A media item as the fake holds it. */
export interface FakeMedia {
  id: number;
  slug: string;
  source_url: string;
  mime_type: string;
  title?: string;
  alt_text?: string;
}

/** A failure to inject on the next matching request. */
export interface FakeFailure {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

/** One request the fake saw. */
export interface FakeCall {
  method: string;
  routedAs: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown>;
  form: boolean;
}

/** What the fake exposes to a test. */
export interface FakeWp {
  fetch: typeof globalThis.fetch;
  /** The collection pages are served from. */
  restBase: string;
  pages: FakePage[];
  media: FakeMedia[];
  /** Terms of the configured taxonomy, if one was named. */
  terms: FakeTerm[];
  calls: FakeCall[];
  /** Pages that were written to, by id, for asserting what was left alone. */
  writes: number[];
}

/** Create a page in the shape the fake stores. */
export function makePage(page: Partial<FakePage> & { id: number; slug: string }): FakePage {
  return {
    parent: 0,
    status: 'publish',
    link: `https://example.test/${page.slug}/`,
    content: { raw: '' },
    excerpt: { raw: '' },
    menu_order: 0,
    template: '',
    meta: {},
    date_gmt: '2020-01-01T00:00:00',
    ...page,
    title:
      page.title ??
      ({ raw: page.slug, rendered: page.slug } as FakePage['title']),
  };
}

/**
 * Build the fake.
 *
 * @param options Pages and media to start with, and failures to inject.
 */
export function createFakeWp(
  options: {
    pages?: (Partial<FakePage> & { id: number; slug: string })[];
    media?: FakeMedia[];
    failures?: Map<string, FakeFailure[]>;
    /** The collection pages are served from, for a custom post type. */
    restBase?: string;
    /** The tag taxonomy to serve, and the terms it starts with. */
    taxonomy?: string;
    terms?: FakeTerm[];
  } = {},
): FakeWp {
  const restBase = options.restBase ?? 'pages';
  const taxonomy = options.taxonomy ?? '';
  // Categories are always served: a post is filed under one whether or not
  // the run publishes tags.
  const taxonomies = [taxonomy, 'categories'].filter(Boolean);
  const terms: FakeTerm[] = (options.terms ?? []).map((term) => ({
    parent: 0,
    taxonomy: taxonomy || 'categories',
    ...term,
  }));
  const collection = `/${restBase}`;
  const singular = new RegExp(`^/${restBase}/(\\d+)$`);
  let nextId = 1000;
  const pages: FakePage[] = (options.pages ?? []).map(makePage);
  const media: FakeMedia[] = [...(options.media ?? [])];
  const calls: FakeCall[] = [];
  const writes: number[] = [];
  const failures = options.failures ?? new Map<string, FakeFailure[]>();

  const json = (data: unknown, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'content-type': 'application/json', ...headers },
    });

  /**
   * WordPress keeps whole seconds and drops the zone marker.
   *
   * `date_gmt` is UTC by definition, so an unmarked value is read as UTC and
   * not as whatever the machine running this happens to be.
   */
  const storedDate = (value: unknown): string => {
    const text = String(value).trim();
    const utc = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`;
    return new Date(utc).toISOString().slice(0, 19);
  };

  /** A post dated ahead of now is scheduled, however it was asked for. */
  const statusFor = (asked: string, date: string): string =>
    asked === 'publish' && Date.parse(`${date}Z`) > Date.now() ? 'future' : asked;

  const notFound = (): Response =>
    new Response('{"code":"rest_post_invalid_id"}', {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });

  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const sent = String(init.method ?? 'GET').toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    // WordPress routes an overridden request to the method the header names.
    const routedAs = (headers['X-HTTP-Method-Override'] ?? '').toUpperCase() || sent;
    const path = url.pathname.replace('/wp-json/wp/v2', '');
    const query = Object.fromEntries(url.searchParams.entries());

    const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
    let body: Record<string, unknown> = {};
    if (!isForm && typeof init.body === 'string') body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ method: sent, routedAs, path, query, body, form: isForm });

    const queued = failures.get(`${routedAs} ${path}`);
    if (queued && queued.length > 0) {
      const failure = queued.shift()!;
      return new Response(failure.body ?? '{"code":"boom","message":"boom"}', {
        status: failure.status,
        headers: { 'content-type': 'application/json', ...(failure.headers ?? {}) },
      });
    }

    const pageId = singular.exec(path);
    const mediaId = /^\/media\/(\d+)$/.exec(path);

    const termRoute = taxonomies.find((name) => path === `/${name}`);
    if (termRoute) {
      const mine = terms.filter((term) => term.taxonomy === termRoute);
      if (routedAs === 'GET') {
        return json(mine, { 'x-wp-totalpages': '1', 'x-wp-total': String(mine.length) });
      }
      if (routedAs === 'POST') {
        const name = String(body['name'] ?? '');
        const created: FakeTerm = {
          id: (nextId += 1),
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          parent: Number(body['parent'] ?? 0),
          taxonomy: termRoute,
        };
        terms.push(created);
        return json(created);
      }
    }

    if (routedAs === 'GET' && path === collection) {
      let found = pages.filter((page) => page.status !== 'trash' || query['status'] === 'any');
      if (query['parent'] !== undefined) found = found.filter((p) => p.parent === Number(query['parent']));
      if (query['slug'] !== undefined) found = found.filter((p) => p.slug === query['slug']);
      const perPage = Number(query['per_page'] ?? 10);
      const page = Number(query['page'] ?? 1);
      return json(found.slice((page - 1) * perPage, page * perPage), {
        'x-wp-totalpages': String(Math.max(1, Math.ceil(found.length / perPage))),
        'x-wp-total': String(found.length),
      });
    }

    if (routedAs === 'GET' && pageId) {
      const page = pages.find((p) => p.id === Number(pageId[1]));
      return page ? json(page) : notFound();
    }

    if (routedAs === 'POST' && path === collection) {
      const requested = String(body['slug'] ?? '');
      // WordPress appends a suffix when the slug is already taken.
      const taken = pages.some((p) => p.parent === Number(body['parent'] ?? 0) && p.slug === requested);
      const date = body['date_gmt'] !== undefined ? storedDate(body['date_gmt']) : '2020-01-01T00:00:00';
      const created = makePage({
        id: (nextId += 1),
        parent: Number(body['parent'] ?? 0),
        slug: taken ? `${requested}-2` : requested,
        date_gmt: date,
        status: statusFor(String(body['status'] ?? 'publish'), date),
        title: { raw: String(body['title'] ?? ''), rendered: String(body['title'] ?? '') },
        content: { raw: String(body['content'] ?? '') },
        excerpt: { raw: String(body['excerpt'] ?? '') },
        menu_order: Number(body['menu_order'] ?? 0),
        template: String(body['template'] ?? ''),
        meta: (body['meta'] as Record<string, unknown>) ?? {},
        ...(taxonomy ? { [taxonomy]: (body[taxonomy] as number[]) ?? [] } : {}),
        categories: (body['categories'] as number[]) ?? [],
      });
      pages.push(created);
      return json(created);
    }

    if (routedAs === 'POST' && pageId) {
      const page = pages.find((p) => p.id === Number(pageId[1]));
      if (!page) return notFound();
      writes.push(page.id);
      if (body['title'] !== undefined) {
        page.title = { raw: String(body['title']), rendered: String(body['title']) };
      }
      if (body['content'] !== undefined) page.content = { raw: String(body['content']) };
      if (body['excerpt'] !== undefined) page.excerpt = { raw: String(body['excerpt']) };
      if (body['parent'] !== undefined) page.parent = Number(body['parent']);
      if (body['slug'] !== undefined) page.slug = String(body['slug']);
      if (body['menu_order'] !== undefined) page.menu_order = Number(body['menu_order']);
      if (body['template'] !== undefined) page.template = String(body['template']);
      if (body['date_gmt'] !== undefined) page.date_gmt = storedDate(body['date_gmt']);
      // After the date, which is what decides whether it can be published.
      if (body['status'] !== undefined) page.status = statusFor(String(body['status']), page.date_gmt);
      if (body['meta'] !== undefined) {
        page.meta = { ...page.meta, ...(body['meta'] as Record<string, unknown>) };
      }
      if (taxonomy && body[taxonomy] !== undefined) page[taxonomy] = body[taxonomy] as number[];
      if (body['categories'] !== undefined) page['categories'] = body['categories'] as number[];
      return json(page);
    }

    if (routedAs === 'DELETE' && pageId) {
      const page = pages.find((p) => p.id === Number(pageId[1]));
      if (!page) return notFound();
      page.status = 'trash';
      return json({ deleted: true, previous: page });
    }

    if (routedAs === 'GET' && path === '/media') {
      const search = query['search'] ?? '';
      const found = media.filter((item) => item.slug.includes(search));
      return json(found, { 'x-wp-totalpages': '1', 'x-wp-total': String(found.length) });
    }

    if (routedAs === 'POST' && path === '/media') {
      const form = init.body as FormData;
      const file = form.get('file') as File | null;
      const name = file?.name ?? 'upload';
      const created: FakeMedia = {
        id: (nextId += 1),
        // WordPress derives the slug from the filename on create.
        slug: name.replace(/\.[^.]+$/, '').toLowerCase(),
        source_url: `https://example.test/uploads/${name}`,
        mime_type: file?.type ?? 'application/octet-stream',
      };
      media.push(created);
      return json(created);
    }

    if (routedAs === 'POST' && mediaId) {
      const item = media.find((m) => m.id === Number(mediaId[1]));
      if (!item) return notFound();
      if (body['slug'] !== undefined) item.slug = String(body['slug']);
      if (body['title'] !== undefined) item.title = String(body['title']);
      if (body['alt_text'] !== undefined) item.alt_text = String(body['alt_text']);
      return json(item);
    }

    return new Response('{"code":"rest_no_route"}', {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };

  return { fetch, restBase, pages, media, terms, calls, writes };
}
