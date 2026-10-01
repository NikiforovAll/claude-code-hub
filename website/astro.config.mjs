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
				{ label: 'Start here', items: [{ label: 'Getting started', slug: 'getting-started' }, { label: 'Architecture', slug: 'reference/architecture' }] },
				{ label: 'Guides', items: [{ label: 'Move between the tools', slug: 'guides/navigate' }, { label: 'Pick a project', slug: 'guides/projects' }, { label: 'Use more than one config dir', slug: 'guides/config-dirs' }, { label: 'Embedded terminal', slug: 'guides/terminal' }, { label: 'Make a custom color theme', slug: 'guides/themes' }] },
				{ label: 'Extensibility', items: [{ label: 'Overview', slug: 'extensibility/overview' }, { label: 'Patch a tool', slug: 'extensibility/patch' }, { label: 'Fork a tool', slug: 'extensibility/fork' }, { label: 'Write a new app', slug: 'extensibility/new-app' }, { label: 'Reference', items: [{ label: 'The apps entry and the launch', slug: 'extensibility/reference/apps-entry' }, { label: 'The app manifest', slug: 'extensibility/reference/manifest' }, { label: 'The SDK', slug: 'extensibility/reference/sdk' }, { label: 'Connect to other tools', slug: 'extensibility/reference/connect' }, { label: 'The built-in tools', slug: 'extensibility/reference/built-in' }] }, { label: 'Examples', items: [{ label: 'Compact session rows', slug: 'extensibility/examples/compact-rows' }, { label: 'Task board', slug: 'extensibility/examples/task-board' }, { label: 'Inspector', slug: 'extensibility/examples/inspector' }] }] },
				{ label: 'Reference', items: [{ label: 'Keyboard shortcuts', slug: 'reference/shortcuts' }, { label: 'CLI and configuration', slug: 'reference/configuration' }, { label: 'Security and the hub token', slug: 'reference/security' },{ label: 'Hub protocol v1', slug: 'reference/protocol' },{ label: 'Troubleshooting', slug: 'reference/troubleshooting' }] },
			],
		}),
	],
});
