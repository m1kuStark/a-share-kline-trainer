import type { RecordingSummary } from './types'

export type RecordingSource = 'local' | 'imported'
export interface RecordingLibraryItem extends RecordingSummary {
  source: RecordingSource
  originalSessionId?: string
  importedAt?: string
  fileName?: string
}
export interface RecordingRemovalResult {
  deleted: RecordingLibraryItem[]
  failed: Array<{ item: RecordingLibraryItem; reason: string }>
}
