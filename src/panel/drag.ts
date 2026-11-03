/**
 * Dragging the panel to a corner. The panel follows the pointer while it is held; on release it
 * docks to the viewport corner nearest to where its centre ended up (`nearestCorner`). A press that
 * moves less than `THRESHOLD` pixels is a click, not a drag.
 */
import {
  type PointerEvent,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from 'react'
import type { Corner } from '@/storage/panel'

const THRESHOLD = 4

export interface Point {
  readonly x: number
  readonly y: number
}

/** The corner of a `width` × `height` viewport that `centre` is nearest to. */
export function nearestCorner(
  centre: Point,
  viewport: { readonly width: number; readonly height: number }
): Corner {
  const vertical = centre.y < viewport.height / 2 ? 'top' : 'bottom'
  const horizontal = centre.x < viewport.width / 2 ? 'Left' : 'Right'
  return `${vertical}${horizontal}`
}

export interface Drag {
  /** Where the panel is while it is being dragged (its top-left corner); undefined when docked. */
  readonly at: { left: number; top: number } | undefined
  /** True when the press that just ended was a drag; a click handler ignores that click. */
  wasDrag(): boolean
  readonly handlers: {
    onPointerDown(e: PointerEvent): void
    onPointerMove(e: PointerEvent): void
    onPointerUp(e: PointerEvent): void
    onPointerCancel(e: PointerEvent): void
  }
}

export function useDrag(
  box: RefObject<HTMLElement | null>,
  onDrop: (corner: Corner) => void
): Drag {
  const press = useRef<{ x: number; y: number; left: number; top: number }>(
    undefined
  )
  const moved = useRef(false)
  const last = useRef<Point>(undefined)
  const [at, setAt] = useState<Drag['at']>()

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.button !== 0 || !box.current) return
      const rect = box.current.getBoundingClientRect()
      press.current = {
        x: e.clientX,
        y: e.clientY,
        left: rect.left,
        top: rect.top,
      }
      moved.current = false
      e.currentTarget.setPointerCapture?.(e.pointerId)
    },
    [box]
  )

  const onPointerMove = useCallback((e: PointerEvent) => {
    const start = press.current
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (!moved.current && Math.hypot(dx, dy) < THRESHOLD) return
    moved.current = true
    last.current = { x: start.left + dx, y: start.top + dy }
    setAt({ left: start.left + dx, top: start.top + dy })
  }, [])

  const onPointerUp = useCallback(() => {
    const where = last.current
    press.current = undefined
    last.current = undefined
    if (!moved.current || !where || !box.current) return
    // The click that ends a drag follows this event at once; forget the drag after it.
    setTimeout(() => {
      moved.current = false
    }, 0)
    const { width, height } = box.current.getBoundingClientRect()
    onDrop(
      nearestCorner(
        { x: where.x + width / 2, y: where.y + height / 2 },
        { width: window.innerWidth, height: window.innerHeight }
      )
    )
    setAt(undefined)
  }, [box, onDrop])

  const onPointerCancel = useCallback(() => {
    press.current = undefined
    last.current = undefined
    moved.current = false
    setAt(undefined)
  }, [])

  return {
    at,
    wasDrag: () => moved.current,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  }
}
