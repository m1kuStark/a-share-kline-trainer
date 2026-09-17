import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { stateDirectory } from './state.js'

export async function withIntegrationLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const directory = stateDirectory(root)
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'lock')
  const token = randomUUID()
  let handle
  try { handle = await open(path, 'wx') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Integration lock exists: ${path}. Inspect its owner before manually recovering an interrupted operation; locks are never stolen.`)
    throw error
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }) + '\n')
  } finally { await handle.close() }
  try { return await action() }
  finally {
    const owner = JSON.parse(await readFile(path, 'utf8')) as { token?: string }
    if (owner.token !== token) throw new Error(`Integration lock ownership changed: ${path}; refusing to remove it`)
    await unlink(path)
  }
}
