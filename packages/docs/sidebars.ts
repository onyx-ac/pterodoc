import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

/**
 * One hand-written sidebar.
 *
 * pterodocs publishes what a sidebar reaches, in the order the sidebar gives,
 * so this file is also the shape of the published page tree on WordPress.
 */
const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    {
      type: 'category',
      label: 'Get started',
      link: { type: 'doc', id: 'get-started/index' },
      items: ['get-started/install', 'get-started/first-sync', 'get-started/credentials'],
    },
    {
      type: 'category',
      label: 'Configuration',
      link: { type: 'doc', id: 'config/index' },
      items: ['config/site', 'config/target', 'config/layout', 'config/render', 'config/blog', 'config/llms'],
    },
    {
      type: 'category',
      label: 'Commands',
      link: { type: 'doc', id: 'commands/index' },
      items: ['commands/sync', 'commands/render', 'commands/doctor', 'commands/capture', 'commands/purge', 'commands/init'],
    },
    {
      type: 'category',
      label: 'How it works',
      link: { type: 'doc', id: 'concepts/index' },
      items: ['concepts/page-tree', 'concepts/identity', 'concepts/prune-and-purge'],
    },
    {
      type: 'category',
      label: 'The WordPress plugin',
      link: { type: 'doc', id: 'plugin/index' },
      items: ['plugin/settings', 'plugin/llms-txt'],
    },
  ],
};

export default sidebars;
