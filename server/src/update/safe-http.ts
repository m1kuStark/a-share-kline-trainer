// P0-4（PORT-UPD-01）主进程共享安全网络层：Node 原生 http/https，零新依赖。
// 背景（用户真机两次确认的崩溃证据）：全局 fetch（undici）在响应流异常结束路径从
// 内部异步抛 AssertionError [ERR_ASSERTION] assert(this.paused)（Parser.finish→
// Socket.onHttpSocketEnd），该异常不经任何可 await 的路径——try/catch 不可拦，
// Electron 主进程 uncaughtException 弹「A JavaScript error occurred in the main
// process」崩溃窗。P0-3 已单独修 desktop 便携更新通道（portable-updater.ts，本模块
// 的风格与错误语义范本）；本模块把主进程内其余全部 fetch 调用点收敛到同一原生层：
//   - update/manifest.ts（GitHub latest.json 清单，用户网络对 GitHub 不稳的主崩源）
//   - update/api.ts（清单＋zip/SHA256SUMS 资产下载，/api/update/check 与 apply 链）
//   - update/updater.ts（localhost setup 控制面 POST＋健康探测，500/1000ms 短超时）
//   - desktop/src/port-conflict.ts（端口冲突健康探测，经 server/dist 产物引用；
//     redirects:'error' 保持 launcher redirect:'error' 冻结语义）
// 错误语义（对齐 P0-3）：截断→含已收/应收字节的人话 Error；非 2xx（safeGetText）→
// `HTTP <code>`；请求错误原样冒泡（保留 ECONNREFUSED 等 code 供上层分类）；
// 超时→req.destroy(timeoutError)（预算覆盖头＋体整个生命周期）；重定向上限 5。
// 约束：本模块绝不引用全局 fetch；重定向跟随时保留方法与请求头（消费面全为 GET
// 清单/资产或 localhost 控制面，无 POST 重定向依赖）。
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'

/** 跟随重定向上限（GitHub releases/latest/download → 签名 CDN 为一跳；防循环兜底） */
export const SAFE_HTTP_MAX_REDIRECTS = 5
const DEFAULT_USER_AGENT = 'a-share-kline-trainer-updater'

export type SafeHttpRedirectPolicy = 'follow' | 'error'

export interface SafeHttpOptions {
  /** 请求方法（默认 GET）；POST 需同时给 body */
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  /** POST 请求体（字符串，通常 JSON） */
  body?: string
  /** 超时预算（毫秒），覆盖头到达与响应体读取的整个生命周期（AbortSignal.timeout 同语义） */
  timeoutMs: number
  /** 超时错误消息（缺省「请求超时（N 秒）」） */
  timeoutMessage?: string
  /** 重定向策略：follow（默认，上限 SAFE_HTTP_MAX_REDIRECTS）｜error（探测语义，3xx 即拒） */
  redirects?: SafeHttpRedirectPolicy
}

export interface SafeHttpBodyReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>
}

export interface SafeHttpResponse {
  status: number
  /** 2xx 判定（fetch response.ok 同口径） */
  ok: boolean
  /** 大小写不敏感取头（fetch Headers.get 同口径；多值以逗号连接） */
  headers: { get(name: string): string | null }
  /** 读完响应体并校验字节完整性（缺口→含已收/应收字节的人话 Error） */
  text(): Promise<string>
  /** 同 text()，返回字节 */
  buffer(): Promise<Buffer>
  /** 流式读取（增量进度）；截断流以人话 Error 拒绝而非 done；单响应单消费模式 */
  reader(): SafeHttpBodyReader
  /** 丢弃响应体释放连接（不校验完整性；不读体时调用，避免连接悬挂） */
  discard(): void
}

/** 按 URL protocol 选原生模块（http:// 本地测试/localhost 控制面；https:// GitHub/CDN；其余 fail-closed） */
function requestForUrl(
  url: string,
  method: string,
  headers: Record<string, string>,
  callback: (res: IncomingMessage) => void,
): ClientRequest {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`请求 URL 无法解析：${url}`)
  }
  const options = { method, headers: { 'user-agent': DEFAULT_USER_AGENT, ...headers } }
  if (parsed.protocol === 'http:') return httpRequest(url, options, callback)
  if (parsed.protocol === 'https:') return httpsRequest(url, options, callback)
  throw new Error(`请求协议不支持（仅 http/https）：${parsed.protocol}`)
}

interface OpenedResponse {
  promise: Promise<IncomingMessage>
  /** 超时中止当前跳（携带人话超时 Error；头阶段经 req error 拒绝，体阶段经流中止拒绝） */
  destroyCurrent: (error: Error) => void
}

/** 打开响应（含重定向策略）；resolve＝最终响应，reject＝请求错误（原样冒泡保留 code）／重定向拒绝 */
function openResponse(url: string, options: SafeHttpOptions, method: string): OpenedResponse {
  let currentReq: ClientRequest | null = null
  const promise = new Promise<IncomingMessage>((resolve, reject) => {
    let currentUrl = url
    let remainingRedirects = SAFE_HTTP_MAX_REDIRECTS
    let settled = false
    const fail = (error: Error): void => {
      if (!settled) {
        settled = true
        reject(error)
      }
    }
    const attempt = (): void => {
      let req: ClientRequest
      try {
        req = requestForUrl(currentUrl, method, options.headers ?? {}, res => {
          const status = res.statusCode ?? 0
          const location = res.headers.location
          const isRedirect = status >= 300 && status < 400 && typeof location === 'string' && location !== ''
          if (!isRedirect) {
            settled = true
            resolve(res)
            return
          }
          res.resume() // 排空 3xx 响应体再跳转/拒绝，释放连接
          if (options.redirects === 'error') {
            req.destroy()
            fail(new Error(`HTTP ${status} 重定向至 ${location}，按 redirect 策略已拒绝`))
            return
          }
          if (remainingRedirects <= 0) {
            req.destroy()
            fail(new Error(`重定向超过 ${SAFE_HTTP_MAX_REDIRECTS} 次（疑似循环），已拒绝`))
            return
          }
          remainingRedirects -= 1
          try {
            currentUrl = new URL(location, currentUrl).toString()
          } catch {
            fail(new Error(`重定向地址无法解析：${location}`))
            return
          }
          attempt()
        })
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
        return
      }
      currentReq = req
      req.on('error', error => { if (req === currentReq) fail(error) })
      if (method === 'POST' && options.body !== undefined) req.write(options.body)
      req.end()
    }
    attempt()
  })
  return { promise, destroyCurrent: (error: Error) => { currentReq?.destroy(error) } }
}

/** 字节缺口人话描述（流提前结束/被重置→已收/应收；超时→超时消息优先） */
function describeStreamFailure(
  received: number,
  total: number,
  cause: unknown,
  timedOut: boolean,
  timeoutError: Error,
): Error {
  if (timedOut) return timeoutError
  if (total > 0 && received < total) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    return new Error(`下载中断：已收 ${received}/${total} 字节（${detail}）`)
  }
  return cause instanceof Error ? cause : new Error(String(cause))
}

/**
 * 安全 HTTP 请求（本模块的低层入口）：resolve＝最终响应对象（体未读——由消费方
 * text/buffer/reader/discard 单一模式消费）。reject＝请求错误（保留 code）／超时
 * （人话）／重定向拒绝（按策略）。
 */
export async function safeRequest(url: string, options: SafeHttpOptions): Promise<SafeHttpResponse> {
  const method = options.method ?? 'GET'
  const timeoutError = new Error(options.timeoutMessage ?? `请求超时（${options.timeoutMs / 1000} 秒）`)
  let timedOut = false
  const opened = openResponse(url, options, method)
  // 预算覆盖整个生命周期：头阶段失败/体阶段读完（或中止）时才清除
  const timer = setTimeout(() => {
    timedOut = true
    opened.destroyCurrent(timeoutError)
  }, options.timeoutMs)
  const clearTimer = (): void => { clearTimeout(timer) }
  let res: IncomingMessage
  try {
    res = await opened.promise
  } catch (error) {
    clearTimer()
    throw error
  }
  const total = Number(res.headers['content-length']) || 0
  let received = 0
  let bodyPromise: Promise<Buffer> | null = null
  const readAll = (): Promise<Buffer> => {
    bodyPromise ??= new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      let settled = false
      const finish = (outcome: () => void): void => {
        if (settled) return
        settled = true
        clearTimer()
        outcome()
      }
      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        received += chunk.length
      })
      res.on('error', cause => finish(() => reject(describeStreamFailure(received, total, cause, timedOut, timeoutError))))
      // close 兜底：destroy（超时等）未走 error/end 时的收尾出口；正常 end 后为 no-op
      res.on('close', () => finish(() => reject(describeStreamFailure(received, total, new Error('连接已中止'), timedOut, timeoutError))))
      res.on('end', () => finish(() => {
        if (total > 0 && received < total) reject(new Error(`下载中断：已收 ${received}/${total} 字节（连接提前结束）`))
        else resolve(Buffer.concat(chunks))
      }))
    })
    return bodyPromise
  }
  let activeReader: SafeHttpBodyReader | null = null
  return {
    status: res.statusCode ?? 0,
    ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
    headers: {
      get: (name: string): string | null => {
        const value = res.headers[name.toLowerCase()]
        if (typeof value === 'string') return value
        if (Array.isArray(value)) return value.join(', ')
        return null
      },
    },
    text: async () => (await readAll()).toString('utf8'),
    buffer: readAll,
    reader: () => {
      activeReader ??= (() => {
        const iterator = res[Symbol.asyncIterator]()
        let done = false
        return {
          async read(): Promise<{ done: boolean; value?: Uint8Array }> {
            if (done) return { done: true }
            try {
              const next = await iterator.next()
              if (next.done) {
                if (total > 0 && received < total) {
                  throw new Error(`下载中断：已收 ${received}/${total} 字节（连接提前结束）`)
                }
                done = true
                clearTimer()
                return { done: true }
              }
              received += next.value.length
              return { done: false, value: next.value }
            } catch (cause) {
              done = true
              clearTimer()
              throw describeStreamFailure(received, total, cause, timedOut, timeoutError)
            }
          },
        }
      })()
      return activeReader
    },
    discard: () => {
      res.on('close', () => clearTimer())
      res.resume()
    },
  }
}

/**
 * 便捷文本获取（GET→string）：非 2xx → 人话 `HTTP <code>` Error（排空 3xx/错误体）；
 * 2xx → 读完响应体并校验字节完整性。截断/超时/请求错误按模块语义。
 */
export async function safeGetText(url: string, options: Omit<SafeHttpOptions, 'method' | 'body'>): Promise<string> {
  const response = await safeRequest(url, { ...options, method: 'GET' })
  if (!response.ok) {
    response.discard()
    throw new Error(`HTTP ${response.status}`)
  }
  return await response.text()
}

/** 便捷 JSON 获取（GET→parsed JSON）；清单/健康体等小 JSON 场景 */
export async function safeGetJson<T = unknown>(url: string, options: Omit<SafeHttpOptions, 'method' | 'body'>): Promise<T> {
  return JSON.parse(await safeGetText(url, options)) as T
}
