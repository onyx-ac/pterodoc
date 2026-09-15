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

  let terms: WpTerm[] = [];
  try {
    terms = await client.listAll<WpTerm>(route, { context: 'edit', _fields: 'id,name,slug' });
  } catch (error) {
    // A taxonomy that is not registered answers 404. Publishing without tags
    // is better than not publishing, and `doctor` is where a missing taxonomy
    // belongs; here it simply means there are no terms to resolve against.
    const status = (error as { status?: number }).status;
    if (status !== 404) throw error;
  }

  for (const term of terms) {
    byLabel.set(key(term.name), term.id);
    byLabel.set(key(term.slug), term.id);
  }

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

        try {
          const { data } = await client.request<WpTerm>('POST', route, { body: { name: label } });
          byLabel.set(key(data.name), data.id);
          byLabel.set(key(data.slug), data.id);
          byLabel.set(key(label), data.id);
          ids.push(data.id);
        } catch (error) {
          const status = (error as TargetError).status;
          // 403 is the sync user lacking `manage_terms`; 400 is usually a term
          // that exists under a slug this did not match. Neither is worth
          // failing a publish over.
          if (status === 403 || status === 400) {
            warnings.push(
              `The tag "${label}" could not be added to ${taxonomy}: WordPress refused it (${status}). The post was published without it.`,
            );
            continue;
          }
          throw error;
        }
      }

      return { ids, warnings };
    },
  };
}
