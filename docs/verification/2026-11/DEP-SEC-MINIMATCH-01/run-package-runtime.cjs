const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const [repo, cache] = process.argv.slice(2)
const profile = path.join(cache, 'isolated-package-probe')
for (const name of ['profile', 'appdata', 'localappdata', 'data', 'tdx']) fs.mkdirSync(path.join(profile, name), { recursive: true })
const environment = {
  ELECTRON_RUN_AS_NODE: '1',
  USERPROFILE: path.join(profile, 'profile'),
  HOME: path.join(profile, 'profile'),
  APPDATA: path.join(profile, 'appdata'),
  LOCALAPPDATA: path.join(profile, 'localappdata'),
  TRAINER_DB: path.join(profile, 'data/probe.sqlite'),
  TRAINER_DATA_DIR: path.join(profile, 'data'),
  TRAINER_TDX_DIR: path.join(profile, 'tdx'),
  TDX_DIR: path.join(profile, 'tdx'),
}
const started = new Date().toISOString()
const result = spawnSync(path.join(repo, 'desktop/release/win-unpacked/K线训练器.exe'),
  [path.join(cache, 'verify-packaged.cjs'), 'runtime', repo, path.join(repo, 'desktop/release')],
  { cwd: repo, env: { ...process.env, ...environment }, encoding: 'utf8', windowsHide: true, timeout: 120000 })
fs.writeFileSync(path.join(cache, 'final-package-runtime-waited.json'), result.stdout || '')
fs.writeFileSync(path.join(cache, 'final-package-runtime-waited.stderr.log'), result.stderr || '')
const receipt = { command: '<packaged Electron.exe> <helper> runtime <worktree> <release>',
  started, finished: new Date().toISOString(), environment, network: 'none; Fastify inject',
  exitCode: result.status, signal: result.signal, error: result.error ? String(result.error) : null,
  waitedForChild: true, windowsHide: true }
fs.writeFileSync(path.join(cache, 'final-package-runtime-waited.exit.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify(receipt))
if (result.stdout) console.log(result.stdout)
if (result.stderr) console.error(result.stderr)
process.exitCode = result.status === 0 ? 0 : 1
