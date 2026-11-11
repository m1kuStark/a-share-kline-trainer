#!/usr/bin/env node
// 发布 tag 守卫：校验 main/干净树/版本/CHANGELOG/CI/tag 不存在后，创建签名 annotated tag；可选 push / GitHub Release。
// 默认 dry-run（只打印计划，不加 --execute 不会写入任何东西）。
import { execFileSync, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function parseVersion(raw) {
  const text = String(raw || '').trim().replace(/^v/, '')
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(text)) throw new Error('版本号必须形如 X.Y.Z 或 X.Y.Z-preview.N：' + raw)
  return text
}

export function buildTagName(version) { return 'v' + parseVersion(version) }

export function changelogHasVersion(markdown, version) {
  const normalized = String(version || '').trim().replace(/^v/, '')
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) return false
  const prefix = '## ' + normalized
  return String(markdown || '').split(/\r?\n/).some((line) => {
    const heading = line.trimStart()
    if (!heading.startsWith(prefix)) return false
    const rest = heading.slice(prefix.length)
    return rest === '' || rest.startsWith('（') || rest.startsWith('(') || /^\s/.test(rest)
  })
}

function git(args) { return execFileSync('git', args, { encoding: 'utf8' }).trim() }
function run(command) { execSync(command, { stdio: 'inherit' }) }
function argValue(argv, index, flag) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(flag + ' 需要参数')
  return value
}

function parseArgs(argv) {
  const flags = { assets: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--execute') flags.execute = true
    else if (arg === '--push') flags.push = true
    else if (arg === '--release') flags.release = true
    else if (arg === '--prerelease') flags.prerelease = true
    else if (arg === '--skip-ci-check') flags.skipCiCheck = true
    else if (arg === '--skip-remote-check') flags.skipRemoteCheck = true
    else if (arg === '--version') { flags.version = argValue(argv, i, '--version'); i++ }
    else if (arg === '--notes') { flags.notes = argValue(argv, i, '--notes'); i++ }
    else if (arg === '--title') { flags.title = argValue(argv, i, '--title'); i++ }
    else if (arg === '--asset') { flags.assets.push(argValue(argv, i, '--asset')); i++ }
    else if (arg === '--repo') { flags.repo = argv[++i]; if (!flags.repo) throw new Error('--repo 需要参数') }
    else throw new Error('未知参数：' + arg)
  }
  return flags
}

function main() {
  const flags = parseArgs(process.argv.slice(2))
  const root = process.cwd()
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const version = parseVersion(flags.version || pkg.version)
  if (version !== pkg.version) throw new Error('--version (' + version + ') 与 package.json (' + pkg.version + ') 不一致')
  const tag = buildTagName(version)
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  if (!changelogHasVersion(changelog, version)) throw new Error('CHANGELOG.md 缺少版本小节：' + version)
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch !== 'main') throw new Error('只允许从 main 打 tag（当前：' + branch + '）')
  if (git(['status', '--porcelain'])) throw new Error('工作树不干净：先提交或清理')
  if (git(['tag', '-l', tag])) throw new Error('本地 tag 已存在：' + tag)
  if (!flags.skipRemoteCheck) {
    const remote = git(['ls-remote', '--tags', 'origin', 'refs/tags/' + tag])
    if (remote) throw new Error('远端 tag 已存在：' + tag)
  }
  const head = git(['rev-parse', 'HEAD'])
  const repo = flags.repo || execSync('gh repo view --json nameWithOwner --jq .nameWithOwner', { encoding: 'utf8' }).trim()
  if (!flags.skipCiCheck) {
    const raw = execSync('gh run list --repo ' + repo + ' --branch main --limit 1 --json headSha,status,conclusion,url', { encoding: 'utf8' })
    const latest = JSON.parse(raw)[0]
    if (!latest) throw new Error('没有 main CI run，拒绝打 tag')
    if (latest.headSha !== head) throw new Error('最新 main CI 不覆盖当前 HEAD（' + latest.headSha + ' != ' + head + '）')
    if (latest.conclusion !== 'success' || latest.status !== 'completed') throw new Error('最新 main CI 未成功：' + latest.conclusion + '/' + latest.status)
  }
  if (flags.release && !flags.notes) throw new Error('--release 需要 --notes <文件>')
  console.log('release tag 计划')
  console.log('  repo    = ' + repo)
  console.log('  HEAD    = ' + head)
  console.log('  version = ' + version)
  console.log('  tag     = ' + tag)
  console.log('  push    = ' + Boolean(flags.push))
  console.log('  release = ' + Boolean(flags.release) + (flags.release ? ' (prerelease=' + Boolean(flags.prerelease) + ')' : ''))
  if (!flags.execute) { console.log('dry-run：未加 --execute，不创建/推送任何东西'); return }
  run('git tag -s ' + tag + ' -m "release ' + tag + '"')
  if (flags.push) run('git push origin ' + tag)
  if (flags.release) {
    const title = flags.title || tag
    const args = ['release', 'create', tag, '--repo', repo, '--verify-tag', '--title', '"' + title + '"', '--notes-file', '"' + flags.notes + '"']
    if (flags.prerelease) args.push('--prerelease')
    for (const asset of flags.assets) args.push('"' + asset + '"')
    run('gh ' + args.join(' '))
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  try { main() } catch (error) { console.error('[tag-release] ' + (error instanceof Error ? error.message : String(error))); process.exitCode = 1 }
}