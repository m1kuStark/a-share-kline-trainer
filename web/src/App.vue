<script setup lang="ts">
import { onMounted, ref, watchEffect } from 'vue'
import { fetchActiveTraining, fetchEnv } from './api'
import type { TrainingSnapshot } from './api'
import { applyThemeClass, theme, toggleTheme } from './theme'
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
    const result = await fetchActiveTraining()
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

onMounted(async () => {
  try {
    env.value = await fetchEnv()
  } catch (error) {
    envError.value = error instanceof Error ? error.message : '无法连接本地服务'
  }
  await refresh()
})
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
      <header class="topbar">
        <div>
          <div class="product-name">A股 K线训练器</div>
          <div class="workspace-title">{{ view === 'training' ? '训练进行中' : '创建训练' }}</div>
        </div>
        <div class="top-actions">
          <button class="theme-toggle" :title="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'" @click="toggleTheme">
            {{ theme === 'dark' ? '☀ 浅色' : '🌙 深色' }}
          </button>
          <span class="connection-dot" :class="{ offline: !env?.tdxRoot }"></span>
          <span class="connection-text">{{ env?.tdxRoot ? `本机 TDX 数据已连接 · 截止 ${env.dataCutoff ?? 'N/A'}` : '未发现 TDX 数据目录' }}</span>
        </div>
      </header>

      <div v-if="envError" class="env-error">{{ envError }}：请先运行 npm run dev 或 npm start 启动后端</div>

      <Launcher v-if="view === 'launcher'" @created="refresh" />
      <Training v-else-if="view === 'training' && snapshot" :snapshot="snapshot" @ended="refresh" />
      <div v-else class="boot-loading">正在连接本地服务…</div>
    </main>
  </div>
</template>
