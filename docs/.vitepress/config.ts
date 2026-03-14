import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Chris Assistant',
  description: 'A personal AI assistant accessible through Telegram',

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started/overview' },
      { text: 'Symphony', link: '/symphony-overview' },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'Tools', link: '/tools/overview' },
      { text: 'CLI', link: '/cli/reference' },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Overview', link: '/getting-started/overview' },
          { text: 'Setup', link: '/getting-started/setup' },
          { text: 'Usage', link: '/getting-started/usage' },
        ],
      },
      {
        text: 'Symphony',
        items: [
          { text: 'Overview', link: '/symphony-overview' },
        ],
      },
      {
        text: 'Architecture',
        items: [
          { text: 'Overview', link: '/architecture/overview' },
          { text: 'Design Decisions', link: '/architecture/design-decisions' },
          { text: 'Providers', link: '/architecture/providers' },
          { text: 'Agent SDKs', link: '/architecture/agent-sdks' },
          { text: 'Security', link: '/architecture/security' },
        ],
      },
      {
        text: 'Tools',
        items: [
          { text: 'Overview', link: '/tools/overview' },
          { text: 'SSH & Remote Access', link: '/tools/ssh' },
          { text: 'Files & Git', link: '/tools/files-and-git' },
          { text: 'Web & Fetch', link: '/tools/web-and-fetch' },
          { text: 'Code Execution', link: '/tools/code-execution' },
          { text: 'Memory', link: '/tools/memory' },
          { text: 'Scheduler', link: '/tools/scheduler' },
          { text: 'macOS (Calendar, Mail, Reminders)', link: '/tools/macos' },
        ],
      },
      {
        text: 'CLI',
        items: [
          { text: 'Command Reference', link: '/cli/reference' },
          { text: 'Environment & Config', link: '/cli/environment' },
        ],
      },
      {
        text: 'Development',
        items: [
          { text: 'Local Development', link: '/development/local-dev' },
          { text: 'Gotchas', link: '/development/gotchas' },
        ],
      },
      {
        text: 'Roadmap',
        items: [
          { text: 'Features', link: '/roadmap/features' },
          { text: 'OpenClaw Comparison', link: '/roadmap/openclaw-comparison' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/christaylor/chris-assistant' },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message: 'A personal AI assistant for Telegram',
    },
  },
})
