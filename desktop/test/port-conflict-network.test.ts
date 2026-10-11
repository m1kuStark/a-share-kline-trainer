// P0-4（PORT-UPD-01）desktop 端口冲突健康探测·真实 http 端到端（调用点级）。
// 矩阵行：UPD-NET-ROBUST-PROCESS-WIDE（planned → 本文件提供绑定面）。
// probeHealthHttp 是主进程启动路径上的 fetch 调用点（desktop/src/port-conflict.ts）；
// 本文件不注入桩——真实 node http server 复现四种探测场景，锁 launcher 冻结语义
// （127.0.0.1 专用、redirect 拒绝、仅 200 计身份）在新网络层（server 侧 safe-http
// 产物，redirects:'error'）下逐项保持。
// 注：截断场景在本机 Node（undici/safe-http）下同为受控拒绝（json=null）——
// Electron 真机的 undici 断言崩溃由换线本身根治，无法在 Node vitest 复现。
import { describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { probeHealthHttp } from '../src/port-conflict.js'

async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('listen: 未拿到端口')
  return address.port
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
}

function freedPort(): Promise<number> {
  return new Promise(resolve => {
    const probe = createServer()
    probe.once('error', () => resolve(freedPort()))
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = address !== null && typeof address !== 'string' ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

describe('UPD-NET-ROBUST-PROCESS-WIDE: probeHealthHttp 真实网络行为（默认实现，无桩）', () => {
  it('trainer 身份（200＋status/runId/pid）→ responded 且 json 三字段可判身份', async () => {
    const body = JSON.stringify({ status: 'ok', runId: 'run-1', pid: 4321, currentVersion: '1.2.7' })
    const server = createServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
        res.end(body)
        return
      }
      res.writeHead(404).end()
    })
    const port = await listen(server)
    try {
      const probe = await probeHealthHttp(port)
      expect(probe).toEqual({ responded: true, refused: false, status: 200, json: JSON.parse(body) })
    } finally {
      await closeServer(server)
    }
  })

  it('redirect（301 到别处）→ 受控拒绝：responded=false 且 refused=false（redirect 策略保持，绝不算身份）', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(301, { location: '/elsewhere' })
      res.end()
    })
    const port = await listen(server)
    try {
      const probe = await probeHealthHttp(port)
      expect(probe).toEqual({ responded: false, refused: false, status: null, json: null })
    } finally {
      await closeServer(server)
    }
  })

  it('端口无服务（连接拒绝）→ refused=true（启动 bind 裁决依据，code 冒泡保持）', async () => {
    const port = await freedPort()
    const probe = await probeHealthHttp(port)
    expect(probe).toEqual({ responded: false, refused: true, status: null, json: null })
  })

  it('200 但响应体截断（声明 N 实发 N−k 后 FIN）→ 受控失败：responded=true、json=null（绝无网络层异常外溢）', async () => {
    const body = JSON.stringify({ status: 'ok', runId: 'run-2', pid: 99, currentVersion: '1.2.7' })
    const N = Buffer.byteLength(body)
    const K = 20
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': N })
      res.write(Buffer.from(body, 'utf8').subarray(0, N - K), () => res.end())
    })
    server.keepAliveTimeout = 300
    const port = await listen(server)
    try {
      const probe = await probeHealthHttp(port)
      // 与旧 fetch 行为一致：体读失败 → json=null；status 200 已到 → responded=true；
      // json 非法 → isTrainerHealthBody=false → 不计训练器身份（安全侧：不 reuse 不 kill）
      expect(probe).toEqual({ responded: true, refused: false, status: 200, json: null })
    } finally {
      await closeServer(server)
    }
  })

  it('头阶段超时（服务端不响应）→ responded=false、refused=false（1.2 秒预算内受控失败）', async () => {
    const server = createServer(() => { /* 收到请求后永远不响应 */ })
    const port = await listen(server)
    try {
      const startedAt = Date.now()
      const probe = await probeHealthHttp(port)
      expect(probe).toEqual({ responded: false, refused: false, status: null, json: null })
      // HEALTH_TIMEOUT_MS=1200；宽放至 5 秒内完成（超时路径必须收敛，不得悬挂）
      expect(Date.now() - startedAt).toBeLessThan(5_000)
    } finally {
      await closeServer(server)
    }
  })
})
