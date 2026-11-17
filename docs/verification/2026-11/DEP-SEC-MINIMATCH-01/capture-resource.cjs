const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const [repo, cache] = process.argv.slice(2)
const resource = 'desktop/build-resources/migration-export-inline.html'
const baseline = spawnSync('git', ['show', `HEAD:${resource}`], { cwd: repo, encoding: null })
if (baseline.status !== 0) throw new Error(baseline.stderr.toString())
const generated = fs.readFileSync(path.join(repo, resource))
const packaged = fs.readFileSync(path.join(repo, 'desktop/release/win-unpacked/resources/migration-export-inline.html'))
const digest = data => crypto.createHash('sha256').update(data).digest('hex')
const lf = data => data.toString('utf8').replaceAll('\r\n', '\n')
fs.writeFileSync(path.join(cache, 'migration-base-git-blob.html'), baseline.stdout)
fs.writeFileSync(path.join(cache, 'migration-generated-worktree.html'), generated)
fs.writeFileSync(path.join(cache, 'migration-packaged.html'), packaged)
const result = {
  resource,
  scope: 'isolated dependency worktree only; main checkout file never read or copied',
  baseline: 'HEAD Git blob; physical pre-build checkout bytes were not separately captured',
  baseGitBlob: { bytes: baseline.stdout.length, sha256: digest(baseline.stdout) },
  generated: { bytes: generated.length, sha256: digest(generated) },
  packaged: { bytes: packaged.length, sha256: digest(packaged) },
  generatedEqualsPackaged: generated.equals(packaged),
  baseGitBlobEqualsGenerated: baseline.stdout.equals(generated),
  normalizedLfEqual: lf(baseline.stdout) === lf(generated),
}
fs.writeFileSync(path.join(cache, 'migration-resource-identity.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
if (!result.generatedEqualsPackaged || !result.normalizedLfEqual) process.exitCode = 1
