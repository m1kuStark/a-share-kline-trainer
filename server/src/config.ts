import { homedir } from 'node:os'
import { join } from 'node:path'
import { discoverTdxRoot, defaultTdxCandidates } from './tdx/discover.js'

export interface AppConfig {
  port: number
  host: string
  databasePath: string
  tdxRoot: string | null
}

export async function loadConfig(): Promise<AppConfig> {
  const configuredRoot = process.env.TDX_ROOT?.trim()
  const discovery = configuredRoot
    ? await discoverTdxRoot([configuredRoot])
    : await discoverTdxRoot(defaultTdxCandidates())
  return {
    port: Number(process.env.PORT ?? 8787),
    host: process.env.HOST ?? '127.0.0.1',
    databasePath: process.env.TRAINER_DB ?? join(homedir(), '.a-share-kline-trainer', 'trainer.sqlite'),
    tdxRoot: discovery?.root ?? null,
  }
}
