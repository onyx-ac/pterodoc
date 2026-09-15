/**
 * The parts of pterodocs that know neither where a model came from nor where it
 * is going: rendering, the site model, the target contract and the reconciler.
 *
 * Most consumers want the `pterodocs` package instead; this is what the source
 * and target packages build on.
 */

export { EXIT, PterodocsError, ConfigError, TargetError, UnsupportedContentError } from './errors';
export { VERSION, USER_AGENT } from './version';
export { defineConfig } from './config/types';
export type {
  PterodocsConfig,
  SiteConfig,
  TargetConfig,
  RenderConfig,
  MdxConfig,
  MediaConfig,
  OutputConfig,
} from './config/types';
export { loadConfig, resolveConfig, discoverConfigFile, CONFIG_NAMES } from './config/load';
export type { ResolvedConfig, ConfigFlags } from './config/load';
export { runSync } from './sync/run';
export type { RunResult, RunSyncDeps } from './sync/run';
export type { Plan, Action } from './sync/plan';
export { purgeTree, findByPath, isOwnPage } from './sync/purge';
export type { PurgeReport, PurgeOptions } from './sync/purge';
export { renderLlmsIndex, renderLlmsFull } from './sync/llms';
export type { LlmsInput, LlmsPage } from './sync/llms';
export * from './model/index';
export * from './target/index';
export { renderDoc, createTheme, composePage, DEFAULT_LAYOUT } from './render/index';
export type { RenderedDoc, Theme, Strings, PageLayout } from './render/index';
export { IssueCollector, formatIssue, compareSeverity } from './util/issues';
export type { Issue, Severity } from './util/issues';
