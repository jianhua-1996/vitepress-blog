---
title: Vite 构建优化实战：从产物分析到浏览器兼容
tags:
  - Vite
  - 构建优化
  - 前端工程化
  - Rollup
  - 性能优化
  - 浏览器兼容

date: 2026-04-25
---

在一次前端项目从 Webpack 迁移到 Vite 的过程中，构建优化是一项绕不开的工作。Vite 开发时的极速热更新体验令人愉悦，但到了生产构建环节，如果不对构建产物进行优化，产出的 bundle 可能臃肿不堪、加载缓慢，甚至在一些低版本浏览器上直接白屏。

本文记录了我在一个企业级 OA 系统（Vue 3 + Vite + Element Plus）中实际落地的构建优化工作，涵盖产物分析、压缩策略、分包优化、依赖精简、CDN 外置以及浏览器兼容性处理。

---

## 一、产物分析：先量再裁

### 为什么需要产物分析

优化的第一步不是动手改代码，而是搞清楚"包袱里装了什么"。Vite 底层使用 Rollup 进行生产构建，最终产物由多个 chunk 组成。如果不做分析，你根本不知道哪个第三方库占了最大体积、哪些模块被重复打包、tree-shaking 是否真正生效。

### rollup-plugin-visualizer

[rollup-plugin-visualizer](https://github.com/btd/rollup-plugin-visualizer) 是 Rollup 生态中最常用的产物分析插件，它会在构建完成后生成一个可交互的 `stats.html` 页面，以 Treemap 的形式展示各模块在 bundle 中的体积占比。

引入方式非常简单：

```typescript
// vite.config.ts
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [
    visualizer() as PluginOption
  ]
})
```

构建完成后，打开项目根目录下的 `stats.html`，你会看到一个可交互的 Treemap 可视化界面。每个色块代表一个模块，色块面积越大说明它在 bundle 中占的体积越大。鼠标悬停在色块上可以查看模块的具体路径和 gzip 后的大小。

> 注意：`stats.html` 不应提交到 Git，在 `.gitignore` 中添加 `stats.html` 即可。

### 我发现的问题

通过 visualizer，我发现了几个意料之外的大体积模块：

1. **lodash 全量引入**——即使只使用了 `debounce`、`throttle` 等寥寥几个函数，整个 lodash（70KB+ gzipped）都被打包进来了
2. **Element Plus 全局注册**——所有组件无论是否用到都被打包进了 bundle
3. **ag-grid-community**——这个表格库体积巨大，但在某些页面中并非首屏必需

这些问题指引了后续的优化方向。

---

## 二、图片压缩：构建时静默瘦身

### 为什么需要构建时图片压缩

前端项目中图片资源通常占据了传输体积的很大一部分。设计师给的 PNG 可能是未压缩的、SVG 里可能有大量冗余的元数据、JPEG 的压缩质量可能过高。如果能在构建阶段自动优化这些图片，既不改变开发体验，又能有效减小产物体积。

### vite-plugin-image-optimizer

[vite-plugin-image-optimizer](https://github.com/FatehAK/vite-plugin-image-optimizer) 会在 Vite 构建过程中自动对图片资源进行无损/有损压缩。它底层依赖两个业界最优秀的图片处理工具：

- **[Sharp](https://sharp.pixelplumbing.com/)**：处理 PNG、JPEG、WebP 等栅格图片
- **[SVGO](https://github.com/svg/svgo)**：优化 SVG 文件，移除冗余的编辑器元数据、注释、默认值等

配置方式：

```json
// package.json (devDependencies)
{
  "vite-plugin-image-optimizer": "^2.0.2",
  "sharp": "^0.34.3",
  "svgo": "^4.0.0"
}
```

```typescript
// vite.config.ts
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer'

export default defineConfig({
  plugins: [
    ViteImageOptimizer()
  ]
})
```

零配置即可生效。构建时你会在终端看到类似这样的日志：

```
✓ [vite-plugin-image-optimizer] Optimized: logo.png (45.2 KB → 18.7 KB, -58.6%)
✓ [vite-plugin-image-optimizer] Optimized: icon-home.svg (3.1 KB → 0.8 KB, -74.2%)
```

对于包含大量图标和背景图的企业级应用，这个优化在产物体积上的收益相当可观。

---

## 三、静态资源压缩：服务端也能减负

### gzip 与 brotli

现代浏览器都支持 gzip 和 brotli 两种压缩编码。如果在构建阶段就预先生成 `.gz` 和 `.br` 文件，部署到 Nginx/IIS 后可以直接开启静态压缩（`gzip_static on`），无需服务器实时压缩，降低 CPU 开销的同时提升响应速度。

### vite-plugin-compression2

我选择了 [vite-plugin-compression2](https://github.com/nonzzz/vite-plugin-compression)（比早期的 vite-plugin-compression 更轻量且维护更活跃），它默认同时输出 gzip 和 brotli 压缩产物：

```typescript
// vite.config.ts
import { compression } from 'vite-plugin-compression2'

export default defineConfig({
  plugins: [
    compression({
      // 默认启用 gzip 和 brotli
      // 每个 js/css 文件会额外生成 .gz 和 .br 文件
      // deleteOriginalAssets: true  // 按需开启，删除原始文件
    })
  ]
})
```

构建产物对比：

```
js/index-abc123.js        523 KB   (原始)
js/index-abc123.js.gz     156 KB   (gzip, -70%)
js/index-abc123.js.br     132 KB   (brotli, -75%)
```

> 服务端配置示例（Nginx）：开启 `gzip_static on` 和 `brotli_static on` 后，Nginx 会优先使用预压缩文件。

---

## 四、依赖精简：砍掉不必要的东西

### 4.1 es-toolkit 替换 lodash

这在之前的[《企业级 OA 系统的前端性能优化实践》](/posts/企业级OA系统的前端性能优化实践.md)中已经详细讲过，核心思路是：

**第一步**：构建层全局别名，零风险替换——

```typescript
// vite.config.ts
resolve: {
  alias: {
    lodash: 'es-toolkit/compat',
    'lodash-es': 'es-toolkit/compat'
  }
}
```

**第二步**：逐步替换代码中的直接引用。

es-toolkit 的 API 与 lodash 高度兼容，迁移成本极低，而包体积从 70KB+ 降到只有几 KB。

### 4.2 去除冗余的 @vue/compiler-sfc

项目中使用了带编译器的 Vue 版本（`vue/dist/vue.esm-bundler.js`），因此 `@vue/compiler-sfc` 是多余的依赖——它本是为不含编译器的 Vue 版本提供 SFC 编译能力的。去掉这个包直接减少了 devDependencies 的安装体积。

### 4.3 Element Plus 按需导入

早期项目中 Element Plus 是全局注册的：

```typescript
// 之前：全量导入
import ElementPlus from 'element-plus'
app.use(ElementPlus)
```

通过升级 `unplugin-vue-components` 和 `unplugin-auto-import` 插件，改为按需导入：

```typescript
// vite.config.ts
AutoImport({
  resolvers: [ElementPlusResolver(), VantResolver()],
  imports: ['vue'],
}),
Components({
  resolvers: [ElementPlusResolver(), VantResolver()],
}),
```

插件会在构建时自动分析模板中使用的组件，只打包实际用到的部分。在 visualizer 中可以直观地看到 Element Plus 的体积大幅缩减。

---

## 五、CDN 外置：把大块头交给 CDN

### 场景

ag-grid-community 是项目中使用的表格库，体积超过 500KB（gzipped 也接近 150KB）。但它并非每个页面都用到，且更新频率低、CDN 缓存命中率高——是理想的外置候选。

### vite-plugin-cdn-import

[vite-plugin-cdn-import](https://github.com/mmf-fe/vite-plugin-cdn-import) 可以在构建时将指定的 npm 包替换为 CDN 引用：

```typescript
// vite.config.ts
import importToCDN from 'vite-plugin-cdn-import'

export default defineConfig({
  plugins: [
    importToCDN({
      modules: [
        {
          name: 'ag-grid-community',
          var: 'agGrid',
          path: 'https://cdn.jsdelivr.net/npm/ag-grid-community@32.3.0/dist/ag-grid-community.min.js'
        }
      ]
    })
  ]
})
```

原理：构建时，插件会把 `import { ... } from 'ag-grid-community'` 转换为对全局变量 `window.agGrid` 的访问，并在 HTML 中自动注入对应的 `<script>` 标签。

> 注意：使用 CDN 外置时，需要确保 CDN 的可用性和安全性。对于企业内网环境，可能需要将 CDN 资源部署到内部 CDN 服务器上。

---

## 六、分包策略：让缓存为我所用

### 为什么需要自定义分包

Vite/Rollup 默认的代码分割策略会将动态 `import()` 的模块拆分为独立 chunk，但对于 `node_modules` 中的第三方包，默认行为可能不太理想——所有第三方包被塞进一个巨大的 `vendor` chunk，任何依赖更新都会导致整个文件缓存失效。

### manualChunks 配置

我的策略是：**将变更频率低的 UI 框架独立分包，让 Rollup 自动处理其余部分**：

```typescript
// vite.config.ts
build: {
  rollupOptions: {
    output: {
      manualChunks: id => {
        if (id.includes('node_modules/')) {
          // UI 框架独立分包——变更频率低，浏览器缓存命中率高
          if (id.includes('/node_modules/element-plus/')) return 'element-plus'
          if (id.includes('/node_modules/vant/')) return 'vant'
          // 工具库独立分包——被多个页面共享
          if (id.includes('/node_modules/jquery/')) return 'jquery'
          if (id.includes('/node_modules/survey-core/')) return 'survey-core'
          return  // 其余由 Rollup 自动处理
        }
        return null
      },
      experimentalMinChunkSize: 1024 * 10  // 低于 10KB 的 chunk 自动合并
    }
  }
}
```

核心思路：

| 策略 | 目的 |
|------|------|
| UI 框架独立分包 | 变更频率低，可充分利用浏览器缓存 |
| 10KB 最小 chunk 限制 | 避免产生大量微小文件，减少 HTTP 请求数 |
| 其余自动分包 | 让 Rollup 根据模块依赖关系自动优化 |

### Tree-shaking 强化

在分包的基础上，启用 Rollup 的推荐级 tree-shaking：

```typescript
treeshake: {
  preset: 'recommended',
  manualPureFunctions: []
}
```

`recommended` 预设比默认模式更激进，会消除注释标注的 pure 调用、未使用的导出等死代码。

### 从 terser 切换到 esbuild

Vite 默认使用 esbuild 进行代码压缩，但项目早期为了使用 terser 的 `drop_console` 和 `drop_debugger` 功能，配置了 `minify: 'terser'`。后来发现 esbuild 也提供了类似能力：

```typescript
// 之前：terser
build: {
  minify: 'terser',
  terserOptions: {
    compress: {
      drop_console: false,
      drop_debugger: false,
    }
  }
}

// 之后：esbuild（更快）
esbuild: {
  drop: ['debugger']
}
```

esbuild 的压缩速度比 terser 快 20-100 倍，对大型项目的构建时间有显著改善。

---

## 七、浏览器兼容：Legacy 插件的渐进策略

### 问题背景

企业级应用的用户群体复杂——有些部门仍在使用较旧的浏览器。如果不做兼容处理，使用 ES2020+ 语法（如可选链 `?.`、空值合并 `??`、`Promise.allSettled` 等）的代码在这些浏览器上会直接报错。

### @vitejs/plugin-legacy

[@vitejs/plugin-legacy](https://github.com/vitejs/vite/tree/main/packages/plugin-legacy) 是 Vite 官方提供的兼容性解决方案，它会为构建产物同时生成两套代码：

1. **Modern 版本**：使用原生 ES Modules，面向现代浏览器
2. **Legacy 版本**：使用 Babel 转译 + polyfill，面向旧浏览器

浏览器通过 `<script type="module">` 和 `<script nomodule>` 的特性检测自动选择加载哪个版本。

```typescript
// vite.config.ts
import legacy from '@vitejs/plugin-legacy'

export default defineConfig({
  plugins: [
    legacy({
      modernPolyfills: true,
      polyfills: true,
      renderLegacyChunks: true
    })
  ]
})
```

### browserslist 配置

最初我把浏览器目标直接写在 Vite 配置中，后来意识到 browserslist 是一个更好的方案——它是前端生态的通用标准，Babel、Autoprefixer、ESLint 等工具都能读取同一份配置：

```json
// package.json
{
  "browserslist": [
    ">5% in CN",
    "last 3 versions",
    "Android >= 9",
    "iOS >= 14",
    "not dead"
  ]
}
```

```typescript
// vite.config.ts - 移除了重复的 browserslist 配置
// 只保留 legacy 插件引用即可
```

这样一份配置，构建工具链中的所有环节都能对齐目标浏览器范围，避免不同工具使用不同标准导致的兼容性问题。

### Legacy 插件的演进过程

实际落地中，Legacy 插件的启用经历了一个渐进过程：

1. **第一阶段（条件式启用）**：通过环境变量 `VITE_LEGACY_BUILD` 控制是否启用，仅在需要兼容旧浏览器时开启——因为 Legacy 插件会显著增加构建时间
2. **第二阶段（调整策略）**：随着旧浏览器逐步淘汰，修改了 Legacy 插件的兼容策略，精简 polyfill 范围
3. **第三阶段（始终启用）**：最终决定始终启用 Legacy 插件并简化其配置，确保全场景兼容，同时接受构建时间的小幅增加

```mermaid
flowchart LR
  A[条件式启用<br/>VITE_LEGACY_BUILD] --> B[调整策略<br/>精简 polyfill]
  B --> C[始终启用<br/>简化配置]
```

---

## 八、最终的 vite.config.ts 全景

经过以上优化后，构建配置的 plugins 部分是这样的：

```typescript
plugins: [
  vue(),
  vueDevTools(),                    // 开发调试
  legacy({ ... }),                  // 浏览器兼容
  ElementPlus({ useSource: true }),
  AutoImport({ ... }),              // API 自动导入
  Components({ ... }),              // 组件自动导入（按需）
  visualizer() as PluginOption,     // 产物分析
  ViteImageOptimizer(),             // 图片压缩
  compression({ ... }),             // 静态资源 gzip/brotli
  sentryVitePlugin({ ... })         // Sentry source map 上传
]
```

配合 resolve alias 实现 lodash → es-toolkit 的透明替换，以及 manualChunks 分包策略和 tree-shaking 强化。

---

## 总结

| 优化方向 | 工具/手段 | 收益 |
|----------|----------|------|
| 产物分析 | rollup-plugin-visualizer | 可视化发现体积问题 |
| 图片压缩 | vite-plugin-image-optimizer (sharp + svgo) | 图片体积平均减少 50-70% |
| 静态压缩 | vite-plugin-compression2 (gzip + brotli) | 传输体积再减 70%+ |
| 依赖精简 | es-toolkit 替换 lodash + 去除 compiler-sfc + 按需导入 | 包体积显著缩减 |
| CDN 外置 | vite-plugin-cdn-import (ag-grid) | 主 bundle 减少约 150KB (gzipped) |
| 分包策略 | manualChunks + experimentalMinChunkSize + treeshake recommended | 缓存命中率提升，请求数减少 |
| 构建加速 | esbuild 替换 terser | 构建速度提升 20-100 倍 |
| 浏览器兼容 | @vitejs/plugin-legacy + browserslist | 旧浏览器白屏问题彻底解决 |

构建优化不是一次性的工作，而是一个持续的过程。每次新增依赖时都应该在 visualizer 中审视其对产物体积的影响；每次升级依赖时都应该确认 tree-shaking 是否仍然有效。说到底，构建优化的本质是：**知道你的 bundle 里有什么 → 砍掉不该有的 → 让该有的尽可能小 → 让浏览器尽可能复用缓存**。
