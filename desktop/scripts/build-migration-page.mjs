// MIG-INLINE-01 内置迁移导出页构建：esbuild 打包 export-page.ts IIFE 注入 page-template，
// 产 desktop/build-resources/migration-export-inline.html；同时复制录像导入器脚本到 build-resources。
// 产物提交入库（先例＝tools/migrate-v127/dist 构建产物提交）；改 export-page.ts/模板后重跑本脚本。
// 运行：node desktop/scripts/build-migration-page.mjs（用仓库 node_modules 的 esbuild）
import { build } from 'esbuild'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const srcDir = join(repoRoot, 'tools', 'migrate-v127', 'src')
const outDir = join(repoRoot, 'desktop', 'build-resources')

const result = await build({
  entryPoints: [join(srcDir, 'export-page.ts')],
  bundle: true,
  format: 'iife',
  write: false,
  minify: false,
  legalComments: 'none',
})
const pageScript = result.outputFiles[0].text
const template = await readFile(join(srcDir, 'page-template.html'), 'utf8')
if (!template.includes('<!--V127_PAGE_SCRIPT-->')) throw new Error('page-template.html 缺少 <!--V127_PAGE_SCRIPT--> 注入标记')
const html = template.replace('<!--V127_PAGE_SCRIPT-->', `<script>\n${pageScript}\n</script>`)
await writeFile(join(outDir, 'migration-export-inline.html'), html, 'utf8')
await copyFile(
  join(repoRoot, 'tools', 'migrate-v127', 'dist', 'migrate-v127', 'import-recordings.js'),
  join(outDir, 'migration-import-recordings.js'),
)
console.log('[build-migration-page] 产出：migration-export-inline.html + migration-import-recordings.js → desktop/build-resources/')
