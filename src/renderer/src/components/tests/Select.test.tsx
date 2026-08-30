// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Select, { type SelectOption } from '../Select'

const options: SelectOption[] = [
  { value: 'a', label: '选项 A', triggerLabel: 'A' },
  { value: 'b', label: '不可用选项', disabled: true },
  { value: 'c', label: '选项 C' },
]

let container: HTMLDivElement
let root: Root
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const originalActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  if (originalActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
})

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function renderSelect(
  onChange = vi.fn(),
  selectOptions: readonly SelectOption[] = options,
  value = 'a',
) {
  await act(async () => {
    root.render(
      <Select
        id="test-select"
        value={value}
        options={selectOptions}
        onChange={onChange}
        ariaLabel="测试选择器"
      />,
    )
  })
  return onChange
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function keyDown(element: Element, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

describe('Select', () => {
  it('renders a styled listbox and selects enabled options with the pointer', async () => {
    const onChange = await renderSelect()
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!

    expect(trigger.getAttribute('aria-label')).toBe('测试选择器')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.textContent).toBe('A')
    expect(container.querySelector('select')).toBeNull()

    await click(trigger)

    const listbox = container.querySelector('[role="listbox"]')!
    const renderedOptions = [...listbox.querySelectorAll('[role="option"]')]
    expect(listbox.classList.contains('select-scrollbar')).toBe(true)
    expect(renderedOptions).toHaveLength(3)
    expect(renderedOptions[0].getAttribute('aria-selected')).toBe('true')
    expect(renderedOptions[1].getAttribute('aria-disabled')).toBe('true')

    await click(renderedOptions[2])

    expect(onChange).toHaveBeenCalledWith('c')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('skips disabled options during keyboard navigation', async () => {
    const onChange = await renderSelect()
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!

    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.getAttribute('aria-activedescendant')).toContain('option-0')

    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith('c')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('uses bounded navigation and key-specific opening positions', async () => {
    await renderSelect()
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!

    await keyDown(trigger, 'ArrowUp')
    expect(trigger.getAttribute('aria-activedescendant')).toContain('option-0')
    await keyDown(trigger, 'ArrowUp')
    expect(trigger.getAttribute('aria-activedescendant')).toContain('option-0')

    await keyDown(trigger, 'End')
    expect(trigger.getAttribute('aria-activedescendant')).toContain('option-2')
    await keyDown(trigger, 'ArrowDown')
    expect(trigger.getAttribute('aria-activedescendant')).toContain('option-2')

    await keyDown(trigger, 'Home')
    expect(trigger.getAttribute('aria-activedescendant')).toContain('option-0')
  })

  it('commits the active option on Tab but cancels it on Escape', async () => {
    const onChange = await renderSelect()
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!

    await keyDown(trigger, 'ArrowDown')
    await keyDown(trigger, 'ArrowDown')
    await keyDown(trigger, 'Tab')
    expect(onChange).toHaveBeenCalledWith('c')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    onChange.mockClear()
    await keyDown(trigger, 'ArrowDown')
    await keyDown(trigger, 'ArrowDown')
    await keyDown(trigger, 'Escape')
    expect(onChange).not.toHaveBeenCalled()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('supports buffered multi-character typeahead and repeated-character cycling', async () => {
    const fruitOptions: SelectOption[] = [
      { value: 'apple', label: 'Apple' },
      { value: 'apricot', label: 'Apricot' },
      { value: 'banana', label: 'Banana' },
    ]
    const onChange = await renderSelect(vi.fn(), fruitOptions, 'banana')
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!

    await keyDown(trigger, 'a')
    await keyDown(trigger, 'p')
    expect(trigger.getAttribute('aria-activedescendant')).toContain('option-0')
    await keyDown(trigger, 'Tab')
    expect(onChange).toHaveBeenCalledWith('apple')

    onChange.mockClear()
    await keyDown(trigger, 'a')
    await keyDown(trigger, 'a')
    expect(trigger.getAttribute('aria-activedescendant')).toContain('option-1')
    await keyDown(trigger, 'Enter')
    expect(onChange).toHaveBeenCalledWith('apricot')
  })

  it('ignores disabled choices and closes on Escape or an outside pointer press', async () => {
    const onChange = await renderSelect()
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!

    await click(trigger)
    await click(container.querySelectorAll('[role="option"]')[1])
    expect(onChange).not.toHaveBeenCalled()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await click(trigger)
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })
})
