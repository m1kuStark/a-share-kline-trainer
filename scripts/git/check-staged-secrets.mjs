#!/usr/bin/env node
// 扫描已暂存改动中的高置信密钥。宁可少量误报，也不把真实凭据带进历史。
import { execFileSync } from 'node:child_process'

const git = (args) => execFileSync('git', args, { encoding: 'utf8' })
const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACM'])
  .split('\n').map((line) => line.trim()).filter(Boolean)

const findings = []
for (const path of staged) {
  if (/(^|\/)\.env($|\.)/i.test(path) || /(^|\/)id_(rsa|ed25519)$/i.test(path)) {
    findings.push({ path, reason: '敏感文件名被暂存' })
  }
}

const diff = git(['diff', '--cached', '--unified=0', '--no-color'])
const patterns = [
  [/-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/, '私钥'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, 'GitHub fine-grained token'],
  [/\bsk-[A-Za-z0-9]{32,}\b/, 'API secret key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bSESSDATA\s*[=:]\s*["']?[A-Za-z0-9%._-]{10,}/, 'Bilibili SESSDATA'],
]
let current = ''
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ b/')) { current = line.slice(6); continue }
  if (!line.startsWith('+') || line.startsWith('+++')) continue
  for (const [pattern, reason] of patterns) {
    if (pattern.test(line)) findings.push({ path: current || '(unknown)', reason })
  }
}

if (findings.length > 0) {
  console.error('\n暂存区发现疑似密钥，已阻止提交：')
  for (const finding of findings) console.error('  - ' + finding.path + '：' + finding.reason)
  console.error('\n如确认是测试 fixture（无真实凭据），请从提交中移除或与维护者确认后再处理。\n')
  process.exit(1)
}
