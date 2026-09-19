import { computed, onUnmounted, ref } from 'vue'
import { ApiError, fetchRecordingContext, type RecordingContext, type TrainingSnapshot } from '../api'
import { Recorder } from './recorder'
import { IndexedDbRecordingStorage } from './storage'
import { exportRecording } from './validation'
import type { Action, ChartCapture, CheckpointInput, JsonValue, RecorderStatus, RecordingEventSource } from './types'

export const recordingStorage = new IndexedDbRecordingStorage()
/** Vue objects may contain proxies; serialize only the known public DTOs. */
export function recordingPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('录制状态包含无效数值')
    return item
  })) as T
}
export function downloadRecording(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function useRecording(options: {
  snapshot: () => TrainingSnapshot
  ui: () => CheckpointInput['ui']
  enabled: boolean
  ready: () => boolean
  readChart: () => ChartCapture | null
  createdParams?: Record<string, string | number>
}) {
  const status = ref<RecorderStatus>({ state: 'paused', error: null, eventCount: 0, sessionId: '' })
  const ready = ref(false), enabled = ref(options.enabled), error = ref('')
  let recorder: Recorder | null = null, context: RecordingContext | null = null, chart: ChartCapture | null = null
  let initializing: Promise<void> | null = null, disposed = false, signature = ''
  let initializationInterrupted = false
  let recoveryPreference: boolean | null = null
  const pending = new Set<string>()
  const checkpoint = (): CheckpointInput => recordingPlain({ training: options.snapshot(), chart: options.ready() ? (options.readChart() ?? chart) : null, ui: options.ui(), context: context as unknown as JsonValue })
  const fail = (reason: unknown) => { error.value = reason instanceof Error ? reason.message : String(reason) }
  async function initialize(): Promise<void> {
    if (ready.value || disposed || !chart?.bars.length || !options.ready()) return
    if (initializing) return initializing
    initializing = (async () => {
      try {
        error.value = ''
        const snapshot = options.snapshot()
        context = await fetchRecordingContext(snapshot.training.id)
        if (disposed) return
        recorder ??= new Recorder(recordingStorage, {
          app: context.app, environment: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio },
          onChange: value => {
            status.value = value
            if (value.state === 'paused') enabled.value = false
            else if (value.state === 'recording') enabled.value = true
            else if (value.sessionId && recorder) enabled.value = !recorder.getFile().gaps.some(gap => gap.resumedAtSeq === null)
          },
        })
        const key = `${snapshot.training.id}.${snapshot.training.createdAt}`
        const storageKey = `trainer.recording.${key}`
        const saved = sessionStorage.getItem(storageKey)
        if (!recorder.getStatus().sessionId) {
          if (saved) {
            await recorder.restore(saved)
            recoveryPreference = !recorder.getFile().gaps.some(gap => gap.resumedAtSeq === null)
          }
          else {
            // Retain the session pointer even if its first disk write fails; retry the same recorder.
            recoveryPreference = options.enabled
            const starting = recorder.start(key, checkpoint(), options.enabled && !initializationInterrupted)
            sessionStorage.setItem(storageKey, recorder.getStatus().sessionId)
            await starting
            if (options.createdParams && enabled.value && !initializationInterrupted) {
              const op = recorder.begin('training.create', recordingPlain(options.createdParams))
              if (op) recorder.finish(op, 'accepted', recordingPlain(snapshot.training) as unknown as JsonValue, checkpoint())
            }
          }
        } else await recorder.flush()
        if (initializationInterrupted) {
          if (!recorder.getFile().gaps.some(gap => gap.resumedAtSeq === null)) await recorder.pause(checkpoint())
          if (recoveryPreference) await recorder.resume(checkpoint())
          initializationInterrupted = false
        }
        sessionStorage.setItem(storageKey, recorder.getStatus().sessionId)
        enabled.value = !recorder.getFile().gaps.some(gap => gap.resumedAtSeq === null)
        ready.value = true
        // A restored session starts observing the actual current state; no invented past operations.
        if (saved && enabled.value) recorder.capture(checkpoint())
      } catch (reason) { initializationInterrupted = true; fail(reason) }
      finally { initializing = null }
    })()
    await initializing
  }
  function capture(value: ChartCapture): void {
    try {
      chart = recordingPlain(value)
      if (!ready.value) { void initialize(); return }
      if (!ready.value || !options.ready() || !enabled.value) return
      const input = checkpoint()
      const next = JSON.stringify(input)
      if (next === signature) return
      signature = next
      recorder?.capture(input)
    } catch (reason) { fail(reason) }
  }
  function begin(action: Action, params?: unknown, source: RecordingEventSource = 'ui'): string | null {
    if (!ready.value || !recorder) return null
    try {
      const id = recorder.begin(action, params === undefined ? undefined : recordingPlain(params) as JsonValue, source)
      if (id) pending.add(id)
      return id
    }
    catch (reason) { fail(reason); return null }
  }
  function finish(opId: string | null, outcome: 'accepted' | 'failed' | 'rejected' | 'unknown' | 'cancelled', result?: unknown): void {
    if (!opId || !recorder || !pending.delete(opId)) return
    try { recorder.finish(opId, outcome, result === undefined ? undefined : recordingPlain(result) as JsonValue, checkpoint()) }
    catch (reason) { fail(reason) }
  }
  function rejected(opId: string | null, reason: unknown): void {
    finish(opId, reason instanceof ApiError && reason.status < 500 ? 'rejected' : 'unknown', { message: reason instanceof Error ? reason.message : String(reason) })
  }
  function operation(value: { action: Action; params?: JsonValue }): void {
    const id = begin(value.action, value.params, 'chart'); finish(id, 'accepted')
  }
  async function toggle(): Promise<void> {
    if (!recorder || !ready.value) return
    error.value = ''
    try {
      if (enabled.value) { pending.clear(); await recorder.pause(checkpoint()) }
      else await recorder.resume(checkpoint())
    } catch (reason) { fail(reason) }
    finally { enabled.value = !recorder.getFile().gaps.some(gap => gap.resumedAtSeq === null) }
  }
  async function exportFile(): Promise<void> {
    if (!recorder) return
    error.value = ''
    try {
      if (enabled.value) recorder.capture(checkpoint())
      const file = await recorder.export()
      downloadRecording(exportRecording(file), `训练录制-${file.sessionId}.trainer-session.json`)
    } catch (reason) { fail(reason) }
  }
  async function flush(): Promise<void> { try { await recorder?.flush() } catch (reason) { fail(reason) } }
  async function retry(): Promise<void> {
    error.value = ''
    if (!ready.value) await initialize()
    else {
      try {
        // Retry the actual capture too: a successful disk flush cannot repair a malformed chart.
        const current = options.readChart()
        if (current) capture(current)
        await flush()
      } catch (reason) { fail(reason) }
    }
  }
  async function refreshContext(): Promise<void> {
    try { context = await fetchRecordingContext(options.snapshot().training.id) } catch (reason) { fail(reason) }
  }
  const label = computed(() => error.value || status.value.state === 'error' ? '记录失败' : !ready.value ? '准备录制' : enabled.value ? '正在记录' : '已暂停记录')
  const onHide = () => { void flush() }
  window.addEventListener('pagehide', onHide)
  onUnmounted(() => { disposed = true; window.removeEventListener('pagehide', onHide); void flush() })
  return { status, ready, enabled, error, label, capture, initialize, begin, finish, rejected, operation, toggle, exportFile, flush, refreshContext, retry, fail }
}
