// UPD-01 版本暴露（矩阵行 UPD-VERSION-EXPOSE）。
// 当前版本来源＝包根 package.json 的 version（发布包由 build.mjs 构建时写入精简
// package.json；开发运行＝仓库 package.json）——不运行时读源码目录。
// server/dist/update/version.js 与 server/src/update/version.ts 的三级上溯都落在
// 含 package.json 的根上，两条运行形态共用同一解析。

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 含 package.json 的应用根（发布包＝包根；开发＝仓库根） */
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** 读取某根下 package.json 的 version；缺失/损坏/非字符串返回 null。 */
export function readPackageVersion(root: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof pkg?.version === 'string' && pkg.version.trim() !== '' ? pkg.version : null
  } catch {
    return null
  }
}

let cachedDefault: string | null | undefined

/** 当前服务版本：默认根进程内缓存一次；显式 root 时直读（测试用）。 */
export function serverVersion(root: string = APP_ROOT): string | null {
  if (resolve(root) === APP_ROOT) {
    cachedDefault ??= readPackageVersion(APP_ROOT)
    return cachedDefault
  }
  return readPackageVersion(root)
}

/** 'v1.2.8' / '1.2.8' → '1.2.8'；其余形态（如 'release-1.2.8'）返回 null。 */
export function normalizeTagVersion(tag: string): string | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim())
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : null
}

function parseTriple(version: string): [number, number, number] | null {
  const normalized = normalizeTagVersion(version)
  if (!normalized) return null
  const [a, b, c] = normalized.split('.').map(Number)
  return [a, b, c]
}

/** 三段十进制版本比较（1.2.10 > 1.2.9）；不可解析时抛错（调用方先经 normalizeTagVersion 把关）。 */
export function compareVersions(a: string, b: string): number {
  const left = parseTriple(a)
  const right = parseTriple(b)
  if (!left || !right) throw new Error(`无法比较的版本号：${a} vs ${b}`)
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1
  }
  return 0
}
