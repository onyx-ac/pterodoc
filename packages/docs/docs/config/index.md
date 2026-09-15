---
title: Configuration
description: Every option in pterodocs.config.mjs, what it defaults to, and what reads it.
---

# Configuration

`pterodocs.config.mjs`, beside your `docusaurus.config.ts`. It is a real module, so it can
compute things.

```js
import { defineConfig } from 'pterodocs';

export default defineConfig({
  site: { sidebars: ['docs'], versions: 'last', locales: 'default' },
  target: { type: 'wordpress', root: '/docs', base: '', status: 'publish' },
  layout: { nav: 'page-list', breadcrumb: true, pagination: true },
  render: { classPrefix: 'pterodocs', styles: 'inline', highlight: true },
  mdx: { onUnknown: 'report' },
  media: { upload: true },
  output: { dir: '.pterodocs' },
  llms: { index: true, full: true, publish: true },
});
```

Everything above is a default except `sidebars` and `root`.

## The sections

| Section | What it decides |
| :--- | :--- |
| [`site`](site) | Which documents are published: instances, sidebars, versions, locales, drafts |
| [`target`](target) | Where they go, and how: path, status, credentials, retries |
| [`layout`](layout) | The shape of each published page: columns, navigation, breadcrumb, pagination |
| [`render`](render) | How markdown becomes blocks: class prefix, stylesheet, highlighting, link policy |
| [`blog`](blog) | Publishing the site's blog as posts, under `--blog` |
| [`llms`](llms) | `llms.txt` and `llms-full.txt` |
| `mdx` | `onUnknown`: `report` (default), `keep` or `drop`, for JSX with no translation |
| `media` | `upload`, `uploadRemote`, `onMissing`, `slugPrefix` |
| `output` | `dir` (default `.pterodocs`), `pages` (write each rendered body as a file) |
| `strict` | The severity at which `--strict` fails a run |

## Where a value can come from

Later beats earlier:

1. A built-in default
2. `pterodocs.config.mjs`
3. An environment variable, where one exists (`WP_URL`, `WP_USER`, `WP_APP_PASSWORD`,
   `WP_ROOT`, `WP_BASE`, `WP_STATUS`, `WP_LANG`)
4. A command-line flag

So `--root /somewhere-else` wins over the config file, which wins over the default `/docs`.

## Finding the file

pterodocs looks for `pterodocs.config.mjs`, `.js`, `.cjs`, `.json` in the site directory,
then the legacy `pterodoc.config.*` names. `--config <file>` names one explicitly.
