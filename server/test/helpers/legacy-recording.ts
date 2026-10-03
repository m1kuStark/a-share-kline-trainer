import type { RecordingCheckpoint } from '../../../web/src/recording/types'

/** Legacy recordings have no orders field; decoded snapshots expose an empty list. */
export function decodedLegacyCheckpoint(checkpoint: RecordingCheckpoint): RecordingCheckpoint {
  return {
    ...checkpoint,
    training: checkpoint.training === null
      ? null
      : { ...checkpoint.training, orders: checkpoint.training.orders ?? [] },
  }
}
