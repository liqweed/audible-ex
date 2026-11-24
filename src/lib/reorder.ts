/**
 * Pointer and keyboard drag-and-drop reordering for a vertical list. Uses Pointer Events (like
 * `src/panel/drag.ts`) so it behaves identically inside Shadow DOM and regular pages without a
 * dependency, and captures item bounding boxes at drag start so rows of different heights never
 * jitter. ArrowUp / ArrowDown on a focused handle reorder without a pointer.
 */
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useRef,
  useState,
} from 'react'

const THRESHOLD = 4

export interface VerticalRect {
  readonly top: number
  readonly height: number
}

/** Moves the element at `from` to `to`, returning a new array (or a copy if unchanged). */
export function moveItem<T>(
  items: readonly T[],
  from: number,
  to: number
): T[] {
  const next = [...items]
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  )
    return next
  const [moved] = next.splice(from, 1)
  if (moved !== undefined) next.splice(to, 0, moved)
  return next
}

/**
 * The index an item dragged from `from` lands at when the pointer is at `pointerY`, given the
 * static bounding rects of every item captured when the drag began. Comparing against midpoints
 * works for rows of unequal heights without oscillation.
 */
export function dropIndex(
  from: number,
  pointerY: number,
  rects: readonly VerticalRect[]
): number {
  const origin = rects[from]
  if (!origin) return from
  const originMid = origin.top + origin.height / 2
  if (pointerY < originMid) {
    for (let i = 0; i <= from; i++) {
      const rect = rects[i]
      if (rect && pointerY < rect.top + rect.height / 2) return i
    }
    return from
  }
  let target = from
  for (let i = from + 1; i < rects.length; i++) {
    const rect = rects[i]
    if (rect && pointerY > rect.top + rect.height / 2) target = i
  }
  return target
}

export interface ReorderState {
  /** Index of the item currently being dragged, or undefined when idle. */
  readonly dragging: number | undefined
  /** Index the dragged item would drop onto if released now, or undefined when idle. */
  readonly over: number | undefined
  /** Screen-reader status text for the most recent keyboard or pointer reorder. */
  readonly announcement: string
  /** Ref callback to attach to each list item element (`<li>`). */
  itemRef(index: number): (el: HTMLElement | null) => void
  /** Props for the drag handle button inside item `index`. */
  handleProps(
    index: number,
    label: string
  ): {
    onPointerDown(e: PointerEvent<HTMLButtonElement>): void
    onPointerMove(e: PointerEvent<HTMLButtonElement>): void
    onPointerUp(e: PointerEvent<HTMLButtonElement>): void
    onPointerCancel(): void
    onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void
  }
}

export function useReorder(
  count: number,
  onMove: (from: number, to: number) => void
): ReorderState {
  const nodes = useRef<Array<HTMLElement | null>>([])
  const drag = useRef<{
    from: number
    startY: number
    moved: boolean
    rects: VerticalRect[]
    over: number
    label: string
  }>(undefined)
  const [state, setState] = useState<{
    dragging: number | undefined
    over: number | undefined
  }>({ dragging: undefined, over: undefined })
  const [announcement, setAnnouncement] = useState('')

  const itemRef = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      nodes.current[index] = el
    },
    []
  )

  const commit = useCallback(
    (from: number, to: number, label: string) => {
      if (from === to || to < 0 || to >= count) return
      onMove(from, to)
      setAnnouncement(`${label} moved to position ${to + 1} of ${count}.`)
    },
    [count, onMove]
  )

  const handleProps = useCallback(
    (index: number, label: string) => ({
      onPointerDown(e: PointerEvent<HTMLButtonElement>) {
        if (e.button !== 0) return
        const rects = Array.from({ length: count }, (_, i) => {
          const r = nodes.current[i]?.getBoundingClientRect()
          return r ? { top: r.top, height: r.height } : { top: 0, height: 0 }
        })
        drag.current = {
          from: index,
          startY: e.clientY,
          moved: false,
          rects,
          over: index,
          label,
        }
        e.currentTarget.setPointerCapture?.(e.pointerId)
      },
      onPointerMove(e: PointerEvent<HTMLButtonElement>) {
        const current = drag.current
        if (!current) return
        if (!current.moved && Math.abs(e.clientY - current.startY) < THRESHOLD)
          return
        current.moved = true
        const over = dropIndex(current.from, e.clientY, current.rects)
        current.over = over
        setState(prev =>
          prev.dragging === current.from && prev.over === over
            ? prev
            : { dragging: current.from, over }
        )
      },
      onPointerUp(e: PointerEvent<HTMLButtonElement>) {
        const current = drag.current
        drag.current = undefined
        if (e.currentTarget.hasPointerCapture?.(e.pointerId))
          e.currentTarget.releasePointerCapture?.(e.pointerId)
        setState({ dragging: undefined, over: undefined })
        if (!current?.moved) return
        commit(current.from, current.over, current.label)
      },
      onPointerCancel() {
        drag.current = undefined
        setState({ dragging: undefined, over: undefined })
      },
      onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
        if (e.key === 'ArrowUp' && index > 0) {
          e.preventDefault()
          commit(index, index - 1, label)
        } else if (e.key === 'ArrowDown' && index < count - 1) {
          e.preventDefault()
          commit(index, index + 1, label)
        }
      },
    }),
    [count, commit]
  )

  return {
    dragging: state.dragging,
    over: state.over,
    announcement,
    itemRef,
    handleProps,
  }
}
