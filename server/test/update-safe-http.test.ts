// P0-4（PORT-UPD-01）共享安全网络层模块级测试·真实 http 端到端。
// 矩阵行：UPD-NET-ROBUST-PROCESS-WIDE（planned → 本文件提供绑定面）。
// 背景（用户真机两次确认的崩溃证据）：全局 fetch（undici）在响应流异常结束路径从
// 内部异步抛 AssertionError [ERR_ASSERTION] assert(this.paused)（Parser.finish→
// Socket.onHttpSocketEnd）→ Electron 主进程 uncaught exception 弹 Error 窗；本机
// Node 24 纯 undici 呈现为受控 TypeError「terminated」（无已收/应收信息）——两种
// 形态都不可接受：缺字节信息即无法诊断，崩溃即主进程死亡。
// 本文件不注入任何桩——直接对 safe-http 模块 × 真实 node http server（真实入口
// 边界；截断形态与 P0-3 范本 desktop/test/portable-updater-network.test.ts 同源：
// 声明 Content-Length=N 实发 N−k 后 FIN（py http.server 少发形态）／destroy socket
// （RST 形态）／挂住不响应（超时形态））。
// oracle 独立性：字节数、期望消息中的已收/应收数值全部测试侧手写计算。

import { describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeGetText, safeRequest, SAFE_HTTP_MAX_REDIRECTS } from '../src/update/safe-http.js'

/** 确定性伪随机字节（LCG，测试侧独立构造，非实现回显） */
function deterministicBytes(total: number): Buffer {
  const buffer = Buffer.alloc(total)
  let seed = 0x2a7f03c1
  for (let i = 0; i < total; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0
    buffer[i] = seed >>> 24
  }
  return buffer
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('listen: 未拿到端口')
  return `http://127.0.0.1:${address.port}`
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
}

/** 拿一个已释放的本地端口（连接必拒） */
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

// ===== 截断（真机崩溃场景回放）：必须以含已收/应收字节的人话 Error 受控拒绝 =====
describe('safe-http: 响应截断与超时（UPD-NET-ROBUST-PROCESS-WIDE）', () => {
  it('截断（声明 N 实发 N−k 后 FIN，py http.server 少发形态）→ text() 受控 reject，含已收/应收字节', async () => {
    const N = 1_000, K = 100
    const bytes = deterministicBytes(N)
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-length': N })
      res.write(bytes.subarray(0, N - K), () => res.end())
    })
    // node http server 对 content-length 缺口响应的 end() 不立即断连，而是等
    // keepAliveTimeout（默认 5s）——收紧到 300ms 让提前结束在 vitest 预算内可见。
    server.keepAliveTimeout = 300
    const base = await listen(server)
    try {
      const response = await safeRequest(`${base}/payload.bin`, { timeoutMs: 5_000 })
      expect(response.status).toBe(200)
      // 期望数值测试侧独立计算：N−K = 900 已收 / 1000 应收（真机 116983174/117083674 同构）
      await expect(response.text()).rejects.toThrow(/已收 900\/1000 字节/)
    } finally {
      await closeServer(server)
    }
  })

  it('截断（实发 N−k 后 destroy socket，RST 形态）→ text() 受控 reject（已收字节数形态锁定）', async () => {
    const N = 1_000, K = 100
    const bytes = deterministicBytes(N)
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-length': N })
      res.write(bytes.subarray(0, N - K), () => { res.socket?.destroy() })
    })
    const base = await listen(server)
    try {
      const response = await safeRequest(`${base}/payload.bin`, { timeoutMs: 5_000 })
      // RST 下已收字节数不保证精确（在途数据可能被丢），锁「已收 <数字>/1000 字节」形态
      await expect(response.text()).rejects.toThrow(/已收 \d+\/1000 字节/)
    } finally {
      await closeServer(server)
    }
  })

  it('reader() 流式读取截断（api 下载形态）→ 最后一次 read() 以人话 Error 拒绝而非 done', async () => {
    const N = 2_000, K = 400
    const bytes = deterministicBytes(N)
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-length': N })
      res.write(bytes.subarray(0, N - K), () => res.end())
    })
    server.keepAliveTimeout = 300
    const base = await listen(server)
    try {
      const response = await safeRequest(`${base}/payload.bin`, { timeoutMs: 5_000 })
      const reader = response.reader()
      const received: number[] = []
      // 读到流结束（预期出口＝rejects：截断流必须以人话 Error 拒绝而非 done）
      const drained = (async (): Promise<void> => {
        for (;;) {
          const outcome = await reader.read()
          if (outcome.done) return
          received.push(outcome.value!.length)
        }
      })()
      await expect(drained).rejects.toThrow(/已收 \d+\/2000 字节/)
      expect(received.length).toBeGreaterThan(0)
    } finally {
      await closeServer(server)
    }
  })

  it('头阶段超时（服务端收到请求后不响应）→ 人话超时 Error（不悬挂）', async () => {
    const server = createServer(() => { /* 收到请求后永远不响应 */ })
    const base = await listen(server)
    try {
      await expect(safeRequest(`${base}/hang`, { timeoutMs: 250 })).rejects.toThrow(/超时/)
    } finally {
      await closeServer(server)
    }
  })

  it('体阶段超时（头已到、体不完结）→ 人话超时 Error（预算覆盖整个生命周期）', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-length': 1_000 })
      res.write(deterministicBytes(100))
      // 永不 end：连接保持，体不完结
    })
    const base = await listen(server)
    try {
      const response = await safeRequest(`${base}/slow-body`, { timeoutMs: 250 })
      await expect(response.text()).rejects.toThrow(/超时/)
    } finally {
      await closeServer(server)
    }
  })
})

// ===== 状态码／正常路径／重定向 =====
describe('safe-http: 状态码、完整响应与重定向', () => {
  it('HTTP 503 → safeGetText 以人话 HTTP 503 拒绝（不抛裸异常）', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(503, { 'content-length': 0 })
      res.end()
    })
    const base = await listen(server)
    try {
      await expect(safeGetText(`${base}/latest.json`, { timeoutMs: 2_000 })).rejects.toThrow(/HTTP 503/)
    } finally {
      await closeServer(server)
    }
  })

  it('完整响应 → buffer/text 字节逐一致（utf8 往返）', async () => {
    const payload = deterministicBytes(3_123)
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-length': payload.length })
      res.end(payload)
    })
    const base = await listen(server)
    try {
      const response = await safeRequest(`${base}/payload.bin`, { timeoutMs: 2_000 })
      expect((await response.buffer()).equals(payload)).toBe(true)
      const textResponse = await safeRequest(`${base}/payload.bin`, { timeoutMs: 2_000 })
      expect(await textResponse.text()).toBe(payload.toString('utf8'))
    } finally {
      await closeServer(server)
    }
  })

  it('重定向跟随（302 → 最终资源，GitHub latest/download 形态）→ 拿到最终内容', async () => {
    const payload = deterministicBytes(512)
    const server = createServer((req, res) => {
      if (req.url === '/redirect/latest') {
        res.writeHead(302, { location: '/real/latest' })
        res.end()
        return
      }
      if (req.url === '/real/latest') {
        res.writeHead(200, { 'content-length': payload.length })
        res.end(payload)
        return
      }
      res.writeHead(404).end('not found')
    })
    const base = await listen(server)
    try {
      const text = await safeGetText(`${base}/redirect/latest`, { timeoutMs: 2_000 })
      expect(text).toBe(payload.toString('utf8'))
    } finally {
      await closeServer(server)
    }
  })

  it(`重定向超过 ${SAFE_HTTP_MAX_REDIRECTS} 次（循环）→ 人话拒绝`, async () => {
    const server = createServer((req, res) => {
      const match = /^\/loop\/(\d+)$/.exec(req.url ?? '')
      if (match && Number(match[1]) < 10) {
        res.writeHead(302, { location: `/loop/${Number(match[1]) + 1}` })
        res.end()
        return
      }
      res.writeHead(200).end('end of loop')
    })
    const base = await listen(server)
    try {
      await expect(safeGetText(`${base}/loop/0`, { timeoutMs: 2_000 }))
        .rejects.toThrow(new RegExp(`重定向超过 ${SAFE_HTTP_MAX_REDIRECTS} 次`))
    } finally {
      await closeServer(server)
    }
  })

  it('redirects=error（port-conflict 探测语义）→ 3xx 即拒绝（不跟随不猜测）', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(301, { location: '/elsewhere' })
      res.end()
    })
    const base = await listen(server)
    try {
      await expect(safeRequest(`${base}/health`, { timeoutMs: 2_000, redirects: 'error' }))
        .rejects.toThrow(/重定向/)
    } finally {
      await closeServer(server)
    }
  })
})

// ===== 请求错误冒泡（保留 code 供上层分类）与 POST（控制面形态） =====
describe('safe-http: 请求错误冒泡与 POST', () => {
  it('连接拒绝（无服务端口）→ 请求错误冒泡且保留 code=ECONNREFUSED', async () => {
    const port = await freedPort()
    try {
      await safeRequest(`http://127.0.0.1:${port}/api/health`, { timeoutMs: 2_000 })
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe('ECONNREFUSED')
      return
    }
    throw new Error('连接拒绝必须 reject')
  })

  it('POST：method/body/header 到达服务端（回显验证）＋非 2xx 可读 error 体（postControl 形态）', async () => {
    const seen: Array<{ method?: string, body?: string, token?: string | string[] }> = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
      req.on('end', () => {
        seen.push({ method: req.method, body, token: req.headers['x-control-token'] })
        res.writeHead(409, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: `CONTROL_REJECTED:${body}` }))
      })
    })
    const base = await listen(server)
    const root = await mkdtemp(join(tmpdir(), 'safe-http-'))
    try {
      expect(root).toBeTruthy() // 仅防 mkdtemp 抛错被吞；无文件断言
      const response = await safeRequest(`${base}/api/setup/control/prepare`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-control-token': 'token-123' },
        body: JSON.stringify({ runId: 'run-x', attemptId: 'update-y' }),
        timeoutMs: 2_000,
      })
      expect(response.status).toBe(409)
      expect(response.ok).toBe(false)
      const echoed = JSON.parse(await response.text()) as { error: string }
      expect(echoed.error).toBe('CONTROL_REJECTED:{"runId":"run-x","attemptId":"update-y"}')
      expect(seen).toEqual([{
        method: 'POST',
        body: '{"runId":"run-x","attemptId":"update-y"}',
        token: 'token-123',
      }])
    } finally {
      await rm(root, { recursive: true, force: true })
      await closeServer(server)
    }
  })
})
