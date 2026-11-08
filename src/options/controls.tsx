/**
 * Small controls of the options page: a number field with − and + buttons, a slider with its number,
 * a segmented choice, and the lists of labels with their autocompleting picker. They hold no state of
 * the form; the form keeps the text and these draw and edit it.
 */
import * as Slider from '@radix-ui/react-slider'
import { Minus, Plus, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { labelKey } from '@/core/filter'
import { suggestions } from '@/panel/genres'

export const inputClass =
  'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-indigo-500'

const places = (step: number) => step.toString().split('.')[1]?.length ?? 0

/**
 * The text after pressing − or + on a number field. A blank or unreadable field steps to `start`;
 * the result is rounded to the step's decimals (so 4.1 + 0.1 is 4.2, not 4.199999) and kept in
 * `min`..`max`.
 */
export function stepText(
  text: string,
  direction: 1 | -1,
  {
    step,
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    start = 0,
  }: { step: number; min?: number; max?: number; start?: number }
): string {
  const current = text.trim() === '' ? Number.NaN : Number(text)
  const next = Number.isFinite(current) ? current + direction * step : start
  const rounded = Number(next.toFixed(places(step)))
  return String(Math.min(max, Math.max(min, rounded)))
}

const stepButton =
  'flex w-8 shrink-0 items-center justify-center text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-40 disabled:hover:bg-transparent'

/**
 * A text field for a number. With a `step`, − and + buttons sit at its ends; the typed text is never
 * rewritten, so a half-typed `4.` survives. `label` names the input and its buttons.
 */
export function NumberField({
  id,
  label,
  value,
  onChange,
  onBlur,
  step,
  min,
  max,
  start,
  placeholder,
  decimal = true,
  describedBy,
  prefix,
  className = 'w-16',
}: {
  id: string
  label: string
  value: string
  onChange(text: string): void
  onBlur?(): void
  step?: number
  min?: number
  max?: number
  /** Where a blank field goes on the first press of − or +. */
  start?: number
  placeholder?: string
  decimal?: boolean
  describedBy?: string
  /** A symbol drawn inside the field, before the number, such as a currency sign. */
  prefix?: string
  /** The input's width. */
  className?: string
}) {
  const change = (direction: 1 | -1) =>
    step !== undefined &&
    onChange(
      stepText(value, direction, { step, min, max, start: start ?? min })
    )
  const current = Number(value)
  const known = value.trim() !== '' && Number.isFinite(current)
  return (
    <div className='inline-flex h-9 items-stretch overflow-hidden rounded-md border border-slate-300 bg-white focus-within:outline-2 focus-within:outline-indigo-500'>
      {prefix && (
        <span
          aria-hidden='true'
          className='flex w-10 shrink-0 items-center justify-center border-r border-slate-200 bg-slate-50 text-xs text-slate-500'
        >
          {prefix}
        </span>
      )}
      {step !== undefined && (
        <button
          type='button'
          // Keyboard users have the arrow keys in the field; the buttons are for the pointer.
          tabIndex={-1}
          aria-label={`Decrease ${label}`}
          title={`Decrease by ${step}`}
          disabled={known && min !== undefined && current <= min}
          onClick={() => change(-1)}
          className={`${stepButton} border-r border-slate-200`}
        >
          <Minus aria-hidden='true' className='h-3.5 w-3.5' />
        </button>
      )}
      <input
        id={id}
        type='text'
        inputMode={decimal ? 'decimal' : 'text'}
        aria-label={label}
        aria-describedby={describedBy}
        value={value}
        placeholder={placeholder}
        onBlur={onBlur}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (step === undefined) return
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            change(1)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            change(-1)
          }
        }}
        className={`min-w-0 border-0 bg-transparent px-2 text-center text-sm tabular-nums outline-none placeholder:text-slate-400 ${className}`}
      />
      {step !== undefined && (
        <button
          type='button'
          tabIndex={-1}
          aria-label={`Increase ${label}`}
          title={`Increase by ${step}`}
          disabled={known && max !== undefined && current >= max}
          onClick={() => change(1)}
          className={`${stepButton} border-l border-slate-200`}
        >
          <Plus aria-hidden='true' className='h-3.5 w-3.5' />
        </button>
      )}
    </div>
  )
}

/** A slider over whole numbers with the number beside it; `value` is the form's text. */
export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  value: string
  onChange(text: string): void
  min: number
  max: number
}) {
  const parsed = Number(value)
  const at = Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, Math.round(parsed)))
    : min
  return (
    <Slider.Root
      value={[at]}
      min={min}
      max={max}
      step={1}
      onValueChange={([next]) => onChange(String(next ?? min))}
      className='relative flex h-5 w-48 touch-none items-center select-none'
    >
      <Slider.Track className='relative h-1.5 grow rounded-full bg-slate-200'>
        <Slider.Range className='absolute h-full rounded-full bg-indigo-600' />
      </Slider.Track>
      <Slider.Thumb
        aria-label={`${label} (slider)`}
        className='block h-4 w-4 rounded-full border-2 border-indigo-600 bg-white shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500'
      />
    </Slider.Root>
  )
}

/** One choice of several, drawn as a row of buttons; `label` names the group. */
export function Segmented<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
}: {
  /** The radio group's name, unique on the page. */
  name: string
  label: string
  value: T
  options: readonly { readonly value: T; readonly text: string }[]
  onChange(value: T): void
}) {
  return (
    <fieldset className='m-0 flex shrink-0 overflow-hidden rounded-md border border-slate-300 p-0 text-sm'>
      <legend className='sr-only'>{label}</legend>
      {options.map(option => (
        <label
          key={option.value}
          className='cursor-pointer border-l border-slate-300 px-3 py-1 text-slate-600 select-none first:border-l-0 hover:bg-slate-100 has-checked:bg-indigo-600 has-checked:text-white has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-indigo-500'
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

/** Removable pills of the labels in one list; a click removes one. */
export function LabelChips({
  noun,
  tone,
  labels,
  onRemove,
}: {
  /** What the list is called in a sentence, such as "hidden labels". */
  noun: string
  tone: 'hide' | 'highlight'
  labels: readonly string[]
  onRemove(label: string): void
}) {
  const chip =
    tone === 'highlight'
      ? 'bg-amber-100 text-amber-900 hover:bg-amber-200'
      : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
  return labels.length > 0 ? (
    <ul aria-label={noun} className='flex flex-wrap content-start gap-1.5'>
      {labels.map(label => (
        <li key={label}>
          <button
            type='button'
            title={`Click to remove “${label}” from the ${noun}`}
            aria-label={`Remove ${label} from the ${noun}`}
            onClick={() => onRemove(label)}
            className={`group flex items-center gap-1 rounded-full py-0.5 pr-1.5 pl-2.5 text-xs ${chip}`}
          >
            {label}
            <X
              aria-hidden='true'
              className='h-3 w-3 opacity-50 group-hover:opacity-100'
            />
          </button>
        </li>
      ))}
    </ul>
  ) : (
    <p className='text-xs text-slate-400'>No {noun} yet.</p>
  )
}

/**
 * A field that adds a label (a Goodreads genre) to a list, with suggestions from the genres of the
 * cached books. `taken` are the labels of both lists, which are not suggested. The arrow keys move
 * from the field into the suggestions and between them; Enter takes the best match, or the text.
 */
export function LabelPicker({
  id,
  title,
  help,
  noun,
  labels,
  taken,
  seen,
  onAdd,
}: {
  id: string
  title: string
  help: string
  noun: string
  /** The labels already in this list, which a label is not added to twice. */
  labels: readonly string[]
  taken: readonly string[]
  seen: readonly string[]
  onAdd(label: string): void
}) {
  const box = useRef<HTMLFieldSetElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState(false)
  const options = suggestions(seen, taken, typed, 8)
  const shown = open && options.length > 0

  function add(label: string) {
    const clean = label.trim()
    setTyped('')
    if (clean && !labels.some(l => labelKey(l) === labelKey(clean)))
      onAdd(clean)
  }
  /** What Enter takes: an exact match, else the first suggestion, else the text as typed. */
  const pick = () =>
    options.find(o => labelKey(o) === labelKey(typed)) ?? options[0] ?? typed
  const suggestionButtons = () =>
    [
      ...(box.current?.querySelectorAll('fieldset fieldset button') ?? []),
    ].filter((b): b is HTMLButtonElement => b instanceof HTMLButtonElement)
  function moveFrom(current: Element | null, by: 1 | -1) {
    const all = suggestionButtons()
    const at = current ? all.indexOf(current as HTMLButtonElement) : -1
    const next = all[at + by]
    if (next) next.focus()
    else if (by === -1) input.current?.focus()
  }

  return (
    <div className='flex h-full flex-col'>
      <label htmlFor={id} className='text-sm font-medium'>
        {title}
      </label>
      {/* The hint takes the slack, so two fields of one row start their inputs at the same height. */}
      <p className='options-hint mb-1.5 flex-1'>{help}</p>
      <fieldset
        ref={box}
        aria-label={`${title} picker`}
        className='relative m-0 flex min-w-0 gap-2 border-0 p-0'
        onFocus={() => setOpen(true)}
        onBlur={e => {
          // Moving between the field and its suggestions keeps them open.
          if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
        }}
      >
        <input
          ref={input}
          id={id}
          type='text'
          value={typed}
          placeholder='Add a genre, e.g. Romance'
          autoComplete='off'
          onChange={e => setTyped(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') setOpen(false)
            else if (e.key === 'ArrowDown' && shown) {
              e.preventDefault()
              moveFrom(null, 1)
            } else if (e.key === 'Enter') {
              // Never submit the form from here; adding is this field's own Enter.
              e.preventDefault()
              if (typed.trim() !== '') add(pick())
            }
          }}
          className={`${inputClass} min-w-0 flex-1`}
        />
        <button
          type='button'
          // Enter in the field adds; this is for the pointer.
          tabIndex={-1}
          aria-label={`Add to the ${noun}`}
          title={`Add to the ${noun}`}
          disabled={typed.trim() === ''}
          onClick={() => add(pick())}
          className='flex w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent'
        >
          <Plus aria-hidden='true' className='h-4 w-4' />
        </button>
        {shown && (
          <fieldset
            aria-label={`Suggestions for the ${noun}`}
            className='absolute top-full right-11 left-0 z-10 m-0 mt-1 flex max-h-56 min-w-0 flex-col overflow-y-auto rounded-md border border-slate-300 bg-white p-1 text-sm shadow-lg'
          >
            {options.map(option => (
              <button
                key={option}
                type='button'
                // Before the field loses focus: otherwise the list vanishes under the click.
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  add(option)
                  input.current?.focus()
                }}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    moveFrom(e.currentTarget, 1)
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    moveFrom(e.currentTarget, -1)
                  } else if (e.key === 'Escape') {
                    setOpen(false)
                    input.current?.focus()
                  }
                }}
                className='rounded px-2 py-1.5 text-left hover:bg-slate-100 focus-visible:bg-slate-100'
              >
                {option}
              </button>
            ))}
          </fieldset>
        )}
      </fieldset>
    </div>
  )
}
