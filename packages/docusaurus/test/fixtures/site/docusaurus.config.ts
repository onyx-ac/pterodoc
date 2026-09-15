import type { Config } from '@docusaurus/types';

/**
 * A minimal but real Docusaurus site.
 *
 * It exists so one test loads pterodocs's model through Docusaurus itself,
 * which is the part of this tool that no captured fixture can prove.
 */
const config: Config = {
  title: 'Fixture Site',
  url: 'https://fixture.test',
  baseUrl: '/base/',
  onBrokenLinks: 'ignore',
  onBrokenMarkdownLinks: 'ignore',
  markdown: { format: 'detect' },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  themeConfig: {
    navbar: {
      title: 'Fixture',
      items: [
        { type: 'docSidebar', sidebarId: 'main', position: 'left', label: 'Docs' },
        {
          type: 'dropdown',
          label: 'More',
          position: 'left',
          items: [
            { to: '/news', label: 'Release notes' },
            { href: 'https://example.test/spec', label: 'Spec' },
          ],
        },
        // A control rather than a link: it has no counterpart in a page.
        { type: 'search', position: 'right' },
        { href: 'https://example.test/repo', label: 'Repository', position: 'right' },
      ],
    },
  },

  presets: [
    [
      'classic',
      {
        docs: { sidebarPath: './sidebars.ts', routeBasePath: 'documentation' },
        blog: { routeBasePath: 'news', blogTitle: 'Release notes', authorsMapPath: './authors.yml' },
        pages: false,
        theme: {},
      },
    ],
  ],
};

export default config;
