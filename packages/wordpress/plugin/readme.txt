=== pterodocs ===
Contributors: onyxac
Tags: documentation, docusaurus, gutenberg, syntax highlighting, docs
Requires at least: 6.5
Tested up to: 6.7
Requires PHP: 8.0
Stable tag: 0.5.0
License: CC-BY-SA-4.0
License URI: https://creativecommons.org/licenses/by-sa/4.0/

Turns documentation published by pterodocs into a documentation experience: a
collapsible sidebar, highlighted code with a copy button, scrolling tables and a
full-width layout, all drawn from your theme's own palette.

== Description ==

[pterodocs](https://github.com/onyx-ac/pterodocs) publishes a Docusaurus site to
WordPress as ordinary Gutenberg blocks. This plugin makes those pages look and
behave like documentation.

It registers **no block types**. Everything it does is layered over the core
blocks pterodocs already writes, which has one consequence worth stating plainly:
deactivate the plugin and your documentation is still there, still readable and
still navigable. Nothing is stored in a format only this plugin understands.

What it adds:

* A full-width layout, applied with your theme's own alignment classes rather
  than by overriding its CSS.
* Prose kept to a comfortable measure, while code blocks and tables run out to
  the full width of the column.
* Syntax highlighting, from the language your fences already declare. Only the
  languages a page actually uses are loaded.
* A copy button on every code block, rendered server-side so it never shifts
  the layout.
* A sidebar that collapses to the section you are reading, sticks while the page
  scrolls, and scrolls on its own when it is taller than the space it has.
* On small screens, a bottom sheet or a side drawer, with a focus trap, an
  escape key and drag-to-dismiss.
* Tables that scroll sideways inside their own keyboard-reachable region.
* A breadcrumb separator you can change without re-publishing anything.

= Built on the blocks, not over them =

`core/code` and `core/page-list` already carry WordPress's colour, border,
spacing and typography supports — the same panels `core/group` has. This plugin
is written so those controls actually drive the design: every colour is derived
with `color-mix` from the block's own resolved colours, so painting a code block
from your palette repaints its syntax colours to match, and every default sits
inside `:where()`, so anything you set in the inspector wins. There is no
`!important` in the stylesheet.

Tokens resolve through your theme's global styles first — palette, spacing
scale, content width, root padding — so a theme change moves the documentation
with it.

= llms.txt =

pterodocs builds an `llms.txt` and an `llms-full.txt` for the documentation it
publishes and stores them on the documentation root page. This plugin serves
them, from the documentation's own root:

  https://example.com/docs/llms.txt
  https://example.com/docs/llms-full.txt

Not from the top of the domain. That file is meant to describe everything a site
publishes, and the documentation is one part of a site — so serving a subtree
from a path that promises the whole thing would be wrong, and would fight any
SEO plugin that generates one. Documentation pages carry a link element pointing
at the real location, and robots.txt gets a comment naming it.

Nothing appears until a sync has run: the plugin serves what pterodocs stored,
and 404s exactly as WordPress would otherwise when there is nothing there.

= Settings =

Settings, pterodocs. Every setting is a default that a single block can override
from the block inspector.

== Frequently Asked Questions ==

= Do my per-block overrides survive a re-sync? =

No, and this is worth understanding. pterodocs rewrites a page's content every
time it publishes, so an override set on a block in the WordPress editor is
replaced on the next sync. The durable places for a setting are this plugin's
settings page, which a sync never touches, and your pterodocs configuration,
which writes the value into the content itself.

= I set a custom class prefix in pterodocs. Does this still work? =

Yes. Set the same prefix under Settings, pterodocs. Nothing needs re-publishing.

= Why is there no theme for the syntax highlighting? =

Because a fixed theme would fight the block's own colours. Token colours are
derived from whatever the code block is painted, so they stay legible on a
background you chose from your palette.

= Where is my llms.txt? =

At the documentation root, not the site root: /your-docs-path/llms.txt. It
appears once pterodocs has synced with this plugin active — the sync stores it,
the plugin serves it. If a sync reported that the site refused the metadata, the
plugin was not active when it ran.

= Does it work without JavaScript? =

Mostly. The server decides which sidebar branches are open, so the tree renders
correctly and every link works. What needs script is the buttons that expand and
collapse branches, the sheet on small screens, and the copy button — and the
sheet's trigger is not shown at all unless the script is running.

== Installation ==

1. Upload the plugin folder to `/wp-content/plugins/`, or install the zip from
   Plugins, Add New, Upload Plugin.
2. Activate it.
3. Visit Settings, pterodocs if you want to change any default.

== Build ==

The plugin ships as source: the JavaScript is written against the `wp.*` globals
with `wp.element.createElement` rather than JSX, so no bundler is involved and
every shipped file is the file that was written.

The one third-party component is Prism, which is copied unmodified from the
`prismjs` npm package by `npm run vendor` in the plugin directory. Without that
step the plugin works and simply does not highlight.

== Changelog ==

= 0.4.1 =
* First release.
