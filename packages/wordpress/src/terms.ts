/**
 * Taxonomy terms: the tags a post carries.
 *
 * WordPress takes term **ids** over REST, not names. A post's tags therefore
 * cannot be written without first knowing what each name is called numerically
 * on this site — which is why the whole taxonomy is read once at the start of a
 * session, alongside the page index and for the same reason: `diffPage` is
 * synchronous, so by the time anything wants to compare a post's tags there is
 * no opportunity left to ask.
 *
 * Creating terms needs a capability the sync user may not have. That is a fact
 * about the account rather than a failure of the publish, so a term that cannot
 * be created is reported and the post goes out without it.
 */

import { TargetError } from '@pterodocs/core/util';
import type { WpClient } from './client';

/** A term as WordPress returns it, narrowed to what is read. */
interface WpTerm {
  id: number;
  name: string;
  slug: string;
  /** 0 for a flat taxonomy, or one that has no parent. */
  parent?: number;
}

/** The terms of one taxonomy, and the ability to add to them. */
export interface TermIndex {
  /** Resolve a tag label to a term id, if the site already has one. */
  idFor(label: string): number | undefined;
  /**
   * Resolve every label, creating the terms that do not exist yet.
   *
   * @returns The ids, and anything that could not be created.
   */
  ensure(labels: readonly string[]): Promise<{ ids: number[]; warnings: string[] }>;
  /**
   * Walk a path of names, creating what is missing, and return the last one.
   *
   * For a hierarchical taxonomy: `['Products', 'DocStack', 'Release notes']`
   * is one category three deep, not three categories. Names are matched within
   * their parent, so two branches may both have a `Guides` under them.
   *
   * @returns The leaf's id, or undefined when it could not be created.
   */
  ensurePath(names: readonly string[]): Promise<{ id: number | undefined; warnings: string[] }>;
}

/** How a label is matched against an existing term, in either direction. */
const key = (value: string): string => value.trim().toLowerCase();

/**
 * Read a taxonomy, so its terms can be resolved without a request each.
 *
 * @param client The site to read from.
 * @param taxonomy The taxonomy's REST base, which the plugin registers as its name.
 * @param dryRun Report what would be created rather than creating it.
 */
export async function loadTermIndex(
  client: WpClient,
  taxonomy: string,
  dryRun = false,
): Promise<TermIndex> {
  const route = `/${taxonomy}`;
  const byLabel = new Map<string, number>();
  // Keyed by parent as well, because a hierarchical taxonomy may reuse a name
  // under two different branches and they are not the same term.
  const byParent = new Map<string, WpTerm>();

  let terms: WpTerm[] = [];
  try {
    terms = await client.listAll<WpTerm>(route, { context: 'edit', _fields: 'id,name,slug,parent' });
  } catch (error) {
    // A taxonomy that is not registered answers 404. Publishing without tags
    // is better than not publishing, and `doctor` is where a missing taxonomy
    // belongs; here it simply means there are no terms to resolve against.
    const status = (error as { status?: number }).status;
    if (status !== 404) throw error;
  }

  const remember = (term: WpTerm): void => {
    byLabel.set(key(term.name), term.id);
    byLabel.set(key(term.slug), term.id);
    byParent.set(`${term.parent ?? 0}/${key(term.name)}`, term);
    byParent.set(`${term.parent ?? 0}/${key(term.slug)}`, term);
  };

  for (const term of terms) remember(term);

  /** Create one term, or say why it could not be. */
  const create = async (
    name: string,
    parent: number,
  ): Promise<{ term?: WpTerm; warning?: string }> => {
    try {
      const { data } = await client.request<WpTerm>('POST', route, {
        body: { name, ...(parent ? { parent } : {}) },
      });
      remember(data);
      byLabel.set(key(name), data.id);
      return { term: data };
    } catch (error) {
      const status = (error as TargetError).status;
      // 403 is the sync user lacking the capability to manage this taxonomy;
      // 400 is usually a term that exists under a slug this did not match.
      if (status === 403 || status === 400) {
        return {
          warning: `"${name}" could not be added to ${taxonomy}: WordPress refused it (${status}).`,
        };
      }
      throw error;
    }
  };

  return {
    idFor: (label) => byLabel.get(key(label)),

    async ensure(labels) {
      const ids: number[] = [];
      const warnings: string[] = [];

      for (const label of labels) {
        const existing = byLabel.get(key(label));
        if (existing !== undefined) {
          ids.push(existing);
          continue;
        }
        if (dryRun) continue;

        const { term, warning } = await create(label, 0);
        if (term) ids.push(term.id);
        if (warning) warnings.push(`${warning} The post was published without that tag.`);
      }

      return { ids, warnings };
    },

    async ensurePath(names) {
      const warnings: string[] = [];
      let parent = 0;

      for (const name of names) {
        const existing = byParent.get(`${parent}/${key(name)}`);
        if (existing) {
          parent = existing.id;
          continue;
        }
        if (dryRun) return { id: undefined, warnings };

        const { term, warning } = await create(name, parent);
        if (!term) {
          // A path is all or nothing: filing under a half-made one would put
          // the posts somewhere nobody asked for and nothing would say so.
          warnings.push(`${warning} The posts were published without a category.`);
          return { id: undefined, warnings };
        }
        parent = term.id;
      }

      return { id: parent || undefined, warnings };
    },
  };
}
