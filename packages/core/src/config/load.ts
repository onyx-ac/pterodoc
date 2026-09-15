/**
 * Discovering, merging and validating configuration.
 *
 * Precedence is flags, then the environment, then the config file, then the
 * defaults. Nothing here touches `process.env` or the disk except through the
 * dependencies it is given, so it is testable without either.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { ConfigError } from '../errors';
import { DEFAULT_LAYOUT, type PageLayout } from '../render/page';
import { DEFAULT_STRINGS, type Strings } from '../render/theme';
import type { Severity } from '../util/issues';
import { titleCase, toSlugSegments } from '../util/paths';
import type { PterodocsConfig } from './types';

/** File names tried, in order, when no config is named. */
export const CONFIG_NAMES = [
  'pterodocs.config.mjs',
  'pterodocs.config.js',
  'pterodocs.config.cjs',
  'pterodocs.config.ts',
  'pterodocs.config.json',
  // The name before the rename, still answered to so an existing project keeps
  // working without being edited.
  'pterodoc.config.mjs',
  'pterodoc.config.js',
  'pterodoc.config.cjs',
  'pterodoc.config.ts',
  'pterodoc.config.json',
];

/** Flags the CLI can supply, already parsed. */
export interface ConfigFlags {
  siteDir?: string | undefined;
  config?: string | undefined;
  docusaurusConfig?: string | undefined;
  model?: string | undefined;
  instance?: string[] | undefined;
  locale?: string[] | undefined;
  allLocales?: boolean | undefined;
  docsVersion?: string[] | undefined;
  allVersions?: boolean | undefined;
  root?: string | undefined;
  base?: string | undefined;
  status?: string | undefined;
  only?: string | undefined;
  out?: string | undefined;
  dryRun?: boolean | undefined;
  prune?: boolean | undefined;
  /** With `purge`, actually remove rather than only reporting. */
  apply?: boolean | undefined;
  offline?: boolean | undefined;
  noMedia?: boolean | undefined;
  /** Publish the site's blog into its own post type, rather than the docs. */
  blog?: boolean | undefined;
  strict?: boolean | undefined;
  envFile?: string | undefined;
}

/** Everything the run needs, with nothing left to decide. */
export interface ResolvedConfig {
  siteDir: string;
  configFile: string | undefined;
  docusaurusConfig: string | undefined;
  modelFile: string | undefined;

  instances: string[] | 'all';
  sidebars: string[] | 'all';
  /**
   * Which kind of instance this run publishes.
   *
   * A site model holds its documentation and its blog side by side, and a run
   * publishes one tree to one place. Without this a docs run whose `sidebars`
   * is `all` would pick the blog's sidebar up by accident, and publish release
   * notes into the documentation.
   */
  publish: 'docs' | 'blog';
  versions: string[] | 'all' | 'last';
  locales: string[] | 'all' | 'default';
  includeDrafts: boolean;
  includeUnlisted: boolean;
  includeOrphans: boolean;

  targetType: 'wordpress';
  targetUrl: string;
  user: string;
  appPassword: string;
  rootSegments: string[];
  baseSegments: string[];
  /**
   * The REST collection the tree is published into.
   *
   * `pages` for documentation. A blog run names the custom post type the
   * plugin registers instead, which is the only thing that differs between
   * publishing a page and publishing a release note.
   */
  restBase: string;
  /**
   * The shape the tree is published in.
   *
   * `tree` nests: documentation is a subtree of pages, rooted at a page
   * pterodocs writes. `flat` does not: release notes are ordinary posts, with
   * no root, no nesting, and a URL the site's own settings decide. Where they
   * sit in relation to the documentation is said with a category instead,
   * which is the only kind of hierarchy a post has.
   */
  ownership: 'tree' | 'flat';
  /**
   * Category the posts are filed under, outermost first.
   *
   * Built from the documentation's own root path plus a name for the posts, so
   * the two line up in the site's category tree even though their URLs cannot.
   * Empty for a documentation run, which files nothing.
   */
  categoryPath: string[];
  /** Taxonomy carrying a post's tags, or '' to publish none. */
  taxonomy: string;
  /**
   * Where a page's position among its siblings comes from.
   *
   * `sidebar` numbers pages in sidebar order. `none` sends no position at all,
   * which is what a dated archive wants: its sidebar is newest-first, so one
   * new post would renumber every existing one and rewrite the whole tree.
   */
  menuOrder: 'sidebar' | 'none';
  docsTitle: string;
  status: 'publish' | 'draft' | 'private';
  template: string;
  lang: string;
  metaDescriptionKey: string;
  methodOverride: boolean;
  retry: { attempts: number; baseDelayMs: number; maxDelayMs: number };

  layout: PageLayout;
  classPrefix: string;
  /** Which block vocabulary the renderer emits. */
  blocks: 'core' | 'plugin';
  /** Whether a stylesheet is published with the pages. */
  styles: 'inline' | 'none';
  /** Whether fences are tokenised at publish time. */
  highlight: boolean;
  dedupeTitle: boolean;
  unpublishedLinks: 'site' | 'drop';
  siteUrl: string;
  excerptLength: number;
  strings: Strings;
  localeStrings: Record<string, Partial<Strings>>;

  mdxOnUnknown: 'report' | 'placeholder' | 'error';

  uploadMedia: boolean;
  uploadRemoteMedia: boolean;
  mediaOnMissing: Severity | 'ignore';
  mediaSlugPrefix: string;

  outDir: string;
  writePages: boolean;
  /** What to write for LLM readers, and what to call it. */
  llms: { index: boolean; full: boolean; publish: boolean; title: string; description: string };

  only: string;
  dryRun: boolean;
  prune: boolean;
  offline: boolean;
  strict: boolean;
  strictAt: Severity;

  /** Told to the user before anything happens. */
  notices: string[];
}

/** Injected so configuration can be resolved without touching the disk. */
export interface ConfigDeps {
  readFileSync?: (file: string) => string;
  existsSync?: (file: string) => boolean;
  cwd?: () => string;
}

/** Find a configuration file next to the site. */
export function discoverConfigFile(
  siteDir: string,
  deps: Required<Pick<ConfigDeps, 'existsSync'>>,
): string | undefined {
  for (const name of CONFIG_NAMES) {
    const candidate = path.join(siteDir, name);
    if (deps.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Load a configuration file. */
export async function readConfigFile(file: string): Promise<PterodocsConfig> {
  if (file.endsWith('.json')) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as PterodocsConfig;
    } catch (error) {
      throw new ConfigError(`${file} is not valid JSON: ${(error as Error).message}`);
    }
  }
  try {
    const module = (await import(pathToFileURL(file).href)) as {
      default?: PterodocsConfig;
    };
    const config = module.default ?? (module as unknown as PterodocsConfig);
    if (!config || typeof config !== 'object') {
      throw new Error('the file exports no configuration object');
    }
    return config;
  } catch (error) {
    const message = (error as Error).message;
    if (file.endsWith('.ts')) {
      throw new ConfigError(
        `Could not load ${file}: ${message}\nA TypeScript config needs Node 22 or newer, which reads it directly. On an older Node, use pterodocs.config.mjs.`,
      );
    }
    throw new ConfigError(`Could not load ${file}: ${message}`);
  }
}

/** One value, from the flags, the environment, the file, or the default. */
function pick<T>(...candidates: (T | undefined)[]): T | undefined {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== '') return candidate;
  }
  return undefined;
}

/**
 * Names that changed when this tool was extracted.
 *
 * The credential and URL variables kept their names, because they are what
 * every existing setup already sets; only these two were renamed, and using
 * one still works but says so.
 */
const RENAMED: Record<string, string> = {
  WP_ROOT_PATH: 'PTERODOCS_WP_ROOT',
  WP_DOCS_BASE: 'PTERODOCS_WP_BASE',
};

/**
 * Read an environment value.
 *
 * `PTERODOCS_`-prefixed names win; the plain names are equally supported except
 * where one was renamed, which is reported.
 */
function fromEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  aliases: string[],
  notices: string[],
): string | undefined {
  const prefixed = env[`PTERODOCS_${name}`];
  if (prefixed) return prefixed;

  // The tool was called pterodocs until 0.4.0, so its whole prefix still
  // answers. Handled here rather than in the alias table, which is per-setting.
  const former = env[`PTERODOC_${name}`];
  if (former) {
    notices.push(`Using PTERODOC_${name}; it is now called PTERODOCS_${name}.`);
    return former;
  }
  for (const alias of aliases) {
    const value = env[alias];
    if (!value) continue;
    const current = RENAMED[alias];
    if (current) notices.push(`Using ${alias}; it is now called ${current}.`);
    return value;
  }
  return undefined;
}

/**
 * Resolve everything into the shape the run reads.
 *
 * @param input Flags, the file's contents, and the environment.
 */
export function resolveConfig(input: {
  flags?: ConfigFlags;
  file?: PterodocsConfig;
  fileDir?: string;
  env?: NodeJS.ProcessEnv;
  configFile?: string | undefined;
}): ResolvedConfig {
  const flags = input.flags ?? {};
  const file = input.file ?? {};
  const env = input.env ?? {};
  const notices: string[] = [];

  const site = file.site ?? {};
  const target = file.target ?? {};
  const render = file.render ?? {};
  const media = file.media ?? {};
  const output = file.output ?? {};
  const llms = file.llms ?? {};

  const baseDir = input.fileDir ?? process.cwd();
  const siteDir = path.resolve(baseDir, pick(flags.siteDir, site.dir) ?? '.');

  const userEnvName = target.auth?.userEnv ?? 'WP_USER';
  const passwordEnvName = target.auth?.passwordEnv ?? 'WP_APP_PASSWORD';

  const targetUrl = (
    pick(fromEnv(env, 'WP_URL', ['WP_URL'], notices), target.url) ?? ''
  ).replace(/\/+$/, '');
  const user = (env[userEnvName] ?? '').trim();
  const appPassword = (env[passwordEnvName] ?? '').replace(/\s+/g, '');

  if (targetUrl && !/^https?:\/\//.test(targetUrl)) {
    throw new ConfigError(`The target URL must start with http:// or https:// (got "${targetUrl}").`);
  }

  const missingCredentials = !targetUrl || !user || !appPassword;
  const offline = flags.offline === true || missingCredentials;
  if (missingCredentials && flags.offline !== true) {
    notices.push(
      `No target URL or credentials (${userEnvName}, ${passwordEnvName}): running offline. Pages are rendered and nothing is sent.`,
    );
  }

  const status = (pick(flags.status, fromEnv(env, 'WP_STATUS', ['WP_STATUS'], notices), target.status) ??
    'publish') as ResolvedConfig['status'];
  if (status !== 'publish' && status !== 'draft' && status !== 'private') {
    throw new ConfigError(`Status must be publish, draft or private (got "${status}").`);
  }

  const rootPath = pick(flags.root, fromEnv(env, 'WP_ROOT', ['WP_ROOT_PATH'], notices), target.root) ?? '/docs';
  const basePath =
    flags.base !== undefined
      ? flags.base
      : (pick(fromEnv(env, 'WP_BASE', ['WP_DOCS_BASE'], notices), target.base) ?? '');

  const layout: PageLayout = { ...DEFAULT_LAYOUT, ...file.layout };
  if (!['', 'wide', 'full'].includes(layout.align)) {
    throw new ConfigError(`Layout alignment must be "", "wide" or "full" (got "${layout.align}").`);
  }

  // Publishing the blog is the same run with a handful of values changed, so
  // it folds down into the same shape rather than becoming a second one. What
  // it may not change is the axis: no field below becomes per-tree.
  const blogging = flags.blog === true;
  const blog = file.blog ?? {};

  if (blogging) {
    Object.assign(layout, {
      // A post is a body. There is no tree beside it to navigate, no root to
      // list from, and no siblings to page through -- and `page-list` with no
      // root would list every page on the site, which is checked for below in
      // case the file asked for it explicitly.
      kind: 'single',
      nav: 'none',
      breadcrumb: false,
      pagination: false,
      childIndex: 'none',
      ...blog.layout,
    });
  }

  // `page-list` lists the children of a page id, and a tree with no root page
  // has no id to give it. The block reads a missing parent as the site root
  // and lists every page on the site, so this cannot be allowed to be a
  // fallback -- it has to be an error.
  const ownership: ResolvedConfig['ownership'] = blogging ? 'flat' : 'tree';
  if (ownership !== 'tree' && layout.nav === 'page-list') {
    throw new ConfigError(
      'layout.nav cannot be "page-list" here: this tree has no root page, so there is no page whose children the block could list. Set it to "none".',
    );
  }

  const locales: ResolvedConfig['locales'] = flags.allLocales
    ? 'all'
    : flags.locale && flags.locale.length > 0
      ? flags.locale
      : (site.locales ?? 'default');

  const versions: ResolvedConfig['versions'] = flags.allVersions
    ? 'all'
    : flags.docsVersion && flags.docsVersion.length > 0
      ? flags.docsVersion
      : (site.versions ?? 'last');

  const outDir = path.resolve(
    baseDir,
    pick(flags.out, fromEnv(env, 'OUT', [], notices), output.dir) ?? '.pterodocs',
    // A subdirectory of its own: writing the artefacts clears the directory
    // they go into, so a blog run sharing one with the documentation would
    // destroy whatever the last docs run wrote, and the other way round.
    ...(blogging ? [blog.out || 'blog'] : []),
  );

  // Where the posts are filed. The documentation's own root, titled, with a
  // name for the posts below it -- so the two line up in the category tree
  // even though a post's URL is the site's to decide and cannot be moved.
  if (blogging && !blog.category && !blog.categoryPath?.length) {
    throw new ConfigError(
      'Publishing the blog needs somewhere to file the posts. Set `blog.category` to what they should be called, e.g. "Release notes" -- it is created under a category path built from `target.root`. Set `blog.categoryPath` instead for a category tree that does not follow the paths.',
    );
  }

  const categoryPath = blogging
    ? (blog.categoryPath ?? [
        ...toSlugSegments(rootPath, 'the target root path').map(titleCase),
        blog.category!,
      ]).filter((name) => name.trim() !== '')
    : [];

  return {
    siteDir,
    configFile: input.configFile,
    docusaurusConfig: pick(flags.docusaurusConfig, site.config),
    modelFile: flags.model ? path.resolve(baseDir, flags.model) : undefined,

    instances: blogging
      ? (blog.instance ? [blog.instance] : [])
      : flags.instance && flags.instance.length > 0
        ? flags.instance
        : (site.instances ?? 'all'),
    // A blog carries its posts on one synthetic sidebar of that name, so
    // naming it keeps a docs sidebar from being swept in beside them.
    sidebars: blogging ? ['blog'] : (site.sidebars ?? 'all'),
    publish: blogging ? 'blog' : 'docs',
    versions,
    locales,
    includeDrafts: site.includeDrafts === true,
    includeUnlisted: site.includeUnlisted === true,
    includeOrphans: site.includeOrphans === true,

    targetType: target.type ?? 'wordpress',
    targetUrl,
    user,
    appPassword,
    rootSegments: toSlugSegments(rootPath, 'the target root path'),
    baseSegments: blogging ? [] : toSlugSegments(basePath, 'the target base'),
    // Both built in, so there is nothing for the two ends to disagree about.
    restBase: blogging ? 'posts' : 'pages',
    ownership,
    categoryPath,
    taxonomy: blogging && blog.tags !== false ? 'tags' : '',
    // Numbering a newest-first archive means one new post renumbers every
    // older one, and rewrites the lot on the next run.
    menuOrder: blogging ? 'none' : 'sidebar',
    docsTitle: blogging ? '' : (target.title ?? ''),
    status: blogging ? (blog.status ?? status) : status,
    template: blogging ? (blog.template ?? '') : (target.template ?? ''),
    lang: pick(fromEnv(env, 'WP_LANG', ['WP_LANG'], notices), target.lang) ?? '',
    metaDescriptionKey: target.meta?.description ?? '',
    methodOverride:
      fromEnv(env, 'METHOD_OVERRIDE', ['WP_METHOD_OVERRIDE'], notices) === '1' ||
      target.methodOverride === true,
    retry: {
      attempts: target.retry?.attempts ?? 4,
      baseDelayMs: target.retry?.baseDelayMs ?? 1000,
      maxDelayMs: target.retry?.maxDelayMs ?? 30_000,
    },

    layout,
    classPrefix: render.classPrefix ?? 'pterodocs',
    blocks: render.blocks === 'plugin' ? 'plugin' : 'core',
    styles: render.styles === 'none' ? 'none' : 'inline',
    highlight: render.highlight !== false,
    dedupeTitle: render.dedupeTitle !== false,
    unpublishedLinks: render.unpublishedLinks ?? 'site',
    siteUrl: render.siteUrl ?? '',
    excerptLength: render.excerptLength ?? 160,
    strings: { ...DEFAULT_STRINGS, ...render.strings },
    localeStrings: render.localeStrings ?? {},

    mdxOnUnknown: file.mdx?.onUnknown ?? 'report',

    uploadMedia: flags.noMedia === true ? false : media.upload !== false,
    uploadRemoteMedia: media.uploadRemote === true,
    mediaOnMissing: media.onMissing ?? 'warning',
    // Deliberately not renamed with the rest. This string is the identity of
    // every file already in a site's media library — the slug is
    // `<prefix>-<content hash>` — so changing it would orphan every upload and
    // send them all again. It is a key, not branding, and nobody sees it.
    mediaSlugPrefix: media.slugPrefix ?? 'pterodoc',

    outDir,
    writePages: output.pages !== false,
    llms: {
      // Off for a blog: llms.txt describes a documentation set, and it is
      // stored on the tree's root page -- which this tree does not have.
      index: !blogging && llms.index !== false,
      full: !blogging && llms.full !== false,
      publish: !blogging && llms.publish !== false,
      title: llms.title ?? '',
      description: llms.description ?? '',
    },

    only: (flags.only ?? '').replace(/^\/+|\/+$/g, ''),
    dryRun: flags.dryRun === true || offline,
    prune: flags.prune === true,
    offline,
    strict: flags.strict === true,
    strictAt: file.strict ?? 'error',

    notices,
  };
}

/**
 * Discover, read and resolve the configuration.
 *
 * @param flags Parsed command line flags.
 * @param env The environment to read.
 * @param deps Injected filesystem access.
 */
export async function loadConfig(
  flags: ConfigFlags = {},
  env: NodeJS.ProcessEnv = process.env,
  deps: ConfigDeps = {},
): Promise<ResolvedConfig> {
  const existsSync = deps.existsSync ?? ((file: string) => fs.existsSync(file));
  const cwd = deps.cwd ?? (() => process.cwd());

  const startDir = path.resolve(cwd(), flags.siteDir ?? '.');
  const configFile = flags.config
    ? path.resolve(cwd(), flags.config)
    : discoverConfigFile(startDir, { existsSync });

  if (flags.config && !existsSync(configFile!)) {
    throw new ConfigError(`No configuration file at ${configFile}.`);
  }

  const file = configFile ? await readConfigFile(configFile) : {};
  const fileDir = configFile ? path.dirname(configFile) : startDir;

  // A named env file is read only when asked for, so a developer's own .env
  // can never leak into a test or a scripted run.
  const envFile = flags.envFile ?? env['PTERODOCS_ENV_FILE'] ?? env['PTERODOC_ENV_FILE'];
  const merged = envFile
    ? { ...dotenv.parse(fs.readFileSync(path.resolve(cwd(), envFile))), ...env }
    : env;

  return resolveConfig({ flags, file, fileDir, env: merged, configFile });
}
