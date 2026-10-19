import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, isAbsolute } from 'node:path'
import { request } from 'node:http'
import { createServer as reservePort } from 'node:net'
import { createServer as createViteServer } from 'vite'
import { startTrainerServer, type StartedTrainerServer } from '../src/index.js'

describe('local HTTP request boundary', () => {
  let directory: string
  let server: StartedTrainerServer
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'builder-local-origin-'))
    const databasePath = join(directory, 'trainer.sqlite')
    const within = relative(directory, databasePath)
    if (within.startsWith('..') || isAbsolute(within)) throw new Error('Test database is not isolated')
    await mkdir(join(directory, 'web'))
    for (const [key, value] of Object.entries({
      PORT: '0', HOST: '127.0.0.1', TDX_ROOT: '', OPEN_BROWSER: '0',
      TRAINER_RUN_ID: 'builder-origin-test', TRAINER_DB: databasePath,
      TRAINER_DATA_DIR: directory, TRAINER_STATIC_DIR: join(directory, 'web'),
      TRAINER_READY_FILE: join(directory, 'ready.json'), TRAINER_CONTROL_TOKEN: 'isolated-test-token',
    })) vi.stubEnv(key, value)
    server = await startTrainerServer()
    expect(server.config.databasePath).toBe(databasePath)
  })
  afterAll(async () => {
    await server?.shutdown()
    vi.unstubAllEnvs()
    if (directory) await rm(directory, { recursive: true, force: true })
  })
  beforeEach(async () => {
    const reset = await server.app.inject({ method: 'PUT', url: '/api/settings/app', payload: { autoDataCheck: true } })
    expect(reset.statusCode).toBe(200)
  })

  it('rejects foreign and opaque origins before reading or writing local records', async () => {
    for (const origin of ['https://review-example.invalid', 'null', 'http://127.0.0.1:5173']) {
      const headers = { host: `127.0.0.1:${server.port}`, origin }
      const read = await server.app.inject({ method: 'GET', url: '/api/trainings/history', headers })
      expect(read.statusCode).toBe(403)
      expect(read.headers['access-control-allow-origin']).toBeUndefined()
      const write = await server.app.inject({ method: 'PUT', url: '/api/settings/app', headers, payload: { autoDataCheck: false } })
      expect(write.statusCode).toBe(403)
    }
    const state = await server.app.inject({ method: 'GET', url: '/api/settings/app' })
    expect(state.json().autoDataCheck).toBe(true)
  })

  it('rejects cross-site metadata even when Origin is absent', async () => {
    for (const site of ['cross-site', 'same-site', 'unexpected']) {
      const response = await server.app.inject({ method: 'GET', url: '/api/trainings/history', headers: { 'sec-fetch-site': site } })
      expect(response.statusCode).toBe(403)
    }
  })

  it('rejects non-loopback Host including an attacker origin matching that Host', async () => {
    for (const host of [`review-example.invalid:${server.port}`, `127.0.0.1.review-example.invalid:${server.port}`]) {
      const response = await server.app.inject({ method: 'PUT', url: '/api/settings/app', headers: { host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin' }, payload: { autoDataCheck: false } })
      expect(response.statusCode).toBe(403)
    }
    const state = await server.app.inject({ method: 'GET', url: '/api/settings/app' })
    expect(state.json().autoDataCheck).toBe(true)
  })

  it('keeps real loopback requests and same-origin writes working without weakening control tokens', async () => {
    const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      const call = request({ host: '127.0.0.1', port: server.port, path: '/api/health' }, incoming => {
        let body = ''
        incoming.setEncoding('utf8')
        incoming.on('data', part => { body += part })
        incoming.on('end', () => resolve({ status: incoming.statusCode, body }))
      })
      call.on('error', reject)
      call.end()
    })
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body).runId).toBe('builder-origin-test')
    for (const host of [`127.0.0.1:${server.port}`, 'localhost:5173', '[::1]:5173']) {
      // Vite preserves the original Host and Origin when proxying same-origin /api requests.
      const headers = { host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin' }
      const write = await server.app.inject({ method: 'PUT', url: '/api/settings/app', headers, payload: { autoDataCheck: false } })
      expect(write.statusCode).toBe(200)
      const read = await server.app.inject({ method: 'GET', url: '/api/settings/app', headers: { host, 'sec-fetch-site': 'same-origin' } })
      expect(read.json().autoDataCheck).toBe(false)
    }
    const control = await server.app.inject({ method: 'POST', url: '/api/setup/control/prepare', headers: { host: `127.0.0.1:${server.port}` }, payload: { runId: 'builder-origin-test', attemptId: 'origin-guard-control' } })
    expect(control.statusCode).toBe(401)
    expect(control.json().error).toBe('TOKEN_MISSING')
    await server.app.inject({ method: 'PUT', url: '/api/settings/app', payload: { autoDataCheck: true } })
  })

  it('rejects foreign preflight and forged same-origin metadata without mutating preferences', async () => {
    const headers = { host: `127.0.0.1:${server.port}`, origin: 'https://review-example.invalid', 'sec-fetch-site': 'same-origin' }
    const preflight = await server.app.inject({ method: 'OPTIONS', url: '/api/settings/app', headers: { ...headers, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' } })
    expect(preflight.statusCode).toBe(403)
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
    const write = await server.app.inject({ method: 'PUT', url: '/api/settings/app', headers, payload: { autoDataCheck: false } })
    expect(write.statusCode).toBe(403)
    const state = await server.app.inject({ method: 'GET', url: '/api/settings/app' })
    expect(state.json().autoDataCheck).toBe(true)
  })

  it('preserves browser Origin and Host through the actual Vite proxy for same-origin writes', async () => {
    vi.stubEnv('VITE_API_TARGET', `http://127.0.0.1:${server.port}`)
    const reservation = reservePort()
    await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve) })
    const reserved = reservation.address()
    if (!reserved || typeof reserved === 'string') throw new Error('Could not allocate a Vite port')
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
    const vite = await createViteServer({ configFile: 'web/vite.config.ts', server: { host: '127.0.0.1', port: reserved.port, strictPort: true } })
    try {
      await vite.listen()
      const address = vite.httpServer!.address()
      if (!address || typeof address === 'string') throw new Error('Vite did not bind a loopback port')
      const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
        const call = request({
          host: '127.0.0.1', port: address.port, path: '/api/settings/app', method: 'PUT',
          headers: { origin: `http://127.0.0.1:${address.port}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
        }, incoming => {
          let body = ''
          incoming.setEncoding('utf8')
          incoming.on('data', part => { body += part })
          incoming.on('end', () => resolve({ status: incoming.statusCode, body }))
        })
        call.on('error', reject)
        call.end(JSON.stringify({ autoDataCheck: false }))
      })
      expect(response.status, response.body).toBe(200)
      const state = await server.app.inject({ method: 'GET', url: '/api/settings/app' })
      expect(state.json().autoDataCheck).toBe(false)
    } finally { await vite.close() }
  }, 15_000)
})
