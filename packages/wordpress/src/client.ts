/**
 * A small WordPress REST client, scoped to what publishing needs.
 *
 * Authentication is an Application Password over HTTP Basic. `fetch` and the
 * clock are injectable so the whole sync can be tested without a network.
 */

import { TargetError, USER_AGENT } from '@pterodocs/core/util';

/**
 * Fields needed to compare a remote page with a rendered one.
 *
 * `date_gmt` and not `date`: the second is in the site's timezone, so two
 * sites in different places would disagree about the same instant.
 */
export const PAGE_FIELDS = 'id,parent,slug,status,link,title,menu_order,template,date_gmt';

/** Those, plus the content only fetched when a page is about to be compared. */
export const FULL_PAGE_FIELDS = `${PAGE_FIELDS},content,excerpt,meta`;

/**
 * The same, naming a taxonomy as well.
 *
 * A post's terms live under a field named after the taxonomy, so the list can
 * only be built once that is known -- which is why these are functions and the
 * two above are not.
 *
 * @param fields One of the two lists above.
 * @param taxonomy The taxonomy's name, or empty for none.
 */
export const withTaxonomy = (fields: string, taxonomy: string): string =>
  taxonomy ? `${fields},${taxonomy}` : fields;

/** How hard to try again when WordPress is busy. */
export interface RetryPolicy {
  /** Extra attempts after the first. */
  attempts: number;
  /** Delay before the first retry, doubling after that. */
  baseDelayMs: number;
  /** Longest delay to wait, however far the backoff has grown. */
  maxDelayMs: number;
}

/** The retry policy used when a site configures none. */
export const DEFAULT_RETRY: RetryPolicy = { attempts: 4, baseDelayMs: 1000, maxDelayMs: 30_000 };

/** What the client needs to reach a site. */
export interface WpClientOptions {
  /** Site origin, without a trailing slash. */
  baseUrl: string;
  /** WordPress username. */
  user?: string;
  /** An Application Password; display spaces are removed. */
  appPassword?: string;
  /** Polylang language code, sent as a `lang` parameter. */
  lang?: string;
  /** Send DELETE as POST with an override header, for hosts that block DELETE. */
  methodOverride?: boolean;
  /** How hard to retry. */
  retry?: RetryPolicy;
  /** Injected for tests. */
  fetch?: typeof globalThis.fetch;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Called with progress worth seeing under `--verbose`. */
  log?: (message: string) => void;
}

/** One request, before it is sent. */
interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** A multipart body, used for media uploads. */
  form?: FormData;
}

export class WpClient {
  private readonly baseUrl: string;
  private readonly user: string;
  private readonly appPassword: string;
  private readonly lang: string;
  private readonly methodOverride: boolean;
  private readonly retry: RetryPolicy;
  private readonly doFetch: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (message: string) => void;

  /** How many requests have been made, for the run summary. */
  requestCount = 0;

  constructor(options: WpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.user = options.user ?? '';
    this.appPassword = (options.appPassword ?? '').replace(/\s+/g, '');
    this.lang = options.lang ?? '';
    this.methodOverride = options.methodOverride === true;
    this.retry = options.retry ?? DEFAULT_RETRY;
    this.doFetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.log = options.log ?? ((): void => {});
  }

  /** Headers every request carries. */
  private headers(): Record<string, string> {
    const token = Buffer.from(`${this.user}:${this.appPassword}`, 'utf8').toString('base64');
    return {
      Authorization: `Basic ${token}`,
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    };
  }

  /**
   * Perform one REST call, retrying only what is worth retrying.
   */
  async request<T = unknown>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: RequestOptions = {},
  ): Promise<{ data: T; headers: Headers }> {
    const url = new URL(`${this.baseUrl}/wp-json/wp/v2${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    if (this.lang) url.searchParams.set('lang', this.lang);

    const headers = this.headers();
    const init: RequestInit = { method, headers, redirect: 'error' };
    if (options.form) {
      init.body = options.form;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    if (this.methodOverride && method === 'DELETE') {
      init.method = 'POST';
      headers['X-HTTP-Method-Override'] = 'DELETE';
    }

    let lastError: TargetError | undefined;
    let retryAfterMs: number | undefined;

    for (let attempt = 0; attempt <= this.retry.attempts; attempt += 1) {
      if (attempt > 0) {
        // Retry-After applies to the response that carried it, not to every
        // later attempt, so it is consumed rather than remembered.
        const backoff = Math.min(this.retry.baseDelayMs * 2 ** (attempt - 1), this.retry.maxDelayMs);
        const wait = retryAfterMs ?? backoff;
        retryAfterMs = undefined;
        this.log(`retry ${attempt}/${this.retry.attempts} in ${wait}ms: ${method} ${url.pathname}`);
        await this.sleep(wait);
      }

      this.requestCount += 1;
      let response: Response;
      try {
        response = await this.doFetch(url.href, init);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastError = new TargetError(
          /redirect/i.test(message)
            ? `${method} ${url.pathname} was redirected. Check that WP_URL matches the site exactly, including https and www.`
            : `${method} ${url.pathname} failed: ${message}`,
          { status: 0, method, url: url.href },
        );
        if (/redirect/i.test(message)) throw lastError;
        continue;
      }

      const text = await response.text();

      if (response.ok) {
        try {
          return { data: (text ? JSON.parse(text) : null) as T, headers: response.headers };
        } catch {
          throw new TargetError(`${method} ${url.pathname} returned a success body that is not JSON.`, {
            status: response.status,
            method,
            url: url.href,
            bodySnippet: text.slice(0, 200),
          });
        }
      }

      let code: string | undefined;
      let message = `${response.status} ${response.statusText}`;
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('json')) {
        try {
          const parsed = JSON.parse(text) as { code?: string; message?: string };
          code = parsed.code;
          if (parsed.message) message = `${message}: ${parsed.message}`;
        } catch {
          /* fall through to the snippet */
        }
      } else if (text) {
        message = `${message} (the response was not JSON; a firewall or security plugin may be blocking the REST API)`;
      }

      lastError = new TargetError(`${method} ${url.pathname} — ${message}`, {
        status: response.status,
        code,
        method,
        url: url.href,
        bodySnippet: text.slice(0, 200),
      });

      const retryAfter = Number(response.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) retryAfterMs = retryAfter * 1000;

      if (response.status !== 429 && response.status < 500) throw lastError;
    }

    throw lastError ?? new TargetError(`${method} ${url.pathname} failed.`, { status: 0, method, url: url.href });
  }

  /** Follow `X-WP-TotalPages` to the end of a collection. */
  async listAll<T>(path: string, query: Record<string, string | number>): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const { data, headers } = await this.request<T[]>('GET', path, {
        query: { ...query, per_page: 100, page },
      });
      if (Array.isArray(data)) all.push(...data);
      const header = Number(headers.get('x-wp-totalpages'));
      totalPages = Number.isFinite(header) && header > 0 ? header : 1;
      page += 1;
    } while (page <= totalPages);
    return all;
  }
}
