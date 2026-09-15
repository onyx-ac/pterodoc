---
title: blog
description: Publishing the site's blog as WordPress posts, filed under a category that lines up with the documentation.
---

# `blog`

A Docusaurus site's blog — release notes, announcements, whatever you write there — published
as ordinary WordPress posts.

```js
blog: {
  category: 'Release notes',
}
```

Then:

```bash
pterodocs sync --blog
```

Without `--blog`, this section is ignored entirely and the run publishes documentation as
usual. One run publishes one tree.

## Posts, not pages

Documentation is published as **pages**, because documentation is what a page is:
hierarchical, ordered by hand, part of the site's own structure. A blog post is none of
those. It is dated, it accumulates, and it belongs in the site's feed and RSS alongside
everything else written there — so it is published as a **post**, the type WordPress already
has.

Nothing is registered for this. The post type, the archive, the feed, the categories and the
tags are all WordPress's own, which means there is no configuration the two ends can disagree
about.

## Their URLs are the site's, not yours

This is the one thing to understand before you run it.

A post sits wherever **Settings → Permalinks** puts it. Nothing pterodocs can do will move it
under `/products/yourproduct/`, because that is not how WordPress addresses posts. So a
release note published from a site whose documentation is at `/products/docstack/docs/` will
have a URL like:

```
https://example.com/2026/09/docstack-client-0-3-0/
```

What *can* line the two up is the category, which is the only hierarchy a post has.

## The category

The posts are filed under a category built from `target.root` plus the name you give:

```js
target: { root: '/products/docstack', base: 'docs' },
blog:   { category: 'Release notes' },
```

```
Products
└─ Docstack
     └─ Release notes   ← every post filed here
```

Each level is created if it does not exist, once per run, and matched by name within its
parent — so two products may both have a `Release notes` under them without colliding.

`category` has no default. A run that does not say where the posts go is refused rather than
guessing, because filing somebody's writing in a category they did not choose is not a good
default.

### When the paths are not the category names

`target.root` is slugs, so `docstack` becomes `Docstack`. Name the path outright when that is
not what the category is called:

```js
blog: { categoryPath: ['Products', 'DocStack', 'Release notes'] },
```

Given `categoryPath`, `category` is ignored and `target.root` is not consulted.

## Linking readers to them

Because a post's URL belongs to the site, there is no single path that means "the release
notes" — one post's address tells you nothing about where the next one is. The **category
archive** is the only address that does, and the run prints it when it finishes:

```
The posts are listed at https://example.com/topics/products/docstack/release-notes/
Point your Docusaurus navbar entry there to send readers to these rather than to the
Docusaurus blog.
```

`topics` there is the site's own category base, from **Settings → Permalinks**; yours may be
`category` or something else. WordPress includes child categories in an archive, so a parent
lists everything below it too — `/topics/products/docstack/` shows the release notes as well.

That link is the one manual step. Your Docusaurus navbar almost certainly points at your own
blog:

```ts
{ to: '/blog', label: 'Releases', position: 'left' },
```

pterodocs reads `docusaurus.config.ts` and never writes to it, so it cannot repoint that entry
for you — and it should not guess, because the entry is right for the Docusaurus site and only
wrong for the published one. Change it yourself when you want readers sent to WordPress:

```ts
{ href: 'https://example.com/topics/products/docstack/release-notes/', label: 'Releases', position: 'left' },
```

An entry that already names a host is published exactly as written, so this survives every
subsequent sync.

## Tags

A post's front-matter tags become real WordPress tags:

```yaml
---
title: '@docstack/client 0.3.0'
tags: [release, client]
---
```

An existing tag is reused; a missing one is created. Turn it off with `tags: false`.

If the account running the sync cannot create terms, the tag it could not add is reported and
the post is published without it. The publish is not failed over a tag.

## Authors

They are **not** published. WordPress renders a post's byline itself, from the account that
wrote it, so publishing a second one would either repeat what the theme already shows or
contradict it. Mapping a name in your front matter to a WordPress user means creating or
matching accounts, which a publish should not do on its own.

Every post is therefore attributed to the account whose Application Password ran the sync,
and the run says so once when your source names authors.

## What a post does not get

A post is a body. The layout is forced to a single column with no navigation column, no
breadcrumb, no pagination and no child index — there is no tree beside it to navigate and no
siblings to page through. The site's own theme provides the header and the rest.

Override any of it under `blog.layout` if your theme wants something else:

```js
blog: {
  category: 'Release notes',
  layout: { header: true },
}
```

`layout.nav: 'page-list'` is refused. The block lists the children of a page id, a post has no
page to list from, and WordPress reads a missing one as the site root — so it would publish a
list of every page on your site.

## Dates

A post carries the date its front matter gives, sent as `date_gmt` so two sites in different
timezones agree about the same moment.

A post dated ahead of now is **scheduled**, not published: WordPress holds it until the date
arrives, which is what you want and not what "published" usually sounds like, so the run says
so. It is not a difference to be corrected on the next run either.

## Output

A blog run writes to a subdirectory of its own:

```
.pterodocs/blog/
```

Writing the artefacts clears the directory they go into, so sharing one with the documentation
would mean whichever run went second destroyed the other's output.

`llms.txt` is not written for a blog. It describes a documentation set and is stored on the
tree's root page, which this tree does not have.

## The plugin

Publishing posts needs [the WordPress plugin](../plugin/index.md) at **0.5.0 or newer**. It
registers the metadata key that marks a post as one pterodocs wrote.

That marker is not decoration. A post carries no generated layout to be recognised by, so
without it nothing can tell later which posts in your blog came from your repository — and
`--prune` and `purge` would leave them all standing. WordPress ignores metadata it has no
registration for rather than refusing it, so a run against a site without the plugin publishes
perfectly well and stores nothing. The run checks, and says so.

## Pruning

`--prune` trashes posts pterodocs published that no longer have a source document.

Your blog is not pterodocs's collection — the site's own posts live there too — so the
ownership marker is the only thing between a prune and somebody else's writing. Only marked
posts are ever considered, and each one is read and checked before it goes. Nothing is
deleted; it goes to the trash.

## Reference

| | |
|---|---|
| `category` | What the posts' own category is called. Required, unless `categoryPath` is given. |
| `categoryPath` | The full category path, outermost first, when it should not follow `target.root`. |
| `instance` | Which blog instance to publish. Only needed when the site has more than one. |
| `tags` | Publish the posts' tags. `true` by default. |
| `status` | `publish`, `draft` or `private`. Defaults to `target.status`. |
| `template` | Template slug. None by default. |
| `layout` | Layout overrides, merged over the single-column default. |
| `out` | Output subdirectory below `output.dir`. `blog` by default. |
