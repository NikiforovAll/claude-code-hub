// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://nikiforovall.blog',
	base: '/claude-code-hub',
	devToolbar: { enabled: false },
	integrations: [
		starlight({
			title: 'Claude Code Hub',
			description: 'Kanban, Marketplace, Cost, and Memory Diagnoser for Claude Code in one window, driven from the keyboard.',
			favicon: '/favicon.svg',
			head: [
				{ tag: 'meta', attrs: { property: 'og:image', content: 'https://nikiforovall.blog/claude-code-hub/og.png' } },
				{ tag: 'meta', attrs: { name: 'twitter:image', content: 'https://nikiforovall.blog/claude-code-hub/og.png' } },
			],
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/NikiforovAll/claude-code-hub' }],
			editLink: { baseUrl: 'https://github.com/NikiforovAll/claude-code-hub/edit/master/website/' },
			customCss: ['./src/kit/kit.css'],
			components: {
				ThemeProvider: './src/components/ThemeProvider.astro',
				ThemeSelect: './src/components/ThemeSelect.astro',
			},
			sidebar: [
				{ label: 'Start here', items: [{ label: 'Getting started', slug: 'getting-started' }] },
				{ label: 'Guides', items: [{ label: 'Move between the tools', slug: 'guides/navigate' }, { label: 'Pick a project', slug: 'guides/projects' }, { label: 'Use more than one config dir', slug: 'guides/config-dirs' }, { label: 'Embedded terminal', slug: 'guides/terminal' }] },
				{ label: 'Reference', items: [{ label: 'Keyboard shortcuts', slug: 'reference/shortcuts' }, { label: 'CLI and configuration', slug: 'reference/configuration' }, { label: 'Security and the hub token', slug: 'reference/security' }, { label: 'Architecture', slug: 'reference/architecture' }, { label: 'Hub protocol v1', slug: 'reference/protocol' },{ label: 'Troubleshooting', slug: 'reference/troubleshooting' }] },
			],
		}),
	],
});
