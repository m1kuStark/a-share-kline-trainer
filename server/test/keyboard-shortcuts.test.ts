import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KEYBOARD_SHORTCUTS, SHORTCUT_ACTIONS, formatShortcut, loadKeyboardShortcuts,
  matchesActionShortcut, saveKeyboardShortcuts, shortcutConflict,
} from '../../web/src/keyboardShortcuts'

describe('keyboard shortcut preferences', () => {
  it('loads defaults, keeps at most two bindings, and round trips', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
    const defaults = loadKeyboardShortcuts(storage)
    expect(defaults.advance).toEqual([['Space']])
    const changed = { ...defaults, advance: [['KeyA'], ['KeyB'], ['KeyC']] }
    expect(saveKeyboardShortcuts(storage, changed)).toBe(false)
    expect(loadKeyboardShortcuts(storage).advance).toEqual([['Space']])
    const saved = { ...defaults, advance: [['KeyQ'], ['KeyR']] }
    expect(saveKeyboardShortcuts(storage, saved)).toBe(true)
    expect(loadKeyboardShortcuts(storage).advance).toEqual([['KeyQ'], ['KeyR']])
  })

  it('rejects duplicate bindings across actions and matches simultaneous keys', () => {
    const preferences = structuredClone(DEFAULT_KEYBOARD_SHORTCUTS)
    expect(shortcutConflict(preferences, 'sell', ['KeyB'])).toBe('buy')
    const pressed = new Set<string>(['Control'])
    expect(matchesActionShortcut('undo', { code: 'KeyZ', key: 'z', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false }, preferences, pressed)).toBe(true)
    expect(matchesActionShortcut('undo', { code: 'KeyZ', key: 'z', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false }, preferences, new Set())).toBe(false)
    const custom = { ...preferences, advance: [['KeyQ'], ['Shift', 'KeyR']] }
    expect(matchesActionShortcut('advance', { code: 'KeyQ', key: 'q', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false }, custom, new Set())).toBe(true)
    expect(matchesActionShortcut('advance', { code: 'KeyR', key: 'r', ctrlKey: false, shiftKey: true, altKey: false, metaKey: false, repeat: false, isComposing: false }, custom, new Set(['ShiftLeft']))).toBe(true)
    const duplicateStore = { getItem: () => JSON.stringify({ buy: [['KeyQ']], sell: [['KeyQ']] }) }
    const sanitized = loadKeyboardShortcuts(duplicateStore)
    expect(sanitized.buy).toEqual([['KeyQ']])
    expect(sanitized.sell).toEqual([])
    expect(saveKeyboardShortcuts({ setItem: () => { throw new Error('must not write') } }, sanitized)).toBe(false)
  })

  it('keeps the fixed arrow tools out of editable style scope', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(new URL('../../web/src/components/TrainingSettings.vue', import.meta.url), 'utf8')
    expect(source).toMatch(/固定样式|不可修改|bullArrow|bearArrow/)
    expect(SHORTCUT_ACTIONS).toContain('buy')
    expect(formatShortcut(['Control', 'KeyZ'])).toBe('Ctrl + Z')
  })

  it('CHART-ZOOM-01：默认 Shift+←/→ 平移且不与既有动作冲突', () => {
    expect(DEFAULT_KEYBOARD_SHORTCUTS.panLeft).toEqual([['Shift', 'ArrowLeft']])
    expect(DEFAULT_KEYBOARD_SHORTCUTS.panRight).toEqual([['Shift', 'ArrowRight']])
    expect(formatShortcut(['Shift', 'ArrowLeft'])).toBe('Shift + ←')
    expect(SHORTCUT_ACTIONS).toContain('panLeft')
    expect(SHORTCUT_ACTIONS).toContain('panRight')
    const event = { code: 'ArrowLeft', key: 'ArrowLeft', ctrlKey: false, shiftKey: true, altKey: false, metaKey: false, repeat: false, isComposing: false }
    expect(matchesActionShortcut('panLeft', event, DEFAULT_KEYBOARD_SHORTCUTS, new Set(['ShiftLeft']))).toBe(true)
    expect(matchesActionShortcut('crosshairLeft', event, DEFAULT_KEYBOARD_SHORTCUTS, new Set(['ShiftLeft']))).toBe(false)
    // 与交易/推进/缩放热键不冲突（重复默认组合只在自身出现）
    expect(shortcutConflict(DEFAULT_KEYBOARD_SHORTCUTS, 'panLeft', ['Shift', 'ArrowLeft'])).toBe('panLeft')
    for (const action of ['advance', 'buy', 'sell', 'zoomIn', 'zoomOut', 'crosshairLeft', 'crosshairRight'] as const) {
      const first = DEFAULT_KEYBOARD_SHORTCUTS[action][0]!
      expect(shortcutConflict(DEFAULT_KEYBOARD_SHORTCUTS, 'panLeft', first)).not.toBe('panLeft')
    }
  })
})
