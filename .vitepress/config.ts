import { getPosts, getPostLength } from './theme/serverUtils'
import { buildBlogRSS } from './theme/rss'
import mathjax3 from 'markdown-it-mathjax3'
import { withMermaid } from 'vitepress-plugin-mermaid'
import vueDevTools from 'vite-plugin-vue-devtools'
import type { UserConfig } from 'vitepress'

async function config(): Promise<UserConfig> {
	return {
		base: '/vitepress-blog/',
		lang: 'zh-CN',
		title: "jianhua1996's blog",
		head: [
			[
				'meta',
				{
					name: 'author',
					content: 'JianHua'
				}
			]
		],
		cleanUrls: true,
		lastUpdated: true,
		themeConfig: {
			// repo: "clark-cui/homeSite",
			avator: 'logo.jpg',
			search: {
				provider: 'local'
			},
			docsDir: '/',
			// docsBranch: "master",
			posts: await getPosts(),
			pageSize: 8,
			postLength: await getPostLength(),
			nav: [
				{
					text: '🏡首页',
					link: '/'
				},
				{
					text: '🔖分类',
					link: '/tags'
				},
				{
					text: '📃归档',
					link: '/archives'
				}
			],
			socialLinks: [{ icon: 'github', link: 'https://github.com/jianhua-1996' }],
			outline: false,
			showFireworksAnimation: false,
			lastUpdatedText: '最后更新于',
			docFooter: {
				prev: '上一篇',
				next: '下一篇'
			}
		},
		buildEnd: () => buildBlogRSS(),
		markdown: {
			theme: {
				dark: 'one-dark-pro',
				light: 'one-light'
			},
			lineNumbers: true,
			codeCopyButtonTitle: '复制代码',
			config: md => {
				md.use(mathjax3)
			}
		},
		vite: {
			optimizeDeps: {
				include: ['mermaid']
			},
			plugins: [vueDevTools()]
		}
	}
}

const _config = await config()

export default withMermaid({
	..._config,
	mermaid: {
		//mermaidConfig !theme here works for light mode since dark theme is forced in dark mode
	}
})
