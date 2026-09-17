/** Command line parsing and the usage text. */

import { parseArgs } from 'node:util';
import { ConfigError } from '@pterodocs/core';
import type { ConfigFlags } from '@pterodocs/core';

/** Commands the CLI accepts. */
export const COMMANDS = ['sync', 'render', 'doctor', 'capture', 'purge', 'init'] as const;

/** One of the commands. */
export type Command = (typeof COMMANDS)[number];

/** The help text. */
export const USAGE = `Publish a Docusaurus site to WordPress as a tree of pages.

Usage: pterodocs <command> [options]

Commands
  sync        Reconcile the target with the site. The default.
  render      Render every page to the output directory; contacts nothing.
  doctor      Check the configuration, the credentials and the target.
  capture     Write the loaded site model to a JSON file.
  purge       Remove the documentation pterodocs published at a path. Needs no
              site: use it to clean up a location the docs have moved away from.
  init        Write a starter pterodocs.config.mjs.

Source
  --site-dir <dir>            Docusaurus site directory (default: the working directory).
  --config <file>             pterodocs config file.
  --docusaurus-config <file>  Explicit docusaurus.config.* path.
  --model <file>              Use a captured model; Docusaurus is never loaded.
  --instance <id>             Docs plugin instance. Repeatable.
  --locale <code>             Locale to publish. Repeatable.
  --all-locales               Publish every locale the site declares.
  --docs-version <name>       Version to publish. Repeatable.
  --all-versions              Publish every version.

Target
  --root <path>               Path the documentation hangs from.
  --base <segment>            Segment below the root ("" publishes under the root).
  --status <status>           publish, draft or private.
  --only <prefix>             Restrict writes to pages under <prefix>.
  --dry-run                   Plan and render, change nothing.
  --prune                     Trash pages with no source document.
  --blog                      Publish the site's blog as ordinary posts, rather
                              than the documentation. Needs blog.category in the
                              config, which is where the posts are filed.
  --apply                     With purge, actually remove; otherwise it only reports.
  --offline                   Render only; never open a session.
  --no-media                  Skip uploads; leave image URLs as written.

Output
  --out <dir>                 Output directory (default <site-dir>/.pterodocs).
  --capture <file>            Also write the site model to <file>.
  --env-file <file>           Read this .env file. None is read otherwise.
  --strict                    Fail when an issue reaches the configured severity.
  --json                      Print a machine-readable summary.
  --verbose                   Log every page as it is processed.
  --quiet                     Only print errors.
  --help, --version

Credentials come from the environment: WP_URL, WP_USER, WP_APP_PASSWORD.
Without them every command still renders and reports what it would have done.

Documentation: https://onyx.ac/products/pterodocs/docs/`;

/** Flags after parsing. */
export interface ParsedArgs {
  command: Command;
  flags: ConfigFlags;
  capture: string | undefined;
  json: boolean;
  verbose: boolean;
  quiet: boolean;
  help: boolean;
  version: boolean;
}

/**
 * Parse the command line.
 *
 * @param argv Arguments after the executable and script name.
 */
export function parseCliArgs(argv: string[]): ParsedArgs {
  let values: Record<string, unknown>;
  let positionals: string[];

  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        'site-dir': { type: 'string' },
        config: { type: 'string' },
        'docusaurus-config': { type: 'string' },
        model: { type: 'string' },
        instance: { type: 'string', multiple: true },
        locale: { type: 'string', multiple: true },
        'all-locales': { type: 'boolean' },
        'docs-version': { type: 'string', multiple: true },
        'all-versions': { type: 'boolean' },
        root: { type: 'string' },
        base: { type: 'string' },
        status: { type: 'string' },
        only: { type: 'string' },
        'dry-run': { type: 'boolean' },
        prune: { type: 'boolean' },
        blog: { type: 'boolean' },
        apply: { type: 'boolean' },
        offline: { type: 'boolean' },
        'no-media': { type: 'boolean' },
        out: { type: 'string' },
        capture: { type: 'string' },
        'env-file': { type: 'string' },
        strict: { type: 'boolean' },
        json: { type: 'boolean' },
        verbose: { type: 'boolean' },
        quiet: { type: 'boolean' },
        help: { type: 'boolean' },
        version: { type: 'boolean' },
      },
    }));
  } catch (error) {
    throw new ConfigError(`${(error as Error).message}\n\n${USAGE}`);
  }

  const [first] = positionals;
  if (first !== undefined && !COMMANDS.includes(first as Command)) {
    throw new ConfigError(`Unknown command "${first}".\n\n${USAGE}`);
  }
  if (positionals.length > 1) {
    throw new ConfigError(`Expected one command but got ${positionals.length}.\n\n${USAGE}`);
  }

  const flags: ConfigFlags = {
    siteDir: values['site-dir'] as string | undefined,
    config: values['config'] as string | undefined,
    docusaurusConfig: values['docusaurus-config'] as string | undefined,
    model: values['model'] as string | undefined,
    instance: values['instance'] as string[] | undefined,
    locale: values['locale'] as string[] | undefined,
    allLocales: values['all-locales'] as boolean | undefined,
    docsVersion: values['docs-version'] as string[] | undefined,
    allVersions: values['all-versions'] as boolean | undefined,
    root: values['root'] as string | undefined,
    base: values['base'] as string | undefined,
    status: values['status'] as string | undefined,
    only: values['only'] as string | undefined,
    out: values['out'] as string | undefined,
    dryRun: values['dry-run'] as boolean | undefined,
    prune: values['prune'] as boolean | undefined,
    blog: values['blog'] as boolean | undefined,
    apply: values['apply'] as boolean | undefined,
    offline: values['offline'] as boolean | undefined,
    noMedia: values['no-media'] as boolean | undefined,
    strict: values['strict'] as boolean | undefined,
    envFile: values['env-file'] as string | undefined,
  };

  return {
    command: (first as Command | undefined) ?? 'sync',
    flags,
    capture: values['capture'] as string | undefined,
    json: values['json'] === true,
    verbose: values['verbose'] === true,
    quiet: values['quiet'] === true,
    help: values['help'] === true,
    version: values['version'] === true,
  };
}
