import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { dirname, join } from 'node:path'

function npmCli(): string {
  const paths = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')]
  const path = paths.find(value => value && /npm-cli\.js$/i.test(value) && existsSync(value))
  if (!path) throw new Error('Cannot locate npm-cli.js; run this tool through npm run task')
  return path
}
export async function npm(root: string, args: string[], logPath: string): Promise<void> {
  const log = await open(logPath, 'a')
  try {
    await log.write(`\n$ npm ${args.join(' ')}\n`)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [npmCli(), ...args], { cwd: root, env: { ...process.env, OPEN_BROWSER: '0' }, windowsHide: true, stdio: ['ignore', log.fd, log.fd] })
      child.once('error', reject)
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`npm ${args[0]} failed (${signal ?? code}); log: ${logPath}`)))
    })
  } finally { await log.close() }
}
