/**
 * Command line entry point.
 *
 * The only place that catches: every other module raises, and this decides how
 * it is shown and which exit code it becomes.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { EXIT, ConfigError, PterodocsError, TargetError } from '@pterodocs/core';
import { VERSION } from '@pterodocs/core';
import { compareSeverity } from '@pterodocs/core/util';
import { loadConfig, type ResolvedConfig } from '@pterodocs/core';
import { createDocusaurusReader } from '@pterodocs/docusaurus';
import { createCaptureReader, writeCapture } from '@pterodocs/core/model';
import type { SourceReader } from '@pterodocs/core/model';
import { resolveTarget } from '../target';
import { detectPlugin, WpClient, DEFAULT_RETRY } from '@pterodocs/wordpress';
import { purgeTree } from '@pterodocs/core';
import { runSync } from '@pterodocs/core';
import { parseCliArgs, USAGE, type ParsedArgs } from './args';
import { createReporter, type Reporter } from './reporter';

/** Run the CLI. */
export async function main(argv: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    return report(error);
  }

  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return EXIT.ok;
  }
  if (parsed.version) {
    process.stdout.write(`${VERSION}\n`);
    return EXIT.ok;
  }

  const reporter = createReporter({
    verbose: parsed.verbose,
    quiet: parsed.quiet,
    json: parsed.json,
  });

  try {
    const config = await loadConfig(parsed.flags);
    for (const notice of config.notices) reporter.info(`note: ${notice}`);

    switch (parsed.command) {
      case 'init':
        return await commandInit(config, reporter);
      case 'capture':
        return await commandCapture(config, parsed, reporter);
      case 'purge':
        return await commandPurge(config, parsed, reporter);
      case 'doctor':
        return await commandDoctor(config, reporter);
      case 'render':
      case 'sync':
        return await commandSync(config, parsed, reporter);
      default:
        return EXIT.ok;
    }
  } catch (error) {
    return report(error);
  }
}

/** Build the reader the commands share. */
function readerFor(
  config: ResolvedConfig,
  reporter: Reporter,
  /** Read everything, whichever tree this run came for. Used by `capture`. */
  everything = false,
): SourceReader {
  if (config.modelFile) return createCaptureReader(config.modelFile);
  return createDocusaurusReader({
    siteDir: config.siteDir,
    configPath: config.docusaurusConfig,
    instances: everything ? 'all' : config.instances,
    // Read the blog only for a run that came for it. `instances` is already
    // empty in that case, so a blog run loads the blog and nothing else.
    blog: everything || config.publish === 'blog',
    versions: config.versions,
    includeDrafts: config.includeDrafts,
    warn: (message) => reporter.issue({ code: 'docusaurus-version', severity: 'warning', message }),
  });
}

/** `sync` and `render`. */
async function commandSync(
  config: ResolvedConfig,
  parsed: ParsedArgs,
  reporter: Reporter,
): Promise<number> {
  const render = parsed.command === 'render';
  const reader = readerFor(config, reporter);
  const target = resolveTarget(config);
  const renderOnly = render || config.offline;

  const where = `/${[...config.rootSegments, ...config.baseSegments].join('/')}/`;
  const what = config.publish === 'blog' ? 'the blog' : 'the documentation';
  reporter.info(
    renderOnly
      ? `Rendering ${what} for ${where}.`
      : `${config.dryRun ? 'Planning' : 'Publishing'} ${what} to ${config.targetUrl}${where} as ${config.status}.`,
  );

  const { plan } = await runSync(config, {
    reader,
    target,
    renderOnly,
    log: (message) => reporter.detail(message),
  });

  if (parsed.capture) {
    await writeCapture(parsed.capture, await reader.read());
    reporter.info(`Model written to ${parsed.capture}`);
  }

  for (const issue of plan.issues) reporter.issue(issue);
  reporter.summary(plan);

  if (plan.mediaPending > 0) {
    reporter.info(
      `${plan.mediaPending} file(s) would be uploaded. Until they are, the rendered pages show the paths from the source.`,
    );
  }
  const pruneable = plan.actions.filter((action) => action.op === 'prune' && action.applied !== true);
  if (pruneable.length > 0) {
    reporter.info(`${pruneable.length} page(s) have no source document. Re-run with --prune to trash them.`);
  }
  if (plan.artifactError) {
    reporter.issue({
      code: 'artifacts-unwritten',
      severity: 'warning',
      message: `The run finished but its output could not be written: ${plan.artifactError}`,
    });
  } else {
    const where = path.relative(process.cwd(), config.outDir) || config.outDir;
    reporter.info(`Rendered pages and plan.json written to ${where}/`);

    // Storing the stylesheet on every page is what makes an unstyled site look
    // right with nothing installed, but it is the same few kilobytes over and
    // over. Say so once, and say what the alternative is.
    if (config.styles === 'inline') {
      reporter.info(
        `Each page carries the stylesheet. To store it once instead, paste ${where}/docs.css into Appearance, Customise, Additional CSS and set render.styles to 'none'.`,
      );
    }
  }
  if (config.dryRun && !config.offline) reporter.info('Dry run: the site was not modified.');

  if (config.strict) {
    const blocking = plan.issues.filter((issue) => compareSeverity(issue.severity, config.strictAt) >= 0);
    if (blocking.length > 0) {
      reporter.info(`\n${blocking.length} issue(s) at or above "${config.strictAt}" with --strict.`);
      return EXIT.strict;
    }
  }
  return EXIT.ok;
}

/** `capture`. */
async function commandCapture(
  config: ResolvedConfig,
  parsed: ParsedArgs,
  reporter: Reporter,
): Promise<number> {
  const file = parsed.capture ?? path.join(config.outDir, 'model.json');
  // Everything, so one capture serves a docs run and a blog run alike --
  // otherwise `--model` would quietly publish nothing for whichever of the two
  // the capture was not taken for.
  const model = await readerFor(config, reporter, true).read();
  await writeCapture(file, model);
  const docs = model.instances.reduce(
    (total, instance) =>
      total + instance.versions.reduce((count, version) => count + version.docs.length, 0),
    0,
  );
  reporter.info(`Captured ${docs} document(s) from ${model.siteDir} to ${file}`);
  return EXIT.ok;
}

/** `doctor`. */
async function commandDoctor(config: ResolvedConfig, reporter: Reporter): Promise<number> {
  reporter.info('Checking the setup.\n');
  reporter.info(`  config      ${config.configFile ?? 'none found; using defaults'}`);
  reporter.info(`  site        ${config.siteDir}`);
  reporter.info(`  target      ${config.targetUrl || 'not set'}`);
  reporter.info(`  root path   /${[...config.rootSegments, ...config.baseSegments].join('/')}/`);
  reporter.info(`  publishing  ${config.publish === 'blog' ? `the blog, into ${config.restBase}` : 'the documentation, as pages'}`);
  reporter.info(`  credentials ${config.user ? `as ${config.user}` : 'missing'}`);

  const reader = readerFor(config, reporter);
  const model = await reader.read();
  reporter.info(`  docusaurus  ${model.docusaurusVersion}`);
  reporter.info(`  locales     ${model.locales.join(', ')} (default ${model.defaultLocale})`);
  for (const instance of model.instances) {
    const versions = instance.versions.map((version) => version.name).join(', ');
    const docs = instance.versions.reduce((count, version) => count + version.docs.length, 0);
    reporter.info(`  instance    ${instance.id}: ${docs} document(s), version(s) ${versions}`);
  }

  if (config.offline) {
    reporter.info('\nNo credentials, so the target was not contacted.');
    return EXIT.ok;
  }

  const session = await resolveTarget(config).open({ locale: model.locale, dryRun: true });
  const index = await session.loadIndex();
  reporter.info(`\nReached the target: ${index.length} page(s) exist.`);

  const media = await session.loadMediaIndex();
  reporter.info(`${media.size} file(s) previously uploaded by pterodocs.`);

  await reportPlugin(config, reporter);
  return EXIT.ok;
}

/**
 * Say whether the WordPress plugin is installed, and whether the two ends agree.
 *
 * A prefix mismatch is the failure worth catching here: everything publishes,
 * the plugin loads, and none of its styling applies, with nothing on either side
 * to say why.
 */
async function reportPlugin(config: ResolvedConfig, reporter: Reporter): Promise<void> {
  const status = await detectPlugin(
    new WpClient({
      baseUrl: config.targetUrl,
      user: config.user,
      appPassword: config.appPassword,
      retry: DEFAULT_RETRY,
    }),
  );

  if (status.unknown) {
    reporter.info('');
    reporter.info(`The pterodocs plugin: ${status.unknown}.`);
    return;
  }

  if (!status.installed) {
    reporter.info('');
    reporter.info('The pterodocs WordPress plugin is not installed.');
    if (config.blocks === 'plugin') {
      reporter.issue({
        code: 'plugin-missing',
        severity: 'warning',
        message:
          "render.blocks is 'plugin', but the plugin did not answer. Pages will still display; anything only it can render will not.",
      });
    }
    return;
  }

  reporter.info('');
  reporter.info('The pterodocs WordPress plugin is installed.');

  if (config.blocks !== 'plugin') {
    reporter.info("Set render.blocks to 'plugin' to let it render what core blocks cannot.");
  }

  const prefix = status.classPrefix ?? 'pterodocs';
  if (prefix !== config.classPrefix) {
    reporter.issue({
      code: 'plugin-prefix-mismatch',
      severity: 'warning',
      message: `The plugin is styling "${prefix}" but pterodocs writes "${config.classPrefix}". Set them the same, on the plugin's settings page or in render.classPrefix; nothing needs re-publishing.`,
    });
  }
}

/**
 * `purge`.
 *
 * Deliberately does not load the site. Purging is what you do to a location the
 * documentation has moved away from, and asking Docusaurus to describe a site
 * in order to delete pages it no longer publishes to would be beside the point.
 */
async function commandPurge(
  config: ResolvedConfig,
  parsed: ParsedArgs,
  reporter: Reporter,
): Promise<number> {
  const segments = [...config.rootSegments, ...config.baseSegments];
  const where = `/${segments.join('/')}/`;

  if (config.offline) {
    throw new ConfigError(`No credentials, so ${where} cannot be read. Purging needs them.`);
  }

  const apply = parsed.flags.apply === true;
  reporter.info(
    apply
      ? `Removing the documentation at ${config.targetUrl}${where}.`
      : `Checking what would be removed at ${config.targetUrl}${where}. Nothing is written without --apply.`,
  );

  const target = resolveTarget(config);
  const rooted = target.capabilities.publishesTreeRoot;
  const session = await target.open({ locale: '', dryRun: !apply });
  const report = await purgeTree(session, {
    segments,
    rooted,
    classPrefix: config.classPrefix,
    apply,
    log: (message) => reporter.detail(message),
  });

  // A rooted tree that has no root page has nothing published at all. Without
  // a root there is no such shortcut: an empty collection simply has nothing
  // in it, which the counts below say perfectly well.
  if (rooted && !report.root) {
    reporter.info('Nothing is published there.');
    return EXIT.ok;
  }

  for (const page of report.kept) {
    reporter.issue({
      code: 'purge-skipped-foreign',
      severity: 'warning',
      message: `${page.link} was left alone: pterodocs did not write it.`,
    });
  }

  reporter.info('');
  reporter.info(
    apply
      ? `Trashed ${report.removed.length} page(s); left ${report.kept.length} alone.`
      : `Would trash ${report.removed.length} page(s); would leave ${report.kept.length} alone. Re-run with --apply.`,
  );
  if (apply) {
    reporter.info('They are in the trash, not deleted.');
  }

  return EXIT.ok;
}

/** `init`. */
async function commandInit(config: ResolvedConfig, reporter: Reporter): Promise<number> {
  const file = path.join(config.siteDir, 'pterodocs.config.mjs');
  try {
    await fs.access(file);
    throw new ConfigError(`${file} already exists.`);
  } catch (error) {
    if (error instanceof ConfigError) throw error;
  }

  await fs.writeFile(
    file,
    `import { defineConfig } from 'pterodocs';

export default defineConfig({
  site: {
    // Sidebars to publish. A document no listed sidebar reaches is not published.
    sidebars: 'all',
    versions: 'last',
    locales: 'default',
  },
  target: {
    type: 'wordpress',
    // Where the documentation hangs on the site. Missing pages along this path
    // are created once and never edited again.
    root: '/docs',
    base: '',
    status: 'publish',
  },
});
`,
    'utf8',
  );
  reporter.info(`Wrote ${file}`);
  return EXIT.ok;
}

/** Present an error the way its type deserves. */
function report(error: unknown): number {
  if (error instanceof ConfigError) {
    process.stderr.write(`\n${error.message}\n`);
    return error.exitCode;
  }
  if (error instanceof TargetError) {
    process.stderr.write(`\nThe target refused a request: ${error.message}\n`);
    if (error.bodySnippet) process.stderr.write(`  body: ${error.bodySnippet}\n`);
    return error.exitCode;
  }
  if (error instanceof PterodocsError) {
    process.stderr.write(`\n${error.message}\n`);
    return error.exitCode;
  }
  process.stderr.write(
    `\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  return EXIT.internal;
}
