# Changelog

## 0.5.0

### Added

- **The site's own header, above the breadcrumb.** `layout.header` puts a row
  carrying the wordmark and the menu at the top of every page. Off by default.

  The menu is not declared in pterodocs's configuration: it comes from
  `themeConfig.navbar`, the same rule sidebars and permalinks already follow, so
  the published header matches the Docusaurus site without being written twice.
  An entry naming a sidebar resolves to the page that sidebar opens on; a
  dropdown keeps its children; an entry that is a control rather than a
  destination — a search box, a locale switcher, a version dropdown — is left
  out, having no counterpart in a published page. A destination that names a
  published page becomes its WordPress URL. Anything unresolvable is reported
  rather than published as a link that goes nowhere.

  On a narrow screen the menu collapses to one control that opens a sheet, using
  the checkbox mechanics the navigation already uses, with an id of its own
  because both can be open at once.

- **A warning when a published page cannot reach itself.** WordPress resolves a
  path through its rewrite rules before it looks for a page, and any plugin may
  add a rule that claims one — a rewrite endpoint registered elsewhere on the
  site will shadow every page with that slug, answering 200 with a different
  page's content. Nothing about publishing detected that. A sync now asks the
  front end, for pages it created only, and reports `page-shadowed`. It answers
  "unknown" rather than guessing when the served page cannot be identified, and
  never fails a publish.

- **`pterodocs sync --blog` publishes the site's blog as WordPress posts.** A
  Docusaurus blog reads into the model as an instance whose single synthetic
  version has a sidebar of its posts, newest first, so the page tree, the
  reconciler and the renderer treat it exactly as they treat documentation.

  It is published as ordinary posts — the built-in type, in the site's own feed
  and RSS and categories — so nothing has to be registered and the two ends
  cannot disagree about a post type neither of them invented. The consequence
  is that a post's URL belongs to the site: it sits wherever the permalink
  structure puts it, and nothing can move it under the documentation. What can
  line the two up is the category, which is the only hierarchy a post has, so
  the posts are filed under one built from `target.root`: `/products/docstack`
  becomes Products > DocStack > Release notes. Each level is created if missing
  and matched by name within its parent.

  A post carries the date its front matter gives, sent as `date_gmt` so two
  sites in different timezones agree about the same instant. One dated ahead of
  now is scheduled rather than published, which WordPress does on its own and
  the run says out loud. Front-matter tags become real tags, existing terms
  reused and missing ones created; a tag the account cannot create is reported
  and the post goes out without it.

  Authors are read and deliberately not published. WordPress renders a byline
  itself, from the account that wrote the post, so a second one would repeat or
  contradict it — and mapping a name to a user means creating or matching
  accounts, which a publish does not do. The run says so once.

  The blog writes to `.pterodocs/blog/`, because writing the artefacts clears
  the directory they go into.

- **The plugin registers an ownership marker on published posts.** A post
  carries no generated layout to be recognised by — no navigation column, no
  breadcrumb — so without it nothing could tell later which posts in a blog
  pterodocs wrote, and `--prune` and `purge` would leave them all standing. The
  blog is not pterodocs's collection, so that marker is also the only thing
  between a prune and somebody else's writing: only marked posts are ever
  considered. WordPress ignores metadata it has no registration for rather than
  refusing it, so a run against a site without the plugin publishes perfectly
  well and stores nothing — the run checks the first write and says so.

- **pterodocs has its own documentation**, published by pterodocs, at
  `/products/pterodocs/docs/`.

### Changed

- **The WordPress plugin serves the stylesheet pterodocs publishes**, generated
  from it at build time rather than being a second design meaning to look like
  the first. The two had drifted into stacking: a site with the plugin installed
  got both, each padding a different element, so the documentation sat further
  in than the same documentation without it. The plugin keeps only what needs a
  script — the collapsible tree, the copy button, line numbers.

- **The plugin loads where its blocks are.** Its editor script was hooked
  unconditionally and loaded into every block editor on the site; and it
  injected its own navigation trigger on top of the one pterodocs writes into
  the content, giving a reader two ways to open one menu.

### Fixed

- The block theme's own `margin-top` on `#wp--skip-link--target`, and the inline
  `padding-top` on the group inside it, pushed full-width documentation down the
  page. Answering an inline style is the one thing specificity cannot do, so
  this is the single place the stylesheet uses `!important`.

- The sticky navigation had no stacking order, so it scrolled under a theme's
  own header. It takes `z-index: 999`, with the sheet's scrim raised to stay
  beneath it.

## 0.4.2

Published before it was committed, and so without an entry at the time.

### Added

- **`llms.txt` and `llms-full.txt`.** Every run writes both into the output
  directory and stores them on the documentation root page, where the WordPress
  plugin serves them from the documentation's own root —
  `/<root>/<base>/llms.txt` — rather than from the top of the domain. The root
  file is supposed to describe an entire site, pterodocs only knows about its
  own tree, and other plugins reasonably claim that path.

  They are built from what the run published, not from a Docusaurus build. That
  is what makes the links the WordPress URLs and the selection the sidebars,
  locales and versions the configuration names; a build-time plugin necessarily
  describes the Docusaurus site instead, and needs a build to have happened at
  all. The markdown copy is taken in the middle of the render, just after links
  have been pointed at the target and before the tree becomes blocks, so image
  sources resolve to their uploaded copies the same way the image blocks do.

  Configured under `llms`; `publish: false` keeps them local. A site without the
  plugin refuses the metadata, and the run reports it as a warning rather than
  failing — the pages matter more than the index. Multi-locale runs index the
  primary locale and say so.

## 0.4.1

### Fixed

- `pterodocs` declared a command called `pterodoc`, pointing at a file the
  rename had moved. npm installs that without complaint and simply creates no
  command, so 0.4.0 installed cleanly and could not be run. A test now checks
  that every declared binary points at a file that is really there, and that the
  command is named after the package.

## 0.4.0

### Changed

- Renamed to **pterodocs**. The plural reads as what it is — a documentation
  publisher — where the singular read as one document. The packages are
  `pterodocs`, `@pterodocs/core`, `@pterodocs/docusaurus` and
  `@pterodocs/wordpress`; the command is `pterodocs`; the WordPress plugin's
  slug, text domain and option key follow.

  Two things deliberately did not follow.

  The default media slug prefix stays `pterodoc`. That string is the identity of
  every file already in a site's media library — a slug is `<prefix>-<content
  hash>` — so renaming it would orphan every upload and send them all again. It
  is a key rather than branding, and nobody sees it. Set `media.slugPrefix` if
  you want it to match.

  And the old names still answer. `pterodoc.config.*` is still discovered, and
  every `PTERODOC_*` environment variable still works, each with a notice
  saying what it is called now. An existing project needs no edits beyond the
  dependency itself.

- Earlier versions are published as `pterodoc` and stop at 0.3.0.

## 0.3.0

### Added

- Documentation now looks like documentation with nothing installed. WordPress
  renders core blocks with almost no opinion, so a published page arrived as an
  unstyled outline: list markers down the navigation, a column too narrow to
  hold a word, code in the body font. Three changes fix that, and none of them
  needs a plugin.

  - A stylesheet is published with the pages (`render.styles`, `inline` by
    default). Every colour in it is mixed from `currentColor`, so it follows a
    theme into dark rather than assuming light, and every rule sits inside
    `:where()`, so a theme that has its own opinions keeps them.
  - Fences are tokenised at publish time with Prism running in Node
    (`render.highlight`, on by default). What is stored is Prism's classes,
    never colours, so the markup stays a plain core code block and the palette
    stays in CSS. It is the same vocabulary the WordPress plugin's browser-side
    Prism produces, so one set of rules dresses both.
  - The documentation layout is full width by default (`layout.align`), which
    is what it was always meant to be.

- The stylesheet is also written to `docs.css` beside the rendered pages,
  whether or not the pages carry it. Storing it on every page is what makes a
  site work with nothing installed, but it is the same few kilobytes over and
  over: pasting that file into Appearance, Customise, Additional CSS once and
  setting `render.styles` to `none` costs a minute and nothing thereafter. The
  command line says so after a render.

### Fixed

- The two columns overflowed the page. They carry inline `flex-basis` of 25% and
  75%, which together are the whole content box, so any gap pushed the document
  off the right edge — and an inline style cannot be overridden from a
  stylesheet. The root is a grid now, where `flex-basis` is inert and `1fr`
  accounts for the gap by itself. `layout.navWidth` still applies; it arrives as
  a custom property, since the inline one is ignored.
- That rule then never applied, because it was wrapped in `:where()`, which
  scores zero specificity — core's own `.wp-block-columns{display:flex}` won at
  every width. `:where()` is right wherever a theme should be able to override
  pterodoc, and wrong for the layout, which has to win.
- The navigation sheet was anchored to the top of small screens: the desktop
  sidebar sets `top`, the sheet set `bottom`, and a box with both anchors to
  `top`.

### Changed

- `layout.align` defaults to `full` rather than to no alignment, and pages now
  carry a stylesheet, so the first sync after upgrading rewrites every page.
  Set `render.styles` to `none` and `layout.align` to `''` to keep the previous
  output exactly.

## 0.2.0

### Changed

- Split into an npm workspace of four packages: `@pterodoc/core` (rendering, the site
  model, the target contract, configuration and the reconciler), `@pterodoc/docusaurus`
  (the site loader and its readers), `@pterodoc/wordpress` (the REST target) and
  `pterodoc` (the command line, the Docusaurus build plugin and the public barrel).
  The dependency graph points inwards and npm enforces it. The public surface of
  `pterodoc` is unchanged, `pterodoc/plugin` still resolves, and the goldens still match
  byte for byte.
- The site model, the page tree, the `SourceReader` contract and model capture moved out
  of the Docusaurus layer: they describe what a source produces, not how Docusaurus
  produces it. `pterodoc --model` and every fixture-driven test now resolve without
  Docusaurus in the graph at all.
- The command line and the Docusaurus plugin build the target through one
  `resolveTarget`, rather than each spelling out the same options. The plugin also
  accepts a `target` of its own.
- The version is stamped into the build instead of found by walking up the tree looking
  for a manifest, which under a workspace would have found the wrong one and silently
  reported `0.0.0`.
- Installing from a git URL is no longer supported; install `pterodoc` from npm.

### Added

- A WordPress plugin, in `packages/wordpress/plugin`, that turns the pages
  pterodoc publishes into a documentation experience: a full-width layout with
  prose kept to a comfortable measure while code and tables run to the column
  edge, syntax highlighting and a copy button, a sidebar that collapses to the
  section being read and scrolls on its own, a bottom sheet or drawer on small
  screens, and tables that scroll inside their own keyboard-reachable region.

  It registers no block types. Everything is layered over the core blocks
  pterodoc already writes, through `render_block` filters, one stylesheet and one
  script — so deactivating it leaves documentation that is still readable and
  still navigable. Site-wide defaults live on a settings page; any single block
  can override them from the block inspector.

  Its design is built on the block supports rather than around them. Every token
  resolves through a theme's own global-styles variables first, syntax colours
  are derived with `color-mix` from the code block's resolved colours so a
  palette choice repaints them to match, the gutter is padding on the column
  rather than on any block so `spacing` composes, and every default sits inside
  `:where()` so anything set in the inspector wins. There is no `!important` in
  the stylesheet.

- `render.blocks`, either `'core'` (the default, and byte-for-byte what pterodoc
  emitted before) or `'plugin'`. The second carries instructions the plugin can
  act on in block-comment attributes only, never in markup, so WordPress stores
  the same content either way and the editor has nothing to object to.

- Highlighted line ranges survive when `render.blocks` is `'plugin'`. A
  `{1,3-5}` on a fence had no core equivalent and was reported as dropped; it is
  now carried and rendered.

- `pterodoc doctor` reports whether the plugin is installed, and warns when its
  class prefix disagrees with `render.classPrefix` — a mismatch that otherwise
  publishes cleanly, loads cleanly and silently styles nothing.

### Fixed

- `pterodoc/plugin` shipped an `exports` entry pointing at a declaration file that is not
  where tsc emits one, so the subpath resolved to `any` for every consumer.
- `@types/mdast`, `@types/hast` and `@types/github-slugger` were development
  dependencies, but the emitted declarations refer to those types; they are now real
  dependencies of `@pterodoc/core`.
- The fake WordPress used by the tests set `title` twice in one object literal, so the
  first was always dead. Typechecking the test suites, which nothing did before, found
  it.
- Six tests asserted POSIX absolute paths and could not pass on Windows, where
  `path.resolve` prepends the drive letter. They now build their fixtures with `path`.

### Removed

- `remark-emoji`, which was declared as a dependency and never imported.

## 0.1.0

### Added
- Project skeleton: TypeScript sources, a Rollup build emitting `lib/`, declarations from
  `tsc`, and a `prepare` script so the package can be consumed straight from git.
- Errors and exit codes, structured issues, path, hash and media-type helpers.
- The renderer: markdown to Gutenberg blocks, with a configurable class prefix and string
  table so the output is not tied to one site's theme. Verified byte-identical to the
  DocStack script it was extracted from on a shared fixture.

- The site model, read from Docusaurus itself through its own site loader: resolved
  sidebars with autogenerated entries already expanded, versions, locales, permalinks,
  draft and unlisted flags, and previous/next links. pterodoc never walks a docs
  directory or parses a sidebar file.
- The page tree, ordered by the sidebar, with directory pages named by their category.
- Model capture, so a site can be rendered without Docusaurus and a bug can be reported
  reproducibly.

- The WordPress target: page creation and updates identified by parent and slug, so a
  re-run rewrites only what differs; media upload keyed by content hash; pruning that
  trashes rather than deletes.
- The reconciler, the configuration file and the command line (`sync`, `render`,
  `doctor`, `capture`, `init`), with rendered pages, a manifest and a plan written for
  every run.

- MDX: imports and comments are removed, `Tabs` and `TabItem` become collapsible
  sections that need no script, `Details`, `CodeBlock` and `Admonition` become their
  block equivalents, and plain HTML is carried through. A component or an expression
  with no equivalent is reported with its file, line and column rather than dropped.

- Images: references are found wherever they sit, resolved against the document, the
  localised copy, the static directories or `@site/`, uploaded to the media library and
  rewritten. A file is identified by the hash of its contents, carried in its media slug,
  so a fresh checkout never uploads anything twice.
- Versions and locales, each published into its own subtree with its own navigation.
- A Docusaurus plugin, for a site that would rather publish from `postBuild`.

### Fixed
Carried over from the original script, each with a test:
- Reference-style links (`[text][ref]`) resolve instead of printing as literal text, and
  the definitions no longer appear on the page.
- Images are found wherever they sit, so a standalone image becomes an image block and an
  inline one stays inline. Their URLs and alt text are escaped.
- Shortcode brackets are escaped on the tree rather than by pattern-matching the HTML, so
  a `>` inside an attribute no longer confuses the escaper.
- A leading H1 is recognised as the title even when a comment precedes it.
- Code fences keep their `title` and `showLineNumbers`; a dropped highlight range is
  reported rather than lost in silence.
