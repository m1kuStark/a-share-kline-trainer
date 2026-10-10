// MIG-01 迁移工具构建：把导出页/控制台兜底脚本连同仓库正源的录像校验/转换模块
// （web/src/recording/{validation,compactCodec,compactStorage 依赖闭包}）打包为自包含 JS，
// 注入页面模板与 Node 工具模板，产出可直接拷入 v1.2.7 包根的 dist/migrate-v127/。
// 保真关键：校验与 v1→v2 转换代码直接来自仓库正源（与 v1.2.7 逐字段一致），不经手抄。
// 运行：node tools/migrate-v127/build.mjs（依赖仓库 node_modules 的 esbuild，无新依赖）。
import { build } from 'esbuild'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const toolRoot = dirname(fileURLToPath(import.meta.url))
const srcDir = join(toolRoot, 'src')
const staticDir = join(toolRoot, 'static')
const distDir = join(toolRoot, 'dist', 'migrate-v127')

async function bundle(entry, define) {
  const result = await build({
    entryPoints: [join(srcDir, entry)],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome110',
    write: false,
    minify: false,
    legalComments: 'none',
    logLevel: 'warning',
    ...(define ? { define } : {}),
  })
  return result.outputFiles[0].text
}

const pageScript = await bundle('export-page.ts')
const consoleScript = await bundle('console-fallback.ts')

const template = await readFile(join(srcDir, 'page-template.html'), 'utf8')
if (!template.includes('<!--V127_PAGE_SCRIPT-->')) throw new Error('page-template.html 缺少脚本注入标记')
const pageHtml = template.replace('<!--V127_PAGE_SCRIPT-->', `<script>\n${pageScript}\n</script>`)

const cjsTemplate = await readFile(join(srcDir, 'export-tool.cjs'), 'utf8')
const PLACEHOLDER = '"__V127_PAGE_HTML__"'
if (!cjsTemplate.includes(PLACEHOLDER)) throw new Error('export-tool.cjs 缺少页面占位符')
const toolCjs = cjsTemplate.replace(PLACEHOLDER, () => JSON.stringify(pageHtml))

const fallbackText = [
  '════════════════════════════════════════════════════════════════════',
  ' 迁移兜底：v1.2.7 训练录像导出（浏览器控制台脚本）',
  '════════════════════════════════════════════════════════════════════',
  '',
  '适用场景：「导出训练录像.cmd」打不开、端口被占、或页面提示找不到录像库时使用。',
  '',
  '使用步骤：',
  '  1. 正常启动旧版训练器（Start.cmd），等页面完全打开；',
  '  2. 在训练器页面上按 F12（或右键→检查）打开开发者工具，切到「控制台 / Console」；',
  '  3. 复制本文件分隔线以下的【全部内容】粘贴进控制台，回车执行；',
  '  4. 浏览器会自动下载「训练录像库-….trainer-recordings.json」，即迁移合并包；',
  '  5. 打开 v1.3.0 →「训练录像」→「导入录制」，选择该文件完成迁移。',
  '',
  '说明：脚本只读取录像、不修改不删除任何旧数据；导出后控制台会逐条列出结果。',
  '',
  '────────────────── 以下为脚本内容，复制到控制台 ──────────────────',
  '',
  consoleScript,
  '',
  '────────────────── 脚本内容结束 ──────────────────',
  '',
].join('\n')

await mkdir(distDir, { recursive: true })
await writeFile(join(distDir, 'export-v127.cjs'), toolCjs, 'utf8')
await writeFile(join(distDir, '迁移兜底-浏览器控制台脚本.txt'), fallbackText, 'utf8')
await copyFile(join(staticDir, '导出训练录像.cmd'), join(distDir, '导出训练录像.cmd'))
await copyFile(join(staticDir, '迁移说明.md'), join(distDir, '迁移说明.md'))

const kb = value => `${(Buffer.byteLength(value, 'utf8') / 1024).toFixed(1)} KB`
console.log(`[build] dist/migrate-v127/`)
console.log(`  export-v127.cjs                   ${kb(toolCjs)}（内嵌导出页）`)
console.log(`  迁移兜底-浏览器控制台脚本.txt       ${kb(fallbackText)}`)
console.log(`  导出训练录像.cmd / 迁移说明.md       已复制`)
