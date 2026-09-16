<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import { fetchActiveTraining, fetchEnv } from './api'
import type { TrainingSnapshot } from './api'
import { applyThemeClass, theme, toggleTheme } from './theme'
import { cancelDataWatchers, checkDataStatus, dataRefreshError, dataStatus, dataUpdating, onDataActive, refreshDataNow } from './dataStatus'
import { Moon, Sun } from 'lucide-vue-next'
import Launcher from './views/Launcher.vue'
import Training from './views/Training.vue'

type View = 'loading' | 'launcher' | 'training'
const view = ref<View>('loading')
const snapshot = ref<TrainingSnapshot | null>(null)
const env = ref<Awaited<ReturnType<typeof fetchEnv>> | null>(null)
const envError = ref('')

watchEffect(() => applyThemeClass())

async function refresh(): Promise<void> {
  try {
    const requested = new URL(location.href).searchParams.get('training')
    const result = requested && /^[1-9]\d*$/.test(requested)
      ? await fetch(`/api/trainings/${requested}`).then(async response => { if (!response.ok) throw new Error('训练不存在'); return await response.json() as TrainingSnapshot })
      : await fetchActiveTraining()
    if ('training' in result && result.training === null) {
      snapshot.value = null
      view.value = 'launcher'
    } else {
      snapshot.value = result as TrainingSnapshot
      view.value = 'training'
    }
  } catch (error) {
    envError.value = error instanceof Error ? error.message : '无法连接本地服务'
    view.value = 'launcher'
  }
}

// ===== 日线数据状态接线 =====
// 启动立即检查一次；focus / visibilitychange→visible 交给 store 的 60s 节流；
// 隐藏时不检查不轮询（store 内部守卫）。卸载时监听器成对移除＋轮询清理。
function onDataFocus(): void {
  onDataActive()
}
function onDataVisibilityChange(): void {
  if (document.visibilityState === 'visible') onDataActive()
}

// 首页顶栏"更新日线"控件状态机：legacy＝状态未知（回退旧 env 文案）
const dataWidgetState = computed<'legacy' | 'ok' | 'running' | 'failed' | 'attention' | 'unavailable'>(() => {
  const status = dataStatus.value
  if (!status) return 'legacy'
  if (dataUpdating.value) return 'running'
  if (status.state === 'failed' || status.lastResult?.outcome === 'failed') return 'failed'
  if (status.needsUpdate && (status.tdx.available || status.source.available)) return 'attention'
  if (!status.needsUpdate && status.source.available) return 'ok'
  if (!status.tdx.available && !status.online.configured) return 'unavailable'
  return 'legacy'
})
const dataCutoffText = computed(() => dataStatus.value?.sourceMaxDate ?? env.value?.dataCutoff ?? 'N/A')
function updateData(): void {
  void refreshDataNow()
}

// 醒目按钮的摇晃重触发：入场由 CSS 播 3 次，此后每约 12s 换 key 重挂载重播（尊重 prefers-reduced-motion）
const shakeTick = ref(0)
let shakeTimer: ReturnType<typeof setInterval> | undefined
watch(dataWidgetState, state => {
  if (shakeTimer !== undefined) { clearInterval(shakeTimer); shakeTimer = undefined }
  if (state === 'attention') shakeTimer = setInterval(() => { shakeTick.value++ }, 12_000)
}, { immediate: true })

onMounted(async () => {
  window.addEventListener('focus', onDataFocus)
  document.addEventListener('visibilitychange', onDataVisibilityChange)
  void checkDataStatus({ force: true })
  try {
    env.value = await fetchEnv()
  } catch (error) {
    envError.value = error instanceof Error ? error.message : '无法连接本地服务'
  }
  await refresh()
})
onUnmounted(() => {
  window.removeEventListener('focus', onDataFocus)
  document.removeEventListener('visibilitychange', onDataVisibilityChange)
  cancelDataWatchers()
  if (shakeTimer !== undefined) { clearInterval(shakeTimer); shakeTimer = undefined }
})
function onTrainingEnded(): void {
  history.replaceState(null, '', location.pathname)
  void refresh()
}
</script>

<template>
  <div class="app-shell">
    <aside class="rail" aria-label="主导航">
      <div class="brand-mark">K</div>
      <nav>
        <button class="rail-item active" title="训练">⌁<span>训练</span></button>
        <button class="rail-item" title="排行榜（M4 开放）" disabled>▤<span>排行</span></button>
        <button class="rail-item" title="复盘（M4 开放）" disabled>◫<span>复盘</span></button>
      </nav>
      <button class="rail-item rail-bottom" title="设置（M5 开放）" disabled>⚙<span>设置</span></button>
    </aside>

    <main class="workspace">
      <header class="topbar" @keydown.space.stop>
        <div class="product-heading">
          <div class="product-name">A股 K线训练器</div>
          <div v-if="view === 'launcher'" class="workspace-title">创建训练</div>
        </div>
        <div class="top-actions">
          <button class="theme-toggle" :title="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'" :aria-label="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'" @click="toggleTheme">
            <Sun v-if="theme === 'dark'" :size="14" /><Moon v-else :size="14" />
          </button>
          <!-- 首页右上角"更新日线"控件（各状态见 dataWidgetState） -->
          <template v-if="view === 'launcher'">
            <span v-if="dataWidgetState === 'ok'" class="data-status-ok" role="status">
              <span class="connection-dot"></span>数据已最新 · 截止 {{ dataCutoffText }}
            </span>
            <button v-else-if="dataWidgetState === 'running'" class="data-update-btn running" disabled>更新中<span class="data-ellipsis" aria-hidden="true"><i></i><i></i><i></i></span></button>
            <button v-else-if="dataWidgetState === 'failed'" class="data-update-btn failed" :title="dataStatus?.reason || '更新失败，点击重试'" @click="updateData">更新失败 · 点击重试</button>
            <button v-else-if="dataWidgetState === 'attention'" :key="shakeTick" class="data-update-btn attention shake" :title="dataStatus?.reason || '本地数据落后于数据源，点击更新'" @click="updateData">更新日线</button>
            <button v-else-if="dataWidgetState === 'unavailable'" class="data-update-btn unavailable" title="未检测到通达信数据目录，也未配置在线数据来源" @click="updateData">未检测到通达信数据</button>
            <template v-else>
              <span class="connection-dot" :class="{ offline: !env?.tdxRoot }"></span>
              <span class="connection-text">{{ env?.tdxRoot ? `TDX · 截止 ${env.dataCutoff ?? 'N/A'}` : 'TDX 未连接' }}</span>
            </template>
            <span v-if="dataWidgetState === 'attention'" class="data-status-note">截止 {{ dataCutoffText }}</span>
            <span v-if="dataRefreshError" class="data-refresh-error" role="alert">{{ dataRefreshError }}</span>
            <details v-if="dataStatus?.revisionWarning" class="revision-warning">
              <summary title="数据修订警示（点击展开）">修订警示</summary>
              <p>{{ dataStatus.revisionWarning }}</p>
            </details>
          </template>
          <template v-else>
            <span class="connection-dot" :class="{ offline: !env?.tdxRoot }"></span>
            <span class="connection-text">{{ env?.tdxRoot ? `TDX · 截止 ${env.dataCutoff ?? 'N/A'}` : 'TDX 未连接' }}</span>
          </template>
        </div>
      </header>

      <div v-if="envError" class="env-error">{{ envError }}：请先运行 npm run dev 或 npm start 启动后端</div>

      <Launcher v-if="view === 'launcher'" @created="refresh" />
      <Training v-else-if="view === 'training' && snapshot" :key="snapshot.training.id" :snapshot="snapshot" @ended="onTrainingEnded" />
      <div v-else class="boot-loading">正在连接本地服务…</div>
    </main>
  </div>
</template>
