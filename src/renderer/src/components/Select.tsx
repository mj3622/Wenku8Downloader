import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { IconCheck, IconChevronDown } from '@tabler/icons-react'

const TYPEAHEAD_RESET_MS = 500

export type SelectOption = {
  value: string
  label: string
  triggerLabel?: string
  disabled?: boolean
}

type Props = {
  id?: string
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  ariaLabel?: string
  ariaLabelledBy?: string
  className?: string
  size?: 'default' | 'compact' | 'dense'
  align?: 'start' | 'end'
  appearance?: 'field' | 'chip'
  active?: boolean
  leadingIcon?: ReactNode
}

function adjacentEnabledIndex(
  options: readonly SelectOption[],
  from: number,
  direction: 1 | -1,
): number {
  for (
    let index = from + direction;
    index >= 0 && index < options.length;
    index += direction
  ) {
    if (!options[index]?.disabled) return index
  }
  return -1
}

function edgeEnabledIndex(options: readonly SelectOption[], edge: 'first' | 'last'): number {
  return adjacentEnabledIndex(options, edge === 'first' ? -1 : options.length, edge === 'first' ? 1 : -1)
}

export default function Select({
  id,
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
  className = '',
  size = 'default',
  align = 'start',
  appearance = 'field',
  active = false,
  leadingIcon,
}: Props) {
  const generatedId = useId()
  const triggerId = id ?? `select-${generatedId}`
  const listboxId = `${triggerId}-listbox`
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLDivElement | null>>([])
  const typeaheadRef = useRef({ value: '', updatedAt: 0 })
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const selectedIndex = options.findIndex(option => option.value === value)
  const selected = options[selectedIndex]

  const showMenu = (fromKeyboard: boolean, initialIndex = selectedIndex) => {
    if (disabled || options.length === 0) return
    const nextIndex = initialIndex >= 0 && !options[initialIndex]?.disabled
      ? initialIndex
      : edgeEnabledIndex(options, 'first')
    setActiveIndex(nextIndex)
    setKeyboardOpen(fromKeyboard)
    setOpen(true)
  }

  const closeMenu = () => {
    typeaheadRef.current = { value: '', updatedAt: 0 }
    setOpen(false)
  }

  const choose = (index: number, restoreFocus = true) => {
    const option = options[index]
    if (!option || option.disabled) return
    if (option.value !== value) onChange(option.value)
    closeMenu()
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [open])

  useEffect(() => {
    if (open && activeIndex >= 0) {
      optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [activeIndex, open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const moveActive = (direction: 1 | -1) => {
    const next = adjacentEnabledIndex(options, activeIndex, direction)
    if (next >= 0) setActiveIndex(next)
  }

  const matchTypeahead = (key: string): number => {
    const now = Date.now()
    const previous = now - typeaheadRef.current.updatedAt <= TYPEAHEAD_RESET_MS
      ? typeaheadRef.current.value
      : ''
    const nextValue = `${previous}${key.toLocaleLowerCase()}`
    typeaheadRef.current = { value: nextValue, updatedAt: now }
    const repeatedCharacter = nextValue.length > 1
      && [...nextValue].every(character => character === nextValue[0])
    const search = repeatedCharacter ? nextValue[0] : nextValue
    const currentIndex = open ? activeIndex : selectedIndex
    const start = repeatedCharacter || search.length === 1 ? currentIndex : -1
    const candidates = [
      ...options.slice(start + 1).map((option, offset) => ({ option, index: start + 1 + offset })),
      ...options.slice(0, start + 1).map((option, index) => ({ option, index })),
    ]
    return candidates.find(({ option }) => (
      !option.disabled && option.label.toLocaleLowerCase().startsWith(search)
    ))?.index ?? -1
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        showMenu(
          true,
          event.key === 'ArrowUp' ? edgeEnabledIndex(options, 'first') : selectedIndex,
        )
      } else moveActive(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const next = edgeEnabledIndex(options, event.key === 'Home' ? 'first' : 'last')
      if (!open) showMenu(true, next)
      if (next >= 0) setActiveIndex(next)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) choose(activeIndex)
      else showMenu(true)
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      closeMenu()
      return
    }
    if (event.key === 'Tab') {
      if (open && activeIndex >= 0) choose(activeIndex, false)
      return
    }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const match = matchTypeahead(event.key)
      if (match >= 0) {
        event.preventDefault()
        if (!open) showMenu(true, match)
        setActiveIndex(match)
      }
    }
  }

  const triggerSize = appearance === 'chip'
    ? 'h-9 text-[13px] font-medium'
    : size === 'default'
    ? 'h-10 text-sm'
    : 'h-9 text-[13px] font-medium'
  const triggerSpacing = appearance === 'chip'
    ? 'gap-1.5 px-2'
    : size === 'dense'
    ? 'gap-1 px-1.5'
    : 'gap-3 px-3'
  const chevronSize = size === 'dense' || appearance === 'chip' ? 14 : 16
  const triggerSurface = appearance === 'chip'
    ? active
      ? 'border-apple-accent/25 bg-apple-accent-light text-apple-accent hover:bg-apple-accent/15'
      : 'border-apple-border-input bg-white text-apple-body hover:border-apple-accent/25 hover:bg-black/[0.025]'
    : 'border-apple-border-input bg-white text-apple-heading hover:border-apple-accent/25'

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => open ? closeMenu() : showMenu(false)}
        onKeyDown={handleKeyDown}
        className={`${triggerSize} ${triggerSpacing} ${triggerSurface} flex w-full items-center justify-between rounded-lg border text-left outline-none transition-[color,background-color,border-color,box-shadow] duration-[160ms] ease-out-emphasized focus-visible:border-apple-accent/40 focus-visible:ring-2 focus-visible:ring-apple-accent/10 disabled:cursor-not-allowed disabled:bg-black/[0.025] disabled:text-apple-tertiary disabled:hover:border-apple-border-input ${open ? 'border-apple-accent/35 ring-2 ring-apple-accent/10' : ''}`}
      >
        {leadingIcon && (
          <span aria-hidden="true" className="flex h-4 w-4 flex-none items-center justify-center">
            {leadingIcon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate" title={selected?.label}>{selected?.triggerLabel ?? selected?.label ?? ''}</span>
        <IconChevronDown
          aria-hidden="true"
          size={chevronSize}
          stroke={1.8}
          className={`flex-none opacity-60 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className={`${keyboardOpen ? '' : 'motion-popover'} motion-select-popover--${align} absolute top-full z-40 mt-1.5 min-w-full w-max max-w-72 rounded-lg border border-apple-border-subtle bg-white p-1 shadow-lg ${align === 'end' ? 'right-0' : 'left-0'}`}
        >
          <div
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            className="select-scrollbar max-h-60 touch-pan-y overflow-y-auto overscroll-contain"
          >
            {options.map((option, index) => {
              const isSelected = option.value === value
              const isActive = index === activeIndex
              return (
                <div
                  ref={element => { optionRefs.current[index] = element }}
                  id={`${listboxId}-option-${index}`}
                  key={option.value}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  data-highlighted={isActive || undefined}
                  onPointerMove={() => !option.disabled && setActiveIndex(index)}
                  onClick={() => choose(index)}
                  className={`flex min-h-9 select-none items-center justify-between gap-4 rounded-md px-2.5 py-2 text-[13px] outline-none ${option.disabled ? 'cursor-not-allowed text-apple-tertiary' : isSelected ? 'cursor-default bg-apple-accent-light font-medium text-apple-accent' : isActive ? 'cursor-default bg-black/[0.045] text-apple-heading' : 'cursor-default text-apple-body hover:bg-black/[0.035]'}`}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  <span className="flex h-4 w-4 flex-none items-center justify-center">
                    {isSelected && <IconCheck aria-hidden="true" size={15} stroke={2.2} />}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
