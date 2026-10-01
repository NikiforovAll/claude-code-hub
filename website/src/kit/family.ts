export type SiteId = 'hub' | 'kanban' | 'marketplace' | 'cost' | 'memory' | 'inspector';

export const url = (path = '') => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

// A page on this site links by path, so a local dev server or preview stays on localhost.
const local = (href: string) => {
  const { pathname } = new URL(href);
  return pathname.startsWith(url()) ? pathname : href;
};

type Site = { id: SiteId; name: string; href: string; blurb: string };

export const family: Site[] = ([
  { id: 'hub', name: 'Hub', href: 'https://nikiforovall.blog/claude-code-hub/', blurb: 'All four apps in one window' },
  { id: 'kanban', name: 'Kanban', href: 'https://nikiforovall.blog/claude-code-kanban/', blurb: 'Watch and drive sessions' },
  { id: 'marketplace', name: 'Marketplace', href: 'https://nikiforovall.blog/claude-code-marketplace/', blurb: 'Plugins and skills' },
  { id: 'cost', name: 'Cost', href: 'https://nikiforovall.blog/claude-code-cost/', blurb: 'Spend by session and project' },
  { id: 'memory', name: 'Memory', href: 'https://nikiforovall.blog/claude-code-memory/', blurb: 'What Claude Code loads' },
  // An example app in the hub repo, so its page is part of the hub site.
  { id: 'inspector', name: 'Inspector', href: 'https://nikiforovall.blog/claude-code-hub/inspector/', blurb: 'One session, turn by turn' },
] satisfies Site[]).map((s) => ({ ...s, href: local(s.href) }));
