/**
 * The stylesheet published with the documentation.
 *
 * WordPress renders core blocks with almost no opinion, so documentation that
 * ships as core blocks and nothing else arrives looking like an unstyled
 * outline: list markers down the navigation, a column too narrow to hold a
 * word, code in the body font. Anything that fixes that has to travel with the
 * content, because a site that has installed nothing has nowhere else to put it.
 *
 * Structure that core blocks can express stays in block attributes, where the
 * editor can see it: the layout's full-width alignment is one. Everything below
 * is what an attribute cannot reach — list markers, a sticky column, a scroll
 * container, and colour that has to adapt to a theme this code has never seen.
 * Emitting the rest as `style` attributes was considered and rejected: each one
 * must byte-match what the block's own save function would have written, or the
 * editor reports every block as corrupt.
 *
 * Every colour is mixed from `currentColor`, so the result follows whatever the
 * theme paints its text and never assumes light or dark. Every rule is wrapped
 * in `:where()`, so a theme that does have opinions keeps them.
 */

import type { Theme } from './theme';

/**
 * The stylesheet, with `{p}` standing in for the class prefix.
 *
 * Written compactly on purpose: it is stored on every page, so a kilobyte here
 * is a kilobyte times the size of the documentation.
 */
const TEMPLATE = `
:where(.{p}-docs){--{p}-gutter:clamp(1rem,4vw,2rem);--{p}-measure:var(--wp--style--global--content-size,46rem);--{p}-rule:color-mix(in oklab,currentColor 14%,transparent);--{p}-muted:color-mix(in oklab,currentColor 62%,transparent);--{p}-surface:color-mix(in oklab,currentColor 5%,transparent);--{p}-surface-solid:var(--wp--preset--color--base,Canvas);--{p}-radius:8px;--{p}-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.wp-block-columns.{p}-docs{display:grid;grid-template-columns:minmax(0,min(var(--{p}-nav-width,25%),20rem)) minmax(0,1fr);gap:clamp(1.5rem,4vw,3rem);align-items:start;padding-inline:var(--wp--style--root--padding-left,var(--{p}-gutter)) var(--wp--style--root--padding-right,var(--{p}-gutter))}
/* The block theme's own main container, when it is holding documentation.

   A theme writes both of these as inline styles on the elements themselves --
   a margin-top on the container, a padding-top on the group inside it -- to sit
   the page's content below the header. Documentation is full width and brings
   its own spacing, so that gap only pushes it down the page.

   This is the one place the stylesheet says !important, and an inline style is
   the reason: no amount of specificity beats one. The :has() keeps it to pages
   that actually carry documentation, so nothing else on the site is touched,
   and a browser without :has() simply keeps the theme's spacing. */
#wp--skip-link--target:has(.{p}-docs){margin-top:0 !important}
#wp--skip-link--target:has(.{p}-docs)>.wp-block-group[style*="padding-top"]{padding-top:var(--wp--preset--spacing--30,1rem) !important}

:where(.{p}-docs-main){min-width:0}
:where(.{p}-docs-main)>*{max-width:var(--{p}-measure)}
:where(.{p}-docs-main)>.wp-block-code,:where(.{p}-docs-main)>.wp-block-table,:where(.{p}-docs-main)>figure{max-width:none}

/* The control that opens the navigation. Off-screen rather than display:none,
   so it stays reachable from a keyboard, and never shown on a wide screen where
   the navigation is always open. */
:where(.{p}-docs-toggle){position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
:where(.{p}-docs-toggle-label),:where(.{p}-docs-scrim){display:none}
:where(.{p}-docs-bar)>*{margin-block:0}

/* Navigation. The list markers and the cramped column are the two things that
   make an unstyled docs page unreadable. */
:where(.{p}-docs-nav){min-width:0;position:sticky;top:2rem;z-index:999;max-height:calc(100vh - 4rem);max-height:calc(100dvh - 4rem);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
:where(.{p}-docs-nav) ul{list-style:none;margin:0;padding-inline-start:0}
:where(.{p}-docs-nav) li{margin:0}
:where(.{p}-docs-nav) ul ul{margin-inline-start:.75em;padding-inline-start:.75em;border-inline-start:1px solid var(--{p}-rule)}
:where(.{p}-docs-nav) a{display:block;padding:.25rem .5rem;border-radius:6px;color:inherit;text-decoration:none;font-size:.9375em;line-height:1.5}
:where(.{p}-docs-nav) a:hover{background:var(--{p}-surface)}
:where(.{p}-docs-nav) .current-menu-item>a{background:color-mix(in oklab,currentColor 10%,transparent);font-weight:600}

/* The site's own header, above the breadcrumb row. The control that opens it
   is off-screen rather than display:none, so a keyboard can still reach it. */
:where(.{p}-docs-header){display:flex;align-items:center;gap:1rem;padding-block:.6rem;border-bottom:1px solid var(--{p}-rule)}
:where(.{p}-docs-header-title){flex:0 0 auto;font-weight:700}
:where(.{p}-docs-header-title) a{color:inherit;text-decoration:none}
.{p}-docs-header-check{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
:where(.{p}-docs-header-label),:where(.{p}-docs-header-scrim){display:none}
:where(.{p}-docs-header-nav){flex:1 1 auto;display:flex;align-items:center;gap:.5rem}
:where(.{p}-docs-header-start),:where(.{p}-docs-header-end){display:flex;align-items:center;gap:.15rem;margin:0;padding:0;list-style:none}
:where(.{p}-docs-header-end){margin-inline-start:auto}
:where(.{p}-docs-header-nav) li{margin:0}
:where(.{p}-docs-header-nav) :is(a,span){display:block;padding:.3rem .55rem;border-radius:6px;color:inherit;text-decoration:none;font-size:.9375em;white-space:nowrap}
:where(.{p}-docs-header-nav) a:hover{background:var(--{p}-surface)}

/* A dropdown is a nested list. It opens on hover and on focus, both from here,
   so it needs no script and stays reachable from a keyboard. */
.{p}-docs-header-group{position:relative}
.{p}-docs-header-menu{display:none;position:absolute;inset-inline-start:0;top:100%;z-index:1000;min-width:12rem;margin:0;padding:.25rem;list-style:none;background:var(--{p}-surface-solid);border:1px solid var(--{p}-rule);border-radius:var(--{p}-radius);box-shadow:0 6px 24px color-mix(in oklab,#000 12%,transparent)}
.{p}-docs-header-group:is(:hover,:focus-within)>.{p}-docs-header-menu{display:block}

/* Code. */
:where(.{p}-docs-main) .wp-block-code{background:var(--{p}-surface);border:1px solid var(--{p}-rule);border-radius:var(--{p}-radius);padding:1rem 1.15rem;overflow-x:auto;font-family:var(--{p}-mono);font-size:.875em;line-height:1.6;tab-size:2}
:where(.{p}-docs-main) .wp-block-code code{font-family:inherit;white-space:pre}

:where(.{p}-code-title){margin-bottom:0;font-size:.8125em;color:var(--{p}-muted);font-family:var(--{p}-mono)}

/* Syntax tokens. Prism tokenises at publish time and emits these classes; the
   colours live here, so changing them is a CSS edit rather than a republication.
   Every one is mixed from currentColor, so it follows the theme into dark. */
:where(.{p}-docs-main) .token{color:inherit}
:where(.{p}-docs-main) :is(.token.comment,.token.prolog,.token.cdata){color:color-mix(in oklab,currentColor 50%,transparent);font-style:italic}
:where(.{p}-docs-main) :is(.token.punctuation,.token.operator){color:color-mix(in oklab,currentColor 70%,transparent)}
:where(.{p}-docs-main) :is(.token.keyword,.token.atrule,.token.rule,.token.important){color:color-mix(in oklab,#7c4dff 70%,currentColor);font-weight:600}
:where(.{p}-docs-main) :is(.token.string,.token.char,.token.attr-value,.token.regex){color:color-mix(in oklab,#1a7f5a 70%,currentColor)}
:where(.{p}-docs-main) :is(.token.number,.token.boolean,.token.constant,.token.symbol){color:color-mix(in oklab,#b34700 70%,currentColor)}
:where(.{p}-docs-main) :is(.token.function,.token.class-name,.token.builtin){color:color-mix(in oklab,#0b6bcb 70%,currentColor)}
:where(.{p}-docs-main) :is(.token.tag,.token.selector,.token.attr-name,.token.property){color:color-mix(in oklab,#1a7f5a 60%,currentColor)}
:where(.{p}-docs-main) .token.deleted{color:color-mix(in oklab,#c62828 75%,currentColor)}
:where(.{p}-docs-main) .token.inserted{color:color-mix(in oklab,#1a7f5a 75%,currentColor)}
:where(.{p}-docs-main) .token.bold{font-weight:700}
:where(.{p}-docs-main) .token.italic{font-style:italic}

/* Tables scroll rather than overflow the page. */
:where(.{p}-docs-main) .wp-block-table{overflow-x:auto;overscroll-behavior-inline:contain}
:where(.{p}-docs-main) .wp-block-table table{border-collapse:collapse;width:100%}
:where(.{p}-docs-main) .wp-block-table :is(th,td){padding:.5rem .75rem;border:0;border-bottom:1px solid var(--{p}-rule);text-align:start;vertical-align:top}
:where(.{p}-docs-main) .wp-block-table thead th{white-space:nowrap;font-weight:600}

:where(.{p}-docs-breadcrumb){font-size:.875em;color:var(--{p}-muted)}
:where(.{p}-docs-breadcrumb) p{margin:0}
:where(.{p}-docs-breadcrumb) a{color:inherit;text-decoration:none}
:where(.{p}-docs-breadcrumb) a:hover{text-decoration:underline}

:where(.{p}-docs-pagination){display:flex;gap:1rem;justify-content:space-between;margin-top:2.5rem;padding-top:1.25rem;border-top:1px solid var(--{p}-rule)}
:where(.{p}-docs-pagination) p{margin:0}
:where(.{p}-docs-pagination-next){margin-inline-start:auto;text-align:end}

:where(.{p}-docs-index) li{margin-block:.25rem}
:where(.{p}-docs-index-heading){margin-top:2.5rem}

:where(.{p}-admonition){padding:.85rem 1.1rem;border-inline-start:3px solid var(--{p}-rule);border-radius:0 var(--{p}-radius) var(--{p}-radius) 0;background:var(--{p}-surface)}
:where(.{p}-admonition)>*{margin-block:.35rem}
:where(.{p}-admonition-title){font-weight:600}

:where(.{p}-version-banner){padding:.75rem 1rem;border:1px solid var(--{p}-rule);border-radius:var(--{p}-radius);background:var(--{p}-surface);font-size:.9375em}

/* One column once there is no room for two.
 *
 * Everything below is behind :has(), and deliberately. A browser without it
 * matches none of these rules, so the navigation simply renders in the flow
 * where it already is: smaller, but never broken. It is also what lets the
 * control live in the other column from the list it opens.
 */
@media (max-width:781.98px){
.wp-block-columns.{p}-docs{display:block}

/* The bar: where you are, and the way in. Fixed, so both stay reachable. */
/* The menu becomes one control, and a sheet -- the same checkbox mechanics the
   navigation uses, with an id of its own because both can be open at once. */
.{p}-docs-header-label{display:inline-flex;align-items:center;gap:.5rem;margin-inline-start:auto;flex:0 0 auto;padding:.4rem .7rem;border:1px solid var(--{p}-rule);border-radius:999px;font-size:.9375em;cursor:pointer;user-select:none}
.{p}-docs-header-icon{position:relative;width:1rem;height:2px;background:currentColor;box-shadow:0 -5px 0 currentColor,0 5px 0 currentColor}
.{p}-docs-header-nav{position:fixed;inset-inline:0;top:auto;bottom:0;z-index:999;display:block;max-height:min(80vh,44rem);max-height:min(80dvh,44rem);overflow-y:auto;overscroll-behavior:contain;padding:1.25rem var(--{p}-gutter) calc(1.25rem + env(safe-area-inset-bottom));background:var(--{p}-surface-solid);border-top:1px solid var(--{p}-rule);border-radius:16px 16px 0 0;box-shadow:0 -8px 32px color-mix(in oklab,#000 22%,transparent);transform:translateY(101%);visibility:hidden;transition:transform .24s cubic-bezier(.2,0,0,1),visibility .24s}
.{p}-docs-header-start,.{p}-docs-header-end{display:block;margin:0}
.{p}-docs-header-end{margin-inline-start:0}
.{p}-docs-header-nav :is(a,span){padding:.5rem .25rem;font-size:1em}
/* Nested entries are simply open: there is room, and a hover menu is no use here. */
.{p}-docs-header-menu{display:block;position:static;min-width:0;margin-inline-start:.75rem;padding:0;border:0;border-radius:0;background:none;box-shadow:none}
.{p}-docs-header-check:checked~.{p}-docs-header-nav{transform:none;visibility:visible}
.{p}-docs-header-check:checked~.{p}-docs-header-scrim{display:block;position:fixed;inset:0;z-index:998;background:color-mix(in oklab,#000 45%,transparent);cursor:pointer}

.{p}-docs:has(.{p}-docs-toggle) .{p}-docs-bar{position:sticky;top:0;z-index:30;margin-inline:calc(-1 * var(--{p}-gutter));display:flex;align-items:center;gap:.75rem;min-height:3.25rem;padding:.5rem clamp(.75rem,4vw,1.25rem);background:var(--{p}-surface-solid,Canvas);border-bottom:1px solid var(--{p}-rule)}
.{p}-docs:has(.{p}-docs-toggle) .{p}-docs-bar .{p}-docs-breadcrumb{min-width:0;overflow-x:auto;overscroll-behavior-inline:contain;scrollbar-width:none;white-space:nowrap}
.{p}-docs:has(.{p}-docs-toggle) .{p}-docs-bar .{p}-docs-breadcrumb::-webkit-scrollbar{display:none}

.{p}-docs-toggle-label{display:inline-flex;align-items:center;gap:.5rem;flex:0 0 auto;padding:.4rem .75rem;border:1px solid var(--{p}-rule);border-radius:999px;font-size:.9375em;cursor:pointer;user-select:none}
.{p}-docs-toggle:focus-visible+.{p}-docs-toggle-label{outline:2px solid currentColor;outline-offset:2px}

/* Three bars, and they stay three bars. Morphing them into a cross would be
   telling the reader how to close something they can no longer see: the sheet
   is tall, and the pill is behind it. The close affordance belongs on the
   backdrop, where the dismissing interaction already lives. */
.{p}-docs-toggle-icon{position:relative;display:inline-block;width:1rem;height:.75rem;background:linear-gradient(currentColor,currentColor) center/100% 2px no-repeat}
.{p}-docs-toggle-icon::before,.{p}-docs-toggle-icon::after{content:"";position:absolute;inset-inline:0;height:2px;background:currentColor}
.{p}-docs-toggle-icon::before{top:0}
.{p}-docs-toggle-icon::after{top:calc(100% - 2px)}

/* The pill still answers to being touched. */
.{p}-docs-toggle-label{transition:background-color .15s,border-color .15s}
.{p}-docs-toggle-label:hover{background:var(--{p}-surface);border-color:var(--{p}-rule)}
.{p}-docs-toggle-label:active{background:color-mix(in oklab,currentColor 12%,transparent)}
.{p}-docs-toggle:checked+.{p}-docs-toggle-label{background:var(--{p}-surface)}

/* The sheet. It covers rather than pushes, so the document keeps its place. */
.{p}-docs:has(.{p}-docs-toggle) .{p}-docs-nav{position:fixed;inset-inline:0;top:auto;bottom:0;z-index:999;max-width:none;max-height:min(88vh,52rem);max-height:min(88dvh,52rem);margin:0;padding:1rem clamp(.75rem,4vw,1.25rem) calc(1rem + env(safe-area-inset-bottom));overflow-y:auto;overscroll-behavior:contain;background:var(--{p}-surface-solid,Canvas);border-top:1px solid var(--{p}-rule);border-radius:1rem 1rem 0 0;box-shadow:0 -8px 40px color-mix(in oklab,currentColor 22%,transparent);transform:translateY(101%);visibility:hidden;transition:transform .22s cubic-bezier(.2,0,0,1),visibility 0s linear .22s}
.{p}-docs:has(.{p}-docs-toggle:checked) .{p}-docs-nav{transform:none;visibility:visible;transition-delay:0s}

/* A grab handle, so it reads as a sheet. */
.{p}-docs:has(.{p}-docs-toggle) .{p}-docs-nav::before{content:"";display:block;width:2.5rem;height:.25rem;margin:-.25rem auto .75rem;border-radius:999px;background:var(--{p}-rule)}

/* Closing from outside: a second label over the page, for the same checkbox. */
/* A dark veil rather than one mixed from the text colour, so the cross drawn on
   it is legible whichever way the theme runs. */
.{p}-docs:has(.{p}-docs-toggle:checked) .{p}-docs-scrim{display:block;position:fixed;inset:0;z-index:998;background:color-mix(in oklab,#000 45%,transparent);cursor:pointer}
.{p}-docs-scrim::before,.{p}-docs-scrim::after{content:"";position:absolute;top:1.5rem;inset-inline-end:1.5rem;width:1.5rem;height:2px;border-radius:2px;background:#fff;opacity:.9}
.{p}-docs-scrim::before{transform:rotate(45deg)}
.{p}-docs-scrim::after{transform:rotate(-45deg)}

@media (prefers-reduced-motion:reduce){
.{p}-docs:has(.{p}-docs-toggle) .{p}-docs-nav{transition:none}
.{p}-docs-toggle-label{transition:none}
}
}
`;

/**
 * Build the stylesheet for one run.
 *
 * @param theme The class prefix and strings in force.
 * @returns CSS, with the run's own class prefix substituted in.
 */
/**
 * The stylesheet before a prefix is put into it.
 *
 * Exported for one reader: the WordPress plugin's build, which writes this out
 * so the plugin can serve the same design site-wide instead of every page
 * carrying a copy. Two stylesheets meaning to look alike drift; one does not.
 */
export const STYLESHEET_TEMPLATE = TEMPLATE;

export function stylesheetFor(theme: Theme, options: { navWidth?: string } = {}): string {
  const css = TEMPLATE.replace(/\{p\}/g, theme.classPrefix).trim();

  // The columns carry the configured width as an inline `flex-basis`, which a
  // grid ignores. Handing it over as a custom property is what keeps the
  // setting meaningful.
  const width = options.navWidth;
  if (!width || !/^[0-9a-zA-Z%.()\s+*/-]+$/.test(width)) return css;

  return `:where(.${theme.classPrefix}-docs){--${theme.classPrefix}-nav-width:${width}}
${css}`;
}

/**
 * How the stylesheet reaches the page.
 *
 * `inline` stores it with each page, which is the only place a site that has
 * installed nothing can read it from. `none` writes no styles at all, for a
 * site whose theme already dresses these class names, or one running the
 * pterodocs WordPress plugin, which brings its own and a good deal more.
 */
export type StylePolicy = 'inline' | 'none';
