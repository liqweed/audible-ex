/**
 * Small controls of the panel's filter settings: an info button whose explanation shows while it is
 * hovered or focused, and a row of radio buttons drawn as one segmented control. The explanation is
 * drawn here rather than with Radix Tooltip, whose positioning library would cost the panel's size
 * budget several KB (DECISIONS.md D19, D25).
 */
import { Info } from 'lucide-react'
import { type ReactNode, useId, useRef, useState } from 'react'

const TIP_WIDTH = 224
const MARGIN = 8

/** Where the explanation goes: above the button if there is room, else below; inside the window. */
export function tipPlace(
  button: { top: number; bottom: number; left: number; width: number },
  viewport: { width: number; height: number }
): { left: number; top?: number; bottom?: number } {
  const centre = button.left + button.width / 2
  const left = Math.min(
    Math.max(MARGIN, centre - TIP_WIDTH / 2),
    Math.max(MARGIN, viewport.width - TIP_WIDTH - MARGIN)
  )
  return button.top > 140
    ? { left, bottom: viewport.height - button.top + 6 }
    : { left, top: button.bottom + 6 }
}

/** An `i` button; `children` explain the control next to it. */
export function InfoTip({
  label,
  children,
}: {
  /** The button's accessible name, such as "About the minimum rating". */
  label: string
  children: ReactNode
}) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const [at, setAt] = useState<ReturnType<typeof tipPlace>>()
  const show = () => {
    const box = button.current?.getBoundingClientRect()
    if (box)
      setAt(
        tipPlace(box, { width: window.innerWidth, height: window.innerHeight })
      )
  }
  const hide = () => setAt(undefined)
  return (
    <>
      <button
        ref={button}
        type='button'
        aria-label={label}
        aria-describedby={at ? id : undefined}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={show}
        onKeyDown={e => {
          if (e.key === 'Escape') hide()
        }}
        className='inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-slate-400 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-indigo-400'
      >
        <Info aria-hidden='true' className='h-3.5 w-3.5' />
      </button>
      {at && (
        <span
          id={id}
          role='tooltip'
          style={{ position: 'fixed', width: TIP_WIDTH, ...at }}
          className='z-10 rounded-md bg-slate-800 px-2 py-1.5 text-[11px] leading-snug font-normal whitespace-normal text-white shadow-lg'
        >
          {children}
        </span>
      )}
    </>
  )
}

/** One choice of several, as radio buttons in a single compact bar; `label` names the group. */
export function Choice<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
}: {
  /** The radio group's name, unique in the panel. */
  name: string
  label: string
  value: T
  options: readonly { readonly value: T; readonly text: string }[]
  onChange(value: T): void
}) {
  return (
    <fieldset className='relative m-0 flex shrink-0 rounded border border-slate-300 p-0 text-[11px] leading-4'>
      <legend className='sr-only'>{label}</legend>
      {options.map(option => (
        <label
          key={option.value}
          className='cursor-pointer px-1.5 py-px text-slate-600 select-none first:rounded-l-[3px] last:rounded-r-[3px] hover:bg-slate-100 has-checked:bg-indigo-600 has-checked:text-white has-focus-visible:outline-2 has-focus-visible:outline-indigo-400'
        >
          <input
            type='radio'
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className='sr-only'
          />
          {option.text}
        </label>
      ))}
    </fieldset>
  )
}
