#!/usr/bin/env node
// Focused, non-destructive version and consumer-API receipt. This does not
// attempt a resource-exhaustion exploit or prove product exploitability.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const repo = process.cwd()
const lock = JSON.parse(readFileSync(path.join(repo, 'package-lock.json'), 'utf8'))
const mode = process.argv.includes('--installed') ? 'installed' : 'lock'
const checks = []
const consumers = [
  { name: 'app-builder-lib', root: 'node_modules/app-builder-lib' },
  { name: '@electron/universal', root: 'node_modules/@electron/universal' },
  { name: 'glob', root: 'node_modules/glob' },
]
const expectedLegacy = {
  'node_modules/@electron/asar/node_modules/minimatch': '3.1.5',
  'node_modules/dir-compare/node_modules/minimatch': '3.1.5',
  'node_modules/filelist/node_modules/minimatch': '5.1.9',
  'node_modules/rimraf/node_modules/minimatch': '3.1.5',
}

function check(name, fn) {
  try {
    const detail = fn()
    checks.push({ name, passed: true, ...(detail ? { detail } : {}) })
  } catch (error) {
    checks.push({ name, passed: false, error: error.stack || String(error) })
  }
}

function lockedDependency(from, name) {
  let current = from
  while (true) {
    if (path.posix.basename(current) !== 'node_modules') {
      const candidate = path.posix.join(current, 'node_modules', name)
      if (lock.packages[candidate]) return { path: candidate, ...lock.packages[candidate] }
    }
    if (current === '.') break
    current = path.posix.dirname(current)
  }
  throw new Error(`Cannot resolve locked ${name} from ${from}`)
}

for (const consumer of consumers) {
  check(`lock: ${consumer.name} resolves minimatch 11.0.9`, () => {
    const resolved = lockedDependency(consumer.root, 'minimatch')
    assert.equal(resolved.version, '11.0.9', resolved.path)
    return { path: resolved.path, version: resolved.version }
  })
}

check('lock: no copy is in either scoped advisory range', () => {
  const copies = Object.entries(lock.packages)
    .filter(([name]) => name === 'node_modules/minimatch' || name.endsWith('/node_modules/minimatch'))
    .map(([name, info]) => ({ path: name, version: info.version }))
  const affected = copies.filter(({ version }) => {
    const [major, minor, patch] = version.split('.').map(Number)
    return (major >= 7 && (major < 11 || (major === 11 && minor === 0 && patch < 1))) ||
      (major === 11 && minor === 0 && patch >= 3 && patch <= 7)
  })
  assert.deepEqual(affected, [], 'GHSA-g3hv-75wg-m249 / GHSA-hqmv-qgp3-jx75')
  return copies
})

for (const [legacyPath, version] of Object.entries(expectedLegacy)) {
  check(`lock: legacy ${legacyPath} remains ${version}`, () => {
    assert.equal(lock.packages[legacyPath]?.version, version)
  })
}

if (mode === 'installed') {
  for (const consumer of consumers) {
    check(`installed: ${consumer.name} resolves minimatch 11.0.9`, () => {
      const req = createRequire(path.join(repo, consumer.root, 'package.json'))
      const resolved = req.resolve('minimatch')
      let dir = path.dirname(resolved)
      while (path.basename(dir) !== 'minimatch') dir = path.dirname(dir)
      const installed = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
      assert.equal(installed.version, '11.0.9', resolved)
      return { path: path.relative(repo, resolved).replaceAll('\\', '/'), version: installed.version }
    })
  }

  const builderRequire = createRequire(path.join(repo, 'node_modules/app-builder-lib/package.json'))
  const universalRequire = createRequire(path.join(repo, 'node_modules/@electron/universal/package.json'))
  const { FileMatcher } = builderRequire('./out/fileMatcher.js')
  const { hasMagic } = builderRequire('./out/util/filter.js')
  const { Minimatch } = builderRequire('minimatch')
  const universalMinimatch = universalRequire('minimatch').minimatch
  const fixtureRoot = path.join(repo, '__minimatch_fixture__')
  const fileStat = { isDirectory: () => false }
  const dirStat = { isDirectory: () => true }
  const packageConfig = readFileSync(path.join(repo, 'desktop/electron-builder.yml'), 'utf8')
  const filesBlock = packageConfig.split(/^files:\s*$/m)[1]?.split(/^asar:/m)[0]
  assert.ok(filesBlock, 'desktop package files block exists')
  const packagePatterns = [...filesBlock.matchAll(/^  - ([^#\r\n]+)/gm)].map(match => match[1].trim())
  const packageFilter = new FileMatcher(fixtureRoot, path.join(repo, '__out__'), x => x, packagePatterns).createFilter()

  for (const relative of ['desktop/dist/main.js', 'server/dist/index.js', 'web/dist/index.html', 'package.json']) {
    check(`builder: actual package files include ${relative}`, () => {
      assert.equal(packageFilter(path.join(fixtureRoot, relative), fileStat), true)
    })
  }
  check('builder: actual package files exclude unrelated source', () => {
    assert.equal(packageFilter(path.join(fixtureRoot, 'server/src/index.ts'), fileStat), false)
  })
  check('builder: partial directory traversal reaches actual package files', () => {
    assert.equal(packageFilter(path.join(fixtureRoot, 'desktop'), dirStat), true)
    assert.equal(packageFilter(path.join(fixtureRoot, 'desktop/dist'), dirStat), true)
  })
  check('builder: dotfiles, exclusions, Windows separators and literal directory expansion', () => {
    const filter = new FileMatcher(fixtureRoot, path.join(repo, '__out__'), x => x,
      ['assets', '!assets/private/**']).createFilter()
    assert.equal(filter(path.join(fixtureRoot, 'assets/.hidden'), fileStat), true)
    assert.equal(filter(path.join(fixtureRoot, 'assets/keep.txt'), fileStat), true)
    assert.equal(filter(path.join(fixtureRoot, 'assets/private/secret.txt'), fileStat), false)
    assert.equal(filter(path.join(fixtureRoot, 'assets'), dirStat), true)
    assert.equal(filter(path.join(fixtureRoot, 'other/file.txt'), fileStat), false)
  })
  check('builder: .set magic detection preserves literal/glob/brace behavior', () => {
    assert.equal(hasMagic(new Minimatch('assets', { dot: true })), false)
    assert.equal(hasMagic(new Minimatch('assets/*.txt', { dot: true })), true)
    assert.equal(hasMagic(new Minimatch('assets/{one,two}', { dot: true })), true)
  })
  check('universal: named minimatch with matchBase retains positive and negative controls', () => {
    assert.equal(universalMinimatch('nested/library.node', '*.node', { matchBase: true }), true)
    assert.equal(universalMinimatch('nested/library.txt', '*.node', { matchBase: true }), false)
    assert.equal(universalMinimatch('nested/library.node', '*.node', { matchBase: false }), false)
  })
}

const report = {
  mode,
  platform: process.platform,
  node: process.version,
  advisorySources: [
    'https://github.com/advisories/GHSA-g3hv-75wg-m249',
    'https://github.com/isaacs/minimatch/security/advisories/GHSA-hqmv-qgp3-jx75',
  ],
  passed: checks.filter(item => item.passed).length,
  failed: checks.filter(item => !item.passed).length,
  checks,
}
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed === 0 ? 0 : 1
