// CN-FEED-01（矩阵行 RELEASE-CN-FEED-SYNC）：国内发布目录同步脚本 CLI。
// 用法：node desktop/scripts/sync-feed.mjs --release <产物目录> --mirror <镜像base> [--notes <发布说明>] [--out <输出目录>]
// 产物目录＝release:desktop（desktop/release）与 zip 发布物（kline-trainer-v<版本>-windows-x64.zip
// ＋SHA256SUMS，npm run release:windows 产出）合并后的目录；输出缺省＝产物目录同级 dist-cn-feed/。
// 产出自校验 fail-closed；零外部凭证依赖——本脚本不触网不上传，上传动作见
// docs/release/desktop-release-manual.md 国内源发布段落（由维护者经托管控制台完成）。
// 纯函数层在 sync-feed-lib.mjs（desktop/test/sync-feed-lib.test.ts 锁契约）。
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCnFeedSync } from './sync-feed-lib.mjs'

function usage(code) {
  console.log('用法：node desktop/scripts/sync-feed.mjs --release <产物目录> --mirror <镜像baseURL> [--notes <发布说明>] [--out <输出目录>]')
  process.exit(code)
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let index = 2; index < argv.length; index++) {
    const token = argv[index]
    if (token === '--release' || token === '--mirror' || token === '--notes' || token === '--out') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) usage(2)
      args[token.slice(2)] = value
      index += 1
    } else if (token === '--help' || token === '-h') {
      usage(0)
    } else {
      usage(2)
    }
  }
  return args
}

const args = parseArgs(process.argv)
if (!args.release || !args.mirror) usage(2)

try {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const releaseDir = resolve(root, args.release)
  const outDir = args.out ? resolve(root, args.out) : undefined
  const result = await runCnFeedSync({ releaseDir, mirrorBase: args.mirror, notes: args.notes ?? '', outDir })
  console.log(`[sync-feed] 国内发布目录就绪：${result.outDir}`)
  console.log(`[sync-feed] 版本 v${result.version}，共 ${result.files.length} 个文件：`)
  for (const file of result.files) console.log(`  - ${file}`)
  console.log('[sync-feed] 自校验通过（latest.yml/manifest.json 形状＋镜像 URL 前缀＋校验和与源一致）。')
  console.log('[sync-feed] 下一步：将输出目录内全部文件原样上传到镜像托管（见 docs/release/desktop-release-manual.md）。')
} catch (error) {
  console.error(`[sync-feed] 失败：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
