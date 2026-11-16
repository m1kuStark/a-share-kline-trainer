<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import {
  ApiError, createFormula, deleteFormula, evaluateFormula, fetchActiveTraining, fetchFormulas,
  updateFormula, validateFormula,
  type FormulaEvaluationResult, type FormulaValidationResult, type FormulaView,
} from '../api'

// M9-04B 公式指标：设置面板分栏（用户 2026-11-16 拍板默认方案）。
// 管理本机 SQLite 公式库（M9-04A 契约）：列表/新建/编辑/校验/粘贴导入/预览/删除。
// 仅图表显示用途；不写训练、不下单；跨公式引用要求被引用公式名为纯英文。

type OkEvaluation = Extract<FormulaEvaluationResult, { ok: true }>
type Placement = 'main' | 'sub'

const LINE_COLORS = ['#d9534f', '#3b82f6', '#16a34a', '#a855f7']

const sectionRef = ref<HTMLElement | null>(null)
const items = ref<FormulaView[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const selectedId = ref<number | null>(null)
const confirmDelete = ref(false)
const saveMessage = ref('')
const validation = ref<FormulaValidationResult | null>(null)
const warnings = ref<string[]>([])
const preview = ref<OkEvaluation | null>(null)
const previewError = ref('')
const previewCode = ref('600519')
const form = ref<{ name: string; description: string; placement: Placement; source: string }>({
  name: '', description: '', placement: 'sub', source: '',
})

const isBuiltin = computed(() => items.value.find(item => item.id === selectedId.value)?.builtin ?? false)
const canEditSource = computed(() => !busy.value && !isBuiltin.value)

const previewPaths = computed(() => {
  const current = preview.value
  if (!current || current.outputs.length === 0) return [] as Array<{ name: string; points: string; color: string; lastText: string }>
  const lines = current.outputs.slice(0, 4)
  const values = lines.flatMap(line => line.data.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)))
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return lines.map((line, index) => {
    const points: string[] = []
    const data = line.data.slice(-120)
    data.forEach((value, position) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return
      const x = data.length <= 1 ? 0 : (position / (data.length - 1)) * 600
      const y = 110 - ((value - min) / span) * 100
      points.push(x.toFixed(1) + ',' + y.toFixed(1))
    })
    const finite = data.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    const lastText = finite.length > 0 ? finite[finite.length - 1].toFixed(3) : '—'
    return { name: line.name, points: points.join(' '), color: LINE_COLORS[index % LINE_COLORS.length], lastText }
  })
})

const previewPathNames = computed(() => previewPaths.value.map(line => line.name).join('、'))

function messageOf(failure: unknown): string {
  if (failure instanceof ApiError) return failure.message
  return failure instanceof Error ? failure.message : '请求失败'
}

function resetTransientState(): void {
  validation.value = null
  warnings.value = []
  preview.value = null
  previewError.value = ''
  saveMessage.value = ''
  confirmDelete.value = false
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const payload = await fetchFormulas()
    items.value = payload.formulas
    if (selectedId.value !== null && !items.value.some(item => item.id === selectedId.value)) startNew()
  } catch (failure) {
    error.value = messageOf(failure)
  } finally {
    loading.value = false
  }
}

function select(item: FormulaView): void {
  selectedId.value = item.id
  form.value = {
    name: item.name, description: item.description, placement: item.placement, source: item.source,
  }
  resetTransientState()
}

function startNew(): void {
  selectedId.value = null
  form.value = { name: '', description: '', placement: 'sub', source: '' }
  resetTransientState()
}

async function runValidate(): Promise<void> {
  if (form.value.source.trim() === '') {
    validation.value = { ok: false, error: { kind: 'parser', message: '公式源码不能为空' }, warnings: [] }
    return
  }
  busy.value = true
  error.value = ''
  try {
    const result = await validateFormula(form.value.source)
    validation.value = result
    warnings.value = result.warnings
    saveMessage.value = ''
  } catch (failure) {
    error.value = messageOf(failure)
  } finally {
    busy.value = false
  }
}

async function save(): Promise<void> {
  if (form.value.source.trim() === '') return
  busy.value = true
  error.value = ''
  try {
    const payload = {
      name: form.value.name.trim(),
      description: form.value.description.trim(),
      placement: form.value.placement,
      source: form.value.source,
    }
    const currentId = selectedId.value
    const creating = currentId === null
    const saved = currentId === null
      ? await createFormula(payload)
      : await updateFormula(currentId, payload)
    selectedId.value = saved.id
    warnings.value = saved.warnings ?? []
    validation.value = { ok: true, futureFunctions: saved.futureFunctions, warnings: warnings.value }
    saveMessage.value = creating ? '已保存新公式' : '已保存修改'
    await load()
  } catch (failure) {
    error.value = messageOf(failure)
  } finally {
    busy.value = false
  }
}

async function remove(): Promise<void> {
  const currentId = selectedId.value
  if (currentId === null) return
  if (!confirmDelete.value) {
    confirmDelete.value = true
    saveMessage.value = '再次点击「删除」确认删除该公式（不影响训练数据）'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await deleteFormula(currentId)
    startNew()
    saveMessage.value = '已删除公式'
    await load()
  } catch (failure) {
    error.value = messageOf(failure)
  } finally {
    busy.value = false
  }
}

async function runPreview(): Promise<void> {
  if (form.value.source.trim() === '') {
    previewError.value = '公式源码不能为空'
    return
  }
  busy.value = true
  previewError.value = ''
  try {
    let trainingId: number | undefined
    try {
      const active = await fetchActiveTraining()
      if ('training' in active && active.training) trainingId = active.training.id
    } catch {
      trainingId = undefined
    }
    const result = trainingId === undefined
      ? await evaluateFormula({ source: form.value.source, code: previewCode.value.trim() || '600519', limit: 120 })
      : await evaluateFormula({ source: form.value.source, trainingId, limit: 120 })
    if (result.ok) {
      preview.value = result
      warnings.value = mergedWarnings(warnings.value, result.warnings)
    } else {
      preview.value = null
      previewError.value = result.error.message
      warnings.value = mergedWarnings(warnings.value, result.warnings)
    }
  } catch (failure) {
    previewError.value = messageOf(failure)
  } finally {
    busy.value = false
  }
}

function mergedWarnings(left: string[], right: string[]): string[] {
  const merged = [...left]
  for (const warning of right) if (!merged.includes(warning)) merged.push(warning)
  return merged
}

onMounted(async () => {
  await load()
  await nextTick()
  const content = sectionRef.value?.closest('.settings-content') as HTMLElement | null
  content?.scrollTo({ top: 0 })
})
</script>

<template>
  <section ref="sectionRef" class="settings-section formula-settings" aria-label="公式指标">
    <h3>公式指标</h3>
    <p class="settings-section-note">
      管理本机保存的公式（SQLite，随训练数据目录备份与迁移），支持直接粘贴通达信多行或单行公式文本。
      公式只用于图表显示与预览，不写训练、不下单；跨公式引用要求被引用公式名为纯英文，中文名仅作显示。
    </p>
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <div class="formula-layout">
      <div class="formula-list-pane">
        <div class="formula-list-head">
          <strong>公式列表（{{ items.length }}）</strong>
          <button class="ghost-button" type="button" :disabled="busy" @click="startNew">新建</button>
        </div>
        <p v-if="loading" class="settings-section-note" role="status">读取中…</p>
        <ul class="formula-list" aria-label="公式列表">
          <li v-for="item in items" :key="item.id">
            <button
              type="button" class="formula-item" :class="{ selected: selectedId === item.id }"
              :aria-pressed="selectedId === item.id" :data-formula-id="item.id" @click="select(item)"
            >
              <span class="formula-item-name">
                {{ item.name }}
                <span v-if="item.builtin" class="formula-badge">内置</span>
                <span v-if="!item.enabled" class="formula-badge muted">已停用</span>
              </span>
              <span class="formula-item-meta">{{ item.placement === 'main' ? '主图叠加' : '副图指标' }}<template v-if="item.futureFunctions.length"> · 未来函数：{{ item.futureFunctions.join('、') }}</template></span>
            </button>
          </li>
          <li v-if="!loading && items.length === 0" class="formula-empty">还没有公式；点击「新建」后粘贴通达信公式源码。</li>
        </ul>
      </div>

      <div class="formula-editor">
        <div class="formula-grid">
          <label class="formula-field">
            <span>公式名（跨公式引用需纯英文）</span>
            <input v-model="form.name" aria-label="公式名称" maxlength="64" :disabled="busy || isBuiltin" placeholder="如 MY_MA5 或 周线MACD" />
          </label>
          <label class="formula-field">
            <span>显示位置</span>
            <select v-model="form.placement" aria-label="显示位置" :disabled="busy || isBuiltin">
              <option value="main">主图叠加</option>
              <option value="sub">副图指标</option>
            </select>
          </label>
        </div>
        <label class="formula-field">
          <span>说明（可选）</span>
          <input v-model="form.description" aria-label="公式说明" maxlength="500" :disabled="busy" />
        </label>
        <label class="formula-field">
          <span>公式源码（支持粘贴通达信多行/单行文本；// 与块注释均可）</span>
          <textarea v-model="form.source" aria-label="公式源码" rows="8" spellcheck="false" :disabled="!canEditSource" placeholder="MA5:MA(CLOSE,5);&#10;MA10:MA(CLOSE,10);"></textarea>
        </label>
        <div class="formula-actions">
          <button class="ghost-button" type="button" :disabled="busy" @click="runValidate">校验</button>
          <button class="ghost-button" type="button" :disabled="busy || form.source.trim() === ''" @click="runPreview">预览</button>
          <button class="trade-action buy" type="button" :disabled="busy || form.source.trim() === '' || form.name.trim() === ''" @click="save">
            {{ busy ? '处理中…' : selectedId === null ? '保存新公式' : '保存修改' }}
          </button>
          <button v-if="selectedId !== null && !isBuiltin" class="ghost-button formula-danger" type="button" :disabled="busy" @click="remove">
            {{ confirmDelete ? '再次点击确认删除' : '删除' }}
          </button>
        </div>
        <label v-if="preview === null" class="formula-field formula-preview-code">
          <span>预览证券代码（无进行中训练时使用，需已连接通达信日线）</span>
          <input v-model="previewCode" aria-label="预览证券代码" spellcheck="false" />
        </label>
        <p v-if="validation" class="formula-status" :class="validation.ok ? 'ok' : 'fail'" role="status">
          <template v-if="validation.ok">✓ 校验通过<template v-if="validation.futureFunctions.length">；未来函数：{{ validation.futureFunctions.join('、') }}（允许使用，图表会标记）</template></template>
          <template v-else>✕ {{ validation.error.message }}</template>
        </p>
        <ul v-if="warnings.length > 0" class="formula-warnings" aria-label="公式告警">
          <li v-for="(warning, index) in warnings" :key="index">{{ warning }}</li>
        </ul>
        <p v-if="saveMessage" class="settings-saved" role="status">{{ saveMessage }}</p>
        <p v-if="previewError" class="error-text" role="alert">{{ previewError }}</p>
        <div v-if="preview" class="formula-preview" aria-label="公式预览">
          <div class="formula-preview-head">
            <strong>预览</strong>
            <span class="settings-section-note">{{ preview.dataSource.note }}；{{ preview.bars.length }} 根 · {{ preview.bars[0]?.date }} → {{ preview.bars[preview.bars.length - 1]?.date }}</span>
          </div>
          <svg class="formula-preview-svg" role="img" :aria-label="'公式预览曲线：' + previewPathNames" viewBox="0 0 600 120" preserveAspectRatio="none">
            <line v-for="grid in 4" :key="grid" x1="0" :y1="grid * 24" x2="600" :y2="grid * 24" class="formula-preview-grid" />
            <polyline v-for="line in previewPaths" :key="line.name" :points="line.points" :stroke="line.color" fill="none" stroke-width="1.5" />
          </svg>
          <div class="formula-preview-legend">
            <span v-for="line in previewPaths" :key="line.name"><i :style="{ background: line.color }"></i>{{ line.name }}（{{ line.lastText }}）</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.formula-settings { display: flex; flex-direction: column; gap: 10px; }
.formula-layout { display: flex; flex-direction: column; gap: 12px; align-items: stretch; }
.formula-list-pane { border: 1px solid var(--surface-border); border-radius: 10px; padding: 10px; background: var(--surface-background); }
.formula-list-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.formula-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; max-height: 190px; overflow-y: auto; }
.formula-item { display: flex; flex-direction: column; gap: 2px; min-width: 150px; max-width: 260px; text-align: left; padding: 8px 10px; border: 1px solid var(--surface-border); border-radius: 8px; background: var(--surface-card); color: var(--text-primary); cursor: pointer; }
.formula-item:hover { background: var(--surface-hover); }
.formula-item.selected { background: var(--surface-selected); border-color: var(--text-secondary); }
.formula-item-name { display: flex; align-items: center; gap: 6px; font-weight: 600; overflow-wrap: anywhere; }
.formula-item-meta { font-size: var(--font-size-xs); color: var(--text-secondary, #51637a); }
.formula-badge { font-size: 11px; font-weight: 500; padding: 0 5px; border-radius: 999px; background: var(--surface-selected); color: var(--text-primary); }
.formula-badge.muted { background: transparent; border: 1px solid var(--surface-border); color: var(--text-muted); }
.formula-empty { font-size: var(--font-size-xs); color: var(--text-secondary, #51637a); padding: 10px 4px; }
.formula-editor { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.formula-grid { display: grid; grid-template-columns: minmax(0, 1fr) 150px; gap: 10px; }
.formula-field { display: flex; flex-direction: column; gap: 4px; font-size: var(--font-size-sm, 13px); min-width: 0; }
.formula-field > span { color: var(--text-secondary, #51637a); }
.formula-field input, .formula-field select, .formula-field textarea { width: 100%; box-sizing: border-box; }
.formula-field textarea { font-family: 'Cascadia Mono', 'Consolas', monospace; font-size: 12px; line-height: 1.5; resize: vertical; }
.formula-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.formula-actions .trade-action { flex: 0 0 auto; width: auto; min-width: 130px; }
.formula-danger { color: var(--error, #c0392b); }
.formula-status { margin: 0; font-size: var(--font-size-sm, 13px); }
.formula-status.ok { color: #2f9e69; }
.formula-status.fail { color: var(--error, #c0392b); }
.formula-warnings { margin: 0; padding-left: 18px; font-size: var(--font-size-xs); color: #c08b1f; }
.formula-preview { border: 1px solid var(--surface-border); border-radius: 10px; padding: 10px; background: var(--surface-card); }
.formula-preview-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.formula-preview-svg { width: 100%; height: 120px; display: block; background: var(--surface-background); border-radius: 6px; }
.formula-preview-grid { stroke: var(--surface-border); stroke-width: 1; }
.formula-preview-legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; font-size: var(--font-size-xs); color: var(--text-secondary, #51637a); }
.formula-preview-legend i { display: inline-block; width: 10px; height: 3px; margin-right: 4px; vertical-align: middle; }
.formula-preview-code { max-width: 260px; }
@media (max-width: 900px) {
  .formula-layout { grid-template-columns: 1fr; }
}
</style>
