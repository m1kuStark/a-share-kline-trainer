export type PaneHeightRequest = { id: string; height: number; minHeight: number }
/** Normal panes only. Preserve all panes; scale effective minima only when they cannot fit. */
export function allocateSubPaneHeights(availableHeight: number, mainReserve: number, panes: readonly PaneHeightRequest[]): PaneHeightRequest[] {
  const available = Math.max(0, availableHeight)
  const minimum = panes.reduce((sum, pane) => sum + pane.minHeight, 0)
  const minimumScale = Math.min(1, available / Math.max(1, mainReserve + minimum))
  const budget = Math.max(0, available - mainReserve * minimumScale)
  const requested = panes.map(pane => Math.max(pane.minHeight, pane.height))
  const total = requested.reduce((sum, height) => sum + height, 0)
  if (total <= budget) return panes.map((pane, index) => ({ ...pane, height: requested[index]! }))
  if (minimumScale < 1) return panes.map(pane => ({ id: pane.id, height: pane.minHeight * minimumScale, minHeight: pane.minHeight * minimumScale }))
  const fraction = (budget - minimum) / (total - minimum)
  return panes.map((pane, index) => ({ ...pane, height: pane.minHeight + (requested[index]! - pane.minHeight) * fraction }))
}

export type PaneResizeGeometry = { width: number; height: number; paneIds: readonly string[] }
/** A drag may update preferences only in the same host geometry and ordered pane topology. */
export function paneResizeGeometryMatches(start: PaneResizeGeometry, current: PaneResizeGeometry | null): boolean {
  return current !== null && start.width === current.width && start.height === current.height
    && start.paneIds.length === current.paneIds.length
    && start.paneIds.every((id, index) => id === current.paneIds[index])
}
