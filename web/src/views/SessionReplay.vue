<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import KlineChart from '../components/KlineChart.vue'
import type { RecordingFile } from '../recording/types'
import { checkpointForSeq, describeEvent, describeGap, gapCoveringSeq, stepWaitMs, summarizeGaps } from '../recording/replay'

// REC-PLAYER：只读录制回放。完全离线：只消费传入的 RecordingFile 检查点数据，
// 不引存储/录制器/训练与交易 API，不注册任何快捷键，不写任何训练状态。
const props = defineProps<{ recording: RecordingFile }>()
const emit = defineEmits<{ close: [] }>()

const SPEEDS = [0.5, 1, 2, 4, 8] as const

// 步语义：0＝初始状态（首个 afterSeq=0 检查点），n＝第 n 个事件已发生
const seq = ref(0)
const playing = ref(false)
const speed = ref<number>(1)
let timer: ReturnType<typeof setTimeout> | undefined

const total = computed(() => props.recording.events.length)
const activeCheckpoint = computed(() => checkpointForSeq(props.recording.checkpoints, seq.value))
const activeChart = computed(() => activeCheckpoint.value?.chart ?? null)
const activeTraining = computed(() => activeCheckpoint.value?.training ?? null)
const currentEvent = computed(() => (seq.value > 0 ? props.recording.events[seq.value - 1] ?? null : null))
const gapHint = computed(() => gapCoveringSeq(props.recording.gaps, seq.value))
// 常驻摘要：不受当前步影响，恢复之后同样保留全部历史缺口提示
const gapSummary = computed(() => summarizeGaps(props.recording.gaps))
const atStart = computed(() => seq.value <= 0)
const atEnd = computed(() => seq.value >= total.value)

const metaText = computed(() => {
  const app = props.recording.app
  const parts = [
    `会话 ${props.recording.sessionId}`,
    `版本 ${app.version}`,
    `提交 ${app.gitCommit}`,
    // complete 只表示尾段无悬空 started/未闭合缺口，不代表没有未记录区间
    props.recording.complete ? '尾段已闭合' : '尾段未闭合',
    `${total.value} 个事件 · ${props.recording.checkpoints.length} 个检查点`,
  ]
  if (props.recording.trainingKey) parts.unshift(`训练 ${props.recording.trainingKey}`)
  return parts.join(' · ')
})

const stepLabel = computed(() => `第 ${seq.value} / ${total.value} 步`)
const eventText = computed(() => (currentEvent.value ? describeEvent(currentEvent.value) : '初始状态（尚未执行任何操作）'))

function money(value: number): string {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function clearTimer(): void {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
}

function stopPlayback(): void {
  playing.value = false
  clearTimer()
}

function stepTo(target: number): void {
  stopPlayback()
  seq.value = Math.min(Math.max(target, 0), total.value)
}

function onRangeInput(event: Event): void {
  stepTo(Number((event.target as HTMLInputElement).value))
}

// 播放调度：等待时长按当前倍速实时计算；等待期间不可打断（组件卸载/手动操作统一清计时器）
function scheduleNext(): void {
  const wait = stepWaitMs(props.recording.events, seq.value, speed.value)
  timer = setTimeout(() => {
    timer = undefined
    if (!playing.value || seq.value >= total.value) {
      playing.value = false
      return
    }
    seq.value += 1
    if (seq.value < total.value) scheduleNext()
    else playing.value = false
  }, wait)
}

function togglePlay(): void {
  if (playing.value) {
    stopPlayback()
    return
  }
  if (total.value === 0) return
  if (atEnd.value) seq.value = 0
  playing.value = true
  scheduleNext()
}

// 倍速调整即时生效：丢弃剩余等待，按新倍速重排下一步
watch(speed, () => {
  if (playing.value) {
    clearTimer()
    scheduleNext()
  }
})

onBeforeUnmount(stopPlayback)
</script>

<template>
  <section class="replay-shell">
    <header class="replay-head">
      <div class="replay-title">
        <h2>录制回放</h2>
        <p class="replay-meta" :title="metaText">{{ metaText }}</p>
      </div>
      <button class="replay-close" type="button" aria-label="关闭回放" @click="emit('close')">关闭回放</button>
    </header>

    <p v-if="props.recording.checkpoints.length === 0" class="replay-empty">
      <strong>暂无可展示状态</strong>
      <span>录制文件中没有检查点，无法回放图表与账户。</span>
    </p>

    <div v-else class="replay-body">
      <div class="replay-main">
        <div class="replay-status">
          <strong class="replay-step">{{ stepLabel }}</strong>
          <span class="replay-event-text" :title="eventText">{{ eventText }}</span>
          <span v-if="gapHint" class="replay-gap" role="alert">录制缺口：{{ describeGap(gapHint) }}</span>
          <span v-if="gapSummary" class="replay-gap-summary">{{ gapSummary }}</span>
        </div>

        <div class="replay-chart">
          <KlineChart
            v-if="activeChart && activeCheckpoint"
            :key="activeCheckpoint.id"
            :read-only="true"
            :bars="activeChart.bars"
            :trades="activeTraining?.trades ?? []"
            :cost-price="activeTraining?.account.costPrice ?? null"
            :chart-cost-price="activeChart.costPrice"
            :timeframe="activeChart.timeframe"
            :saved-drawings="activeChart.drawings"
            :replay-view="activeChart.view"
          />
          <div v-else class="replay-chart-empty">
            <strong>该步骤没有图表快照</strong>
            <span>此检查点未捕获图表数据。</span>
          </div>
        </div>

        <div class="replay-controls">
          <button type="button" :disabled="atStart" aria-label="回到开始" @click="stepTo(0)">开始</button>
          <button type="button" :disabled="atStart" aria-label="上一步" @click="stepTo(seq - 1)">上一步</button>
          <button
            v-if="!playing"
            type="button"
            class="replay-play"
            :disabled="total === 0"
            aria-label="播放录制"
            @click="togglePlay"
          >播放</button>
          <button v-else type="button" class="replay-play" aria-label="暂停回放" @click="togglePlay">暂停</button>
          <button type="button" :disabled="atEnd" aria-label="下一步" @click="stepTo(seq + 1)">下一步</button>
          <button type="button" :disabled="atEnd" aria-label="最后一步" @click="stepTo(total)">最后</button>
          <label class="replay-speed">
            倍速
            <select v-model.number="speed" aria-label="播放速度">
              <option v-for="value in SPEEDS" :key="value" :value="value">{{ value }}x</option>
            </select>
          </label>
          <input
            class="replay-range"
            type="range"
            min="0"
            :max="total"
            step="1"
            :value="seq"
            aria-label="回放步骤"
            @input="onRangeInput"
          >
        </div>
      </div>

      <aside class="replay-side">
        <section class="replay-panel">
          <h3>账户摘要</h3>
          <template v-if="activeTraining">
            <p class="replay-account-title">
              {{ activeTraining.training.code ?? '未知代码' }} {{ activeTraining.training.name ?? '' }}
              · {{ activeTraining.training.currentDate ?? '今日（双盲）' }}
            </p>
            <dl class="replay-account">
              <div><dt>总权益</dt><dd>{{ money(activeTraining.account.equity) }}</dd></div>
              <div><dt>现金</dt><dd>{{ money(activeTraining.account.cash) }}</dd></div>
              <div><dt>市值</dt><dd>{{ money(activeTraining.account.marketValue) }}</dd></div>
              <div><dt>持仓</dt><dd>{{ activeTraining.account.shares }} 股</dd></div>
              <div><dt>可用</dt><dd>{{ activeTraining.account.availableShares }} 股</dd></div>
              <div>
                <dt>成本价</dt>
                <dd>{{ activeTraining.account.costPrice === null ? '—' : money(activeTraining.account.costPrice) }}</dd>
              </div>
            </dl>
          </template>
          <p v-else class="replay-panel-empty">该步骤没有账户快照。</p>
        </section>

        <section class="replay-panel replay-events">
          <h3>操作列表</h3>
          <p v-if="total === 0" class="replay-panel-empty">录制中没有任何事件。</p>
          <ol v-else class="replay-event-list">
            <li v-for="event in props.recording.events" :key="event.seq">
              <button
                type="button"
                :class="{ active: event.seq === seq }"
                :aria-current="event.seq === seq ? 'true' : undefined"
                @click="stepTo(event.seq)"
              >
                <span class="event-seq">{{ event.seq }}</span>
                <span class="event-text">{{ describeEvent(event) }}</span>
              </button>
            </li>
          </ol>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
/* 主题色变量仅在 body.dark 下定义，浅色按全局浅色底给同源回退值 */
.replay-shell {
  display: flex;
  flex-direction: column;
  height: calc(100dvh - var(--topbar-h, 28px));
  min-width: 0;
  min-height: 0;
  color: var(--text-primary, #172033);
  background: var(--surface-background, #f4f6f9);
}
.replay-head {
  flex: 0 0 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px;
  background: var(--surface-background, #ffffff);
  border-bottom: 1px solid var(--surface-border, #e1e6ec);
  min-width: 0;
}
.replay-title { min-width: 0; display: flex; align-items: baseline; gap: 10px; }
.replay-title h2 { margin: 0; font-size: 14px; white-space: nowrap; }
.replay-meta {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted, #5d7087);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.replay-close {
  flex: 0 0 auto;
  height: 28px;
  padding: 0 12px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid var(--surface-border, #d8e0e8);
  background: var(--control-background, #ffffff);
  color: var(--text-secondary, #617286);
}
.replay-close:hover { border-color: #94bec5; color: var(--text-primary, #1c6076); }
.replay-empty {
  margin: 24px auto;
  padding: 18px 26px;
  display: grid;
  gap: 6px;
  justify-items: center;
  border: 1px solid var(--surface-border, #dfe5eb);
  border-radius: 6px;
  background: var(--surface-background, #ffffff);
  color: var(--text-secondary, #64748a);
  font-size: 12px;
}
.replay-empty strong { font-size: 14px; color: var(--text-primary, #3c4d62); }
.replay-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 264px;
  gap: 10px;
  padding: 10px 12px 12px;
}
.replay-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.replay-status {
  flex: 0 0 26px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  min-width: 0;
  overflow: hidden;
}
.replay-step { white-space: nowrap; font-variant-numeric: tabular-nums; }
.replay-event-text {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-secondary, #33455c);
}
.replay-gap {
  flex: 0 0 auto;
  max-width: 60%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 1px 8px;
  border-radius: 3px;
  color: #b45309;
  background: rgba(180, 83, 9, 0.12);
}
body.dark .replay-gap { color: #e0a35a; background: rgba(224, 163, 90, 0.16); }
/* 常驻摘要：任何步骤都保留未记录区间总数，仅提示存在、不随步消失 */
.replay-gap-summary {
  flex: 0 0 auto;
  white-space: nowrap;
  padding: 1px 8px;
  border-radius: 3px;
  color: var(--text-muted, #5d7087);
  background: var(--surface-hover, #eef3f7);
}
body.dark .replay-gap-summary { color: var(--text-muted, #8a98a9); background: rgba(138, 152, 169, 0.18); }
.replay-chart { position: relative; flex: 1; min-height: 0; border: 1px solid var(--surface-border, #dfe5eb); background: var(--chart-background, #ffffff); }
.replay-chart-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 6px;
  color: var(--text-muted, #98a5b4);
  font-size: 12px;
}
.replay-chart-empty strong { font-size: 14px; color: var(--text-secondary, #3c4d62); }
.replay-controls {
  flex: 0 0 40px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0 0;
  min-width: 0;
}
.replay-controls > button {
  height: 30px;
  padding: 0 10px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid var(--surface-border, #d8e0e8);
  background: var(--control-background, #ffffff);
  color: var(--text-secondary, #38596d);
  white-space: nowrap;
}
.replay-controls > button:hover:not(:disabled) { border-color: #94bec5; color: var(--text-primary, #1c6076); }
.replay-controls > button:disabled { opacity: 0.45; cursor: not-allowed; }
.replay-play { font-weight: 650; min-width: 64px; }
.replay-speed {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted, #5d7087);
  white-space: nowrap;
}
.replay-speed select {
  height: 30px;
  border: 1px solid var(--surface-border, #d5dde7);
  border-radius: 4px;
  background: var(--control-background, #ffffff);
  color: var(--text-primary, #233044);
  font-size: 12px;
  padding: 0 4px;
}
.replay-range { flex: 1; min-width: 60px; accent-color: #2e8191; }
.replay-side { display: flex; flex-direction: column; gap: 10px; min-width: 0; min-height: 0; }
.replay-panel {
  border: 1px solid var(--surface-border, #dfe5eb);
  background: var(--surface-background, #ffffff);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.replay-panel h3 { margin: 0 0 8px; font-size: 13px; }
.replay-panel-empty { margin: 0; font-size: 12px; color: var(--text-muted, #94a2b2); }
.replay-account-title {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-secondary, #62748a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.replay-account {
  margin: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 10px;
}
.replay-account dt { font-size: 11px; color: var(--text-muted, #8a98a9); }
.replay-account dd {
  margin: 2px 0 0;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.replay-events { flex: 1; min-height: 0; }
.replay-event-list {
  margin: 0;
  padding: 0;
  list-style: none;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.replay-event-list button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 4px 6px;
  font-size: 12px;
  border-radius: 3px;
  color: var(--text-secondary, #33455c);
  min-width: 0;
}
.replay-event-list button:hover { background: var(--surface-hover, #eef3f7); }
.replay-event-list button.active { background: var(--surface-selected, #e3eef3); color: var(--text-primary, #1c3a4a); font-weight: 600; }
.event-seq { flex: 0 0 30px; text-align: right; font-variant-numeric: tabular-nums; color: var(--text-muted, #94a2b2); }
.replay-event-list button.active .event-seq { color: inherit; }
.event-text { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
