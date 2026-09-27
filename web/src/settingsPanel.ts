import { ref } from 'vue'

// TRAIN-01 训练默认设置弹层的全局开关。
// App.vue 据此挂载局部弹层（不卸载正在录制的 Training）；Training.vue 据此在弹层
// 打开期间隔离全局热键（空格推进 / B/S 买卖 / 画线等不得从设置触发）。

export const trainingSettingsOpen = ref(false)

export function openTrainingSettings(): void {
  trainingSettingsOpen.value = true
}

export function closeTrainingSettings(): void {
  trainingSettingsOpen.value = false
}
