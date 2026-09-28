import { ref, shallowRef } from 'vue'
import type { TrainingSettingsView } from './api'

// TRAIN-01 训练默认设置弹层的全局开关。
// App.vue 据此挂载局部弹层（不卸载正在录制的 Training）；Training.vue 据此在弹层
// 打开期间隔离全局热键（空格推进 / B/S 买卖 / 画线等不得从设置触发）。
// M5-DEFAULTS：保存成功后广播最新默认视图，Launcher 据此更新未被用户编辑的创建字段。

export const trainingSettingsOpen = ref(false)

/** 最近一次保存成功的默认设置视图与递增版本（Launcher 监听版本号消费）。 */
export const lastSavedSettings = shallowRef<TrainingSettingsView | null>(null)
export const settingsSavedVersion = ref(0)

export function notifySettingsSaved(view: TrainingSettingsView): void {
  lastSavedSettings.value = view
  settingsSavedVersion.value += 1
}

export function openTrainingSettings(): void {
  trainingSettingsOpen.value = true
}

export function closeTrainingSettings(): void {
  trainingSettingsOpen.value = false
}
