/**
 * Publishing pterodocs's own documentation to onyx.ac.
 *
 * Everything Docusaurus already knows — the site URL, the base URL, the route
 * base path, the locales, the markdown format, the admonition keywords — is
 * read from docusaurus.config.ts and is deliberately not repeated here.
 *
 * @type {import('pterodocs').PterodocsConfig}
 */
export default {
  site: {
    sidebars: ['docs'],
    versions: 'last',
    locales: 'default',
  },

  target: {
    type: 'wordpress',
    // The tree hangs from /products/pterodocs/docs/. Pages above the
    // documentation root are created once if missing and never edited again,
    // so /products/pterodocs is authored in WordPress as the product page.
    root: '/products/pterodocs',
    base: 'docs',
    status: 'publish',
  },

  layout: { header: true },

  render: {
    classPrefix: 'pterodocs',
    unpublishedLinks: 'site',
  },

  output: { dir: '.pterodocs' },
};
