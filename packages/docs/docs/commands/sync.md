---
title: sync
description: Reconcile a WordPress site with your documentation, writing only what differs.
---

# `sync`

```bash
pterodocs sync --env-file .env
```

The main command. Loads the site, builds the page tree, renders every page, uploads media,
and writes what differs.

## What it reports

```
create-root 2 · create 6 · update 6 · 50 requests
```

| Action | Meaning |
| :--- | :--- |
| `create-root` | A path page above the documentation root, created because it was missing |
| `create` | A documentation page that did not exist |
| `update` | A page whose stored content, title, excerpt, status, order, template, parent or slug differed |
| `unchanged` | Identical; nothing sent |
| `trash` | Removed by `--prune` |
| `upload` | A media file sent |

**A second run should report everything as `unchanged`.** If it does not, the rendered and
the stored output disagree, and every run from now on will rewrite every page.

## Flags

```
--dry-run             Plan and render, change nothing
--prune               Trash pages with no source document
--blog                Publish the blog as posts, rather than the documentation
--only <prefix>       Restrict writes to pages under <prefix>
--offline             Render only; never open a session
--no-media            Skip uploads; leave image URLs as written
--root <path>         Override target.root
--base <segment>      Override target.base
--status <status>     publish, draft or private
--instance <id>       Docs plugin instance. Repeatable
--locale <code>       Locale to publish. Repeatable
--all-locales         Publish every locale the site declares
--docs-version <name> Version to publish. Repeatable
--all-versions        Publish every version
--capture <file>      Also write the site model to <file>
```

## `--dry-run`

Does everything except write: reads the site, computes the diff, renders to the output
directory, and reports. Run it before any sync you are not sure about.

## `--prune`

Without it, a page whose document you deleted stays on the site forever. With it, pages
under the documentation root that no document accounts for are moved to the **trash**.

It will not touch a page pterodocs cannot recognise as its own — a hand-written page inside
the tree is reported and left standing:

```
kept /docs/hand-written/ — not written by pterodocs
```

`--prune` is ignored when `--only` is set, because a restricted run has not seen enough of
the tree to judge what is missing.

## `--blog`

Publishes the site's blog as ordinary WordPress posts instead of publishing the
documentation. One run publishes one tree, so this is a run of its own:

```bash
pterodocs sync              # the documentation, as pages
pterodocs sync --blog       # the blog, as posts
```

It needs a [`blog`](../config/blog) section saying which category the posts are filed under.
See that page for what a post does and does not get, and why its URL is the site's to decide
rather than yours.

## `--only <prefix>`

Restricts writes to one subtree. Everything else is rendered and compared but not sent.
Useful for iterating on one section of a large documentation set.

## Two phases

WordPress's navigation block references a page by id, so ids have to exist before any body
can be rendered. A run therefore:

1. Ensures every page exists, collecting ids.
2. Renders every body against the real ids, and writes only what differs.

That is why a first run against an empty site reports both `create` and `update` for the
same pages — created in phase one, filled in in phase two.
