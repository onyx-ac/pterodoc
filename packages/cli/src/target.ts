/**
 * Build the target a run publishes to.
 *
 * Both entry points — the command line and the Docusaurus plugin — need the
 * same object built the same way, and having built it in two places once
 * already, the copies drifted apart in how they spelled the URL policy.
 */

import type { ResolvedConfig, Target } from '@pterodocs/core';
import { createWordpressTarget } from '@pterodocs/wordpress';

/**
 * Build the configured target.
 *
 * Always built, even offline: the target decides what a page's URL is, and a
 * render with the wrong URLs is worse than no render at all. Only opening a
 * session needs credentials.
 *
 * @param config The resolved configuration.
 */
export function resolveTarget(config: ResolvedConfig): Target {
  return createWordpressTarget({
    url: config.targetUrl,
    user: config.user,
    appPassword: config.appPassword,
    policy: {
      rootSegments: config.rootSegments,
      baseSegments: config.baseSegments,
    },
    restBase: config.restBase,
    ownership: config.ownership,
    status: config.status,
    template: config.template,
    lang: config.lang,
    mediaSlugPrefix: config.mediaSlugPrefix,
    methodOverride: config.methodOverride,
    retry: config.retry,
  });
}
