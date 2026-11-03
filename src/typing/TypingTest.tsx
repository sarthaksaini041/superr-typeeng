import { useEffect, useEffectEvent, useLayoutEffect, useReducer, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { splitGraphemes, type Duration } from '../shared/passage'
import { TypingEngine } from './engine'
import type { TypingResult } from './engine'
import { Passage } from './Passage'
import './typing.css'

interface TypingTestProps {
  passage: string
  duration: Duration
  sessionId: number
  onStart: () => void
  onRemaining: (seconds: number) => void
  onFinish: (result: TypingResult) => void
  onCapsLock: (active: boolean) => void
}

const sentinel = '\u200B'
const blockedEdits = /^(?:insertFrom(?:Paste|Drop|Yank)|insertReplacementText|history)/

function resetInput(input: HTMLTextAreaElement) {
  input.value = sentinel
  input.setSelectionRange(sentinel.length, sentinel.length)
}

function inputTimestamp(timestamp: number): number {
  const now = performance.now()
  return timestamp > 0 && timestamp <= now ? timestamp : now
}

export function TypingTest(props: TypingTestProps) {
  return <TypingSession key={props.sessionId} {...props} />
}

function TypingSession({
  passage, duration, onStart, onRemaining, onFinish, onCapsLock,
}: TypingTestProps) {
  const [engine] = useState(() => new TypingEngine(passage, duration))
  const [started, setStarted] = useState(false)
  const [, redraw] = useReducer((revision: number) => revision + 1, 0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const composing = useRef(false)
  const compositionFrame = useRef<number | undefined>(undefined)

  function finish(result: TypingResult) {
    window.clearTimeout(timer.current)
    inputRef.current?.blur()
    onFinish(result)
  }

  const tick = useEffectEvent(() => {
    const now = performance.now()
    const result = engine.expire(now)
    if (result) {
      onRemaining(0)
      finish(result)
      return null
    }

    if (engine.finished) return null

    const milliseconds = engine.remainingMs(now)
    onRemaining(Math.ceil(milliseconds / 1_000))
    return milliseconds % 1_000 || 1_000
  })

  useLayoutEffect(() => {
    if (!started) return

    function update() {
      window.clearTimeout(timer.current)
      const delay = tick()
      if (delay !== null) timer.current = window.setTimeout(update, delay)
    }

    update()
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', update)
    }
  }, [started])

  const updateCapsLock = useEffectEvent((active: boolean) => onCapsLock(active))
  useEffect(() => {
    const check = (event: globalThis.KeyboardEvent) => updateCapsLock(event.getModifierState?.('CapsLock') ?? false)
    const reset = () => updateCapsLock(false)
    window.addEventListener('keydown', check)
    window.addEventListener('keyup', check)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', check)
      window.removeEventListener('keyup', check)
      window.removeEventListener('blur', reset)
    }
  }, [])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return

    const beforeInput = (event: InputEvent) => {
      if (!event.isComposing && blockedEdits.test(event.inputType)) event.preventDefault()
    }
    resetInput(input)
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      input.focus({ preventScroll: true })
    }

    input.addEventListener('beforeinput', beforeInput)
    return () => {
      input.removeEventListener('beforeinput', beforeInput)
      window.cancelAnimationFrame(compositionFrame.current ?? 0)
    }
  }, [])

  function applyInput(input: HTMLTextAreaElement, operation: string, now: number, fallback = '') {
    const previousRevision = engine.revision
    const wasReady = engine.deadline === null
    const value = input.value.startsWith(sentinel) ? input.value.slice(sentinel.length) : input.value
    const result = operation.startsWith('delete')
      ? engine.backspace(now)
      : engine.insert(value || fallback, now)

    resetInput(input)
    if (wasReady && engine.deadline !== null) {
      setStarted(true)
      onStart()
    }
    if (result) finish(result)
    if (previousRevision !== engine.revision || result) redraw()
  }

  const captureKey = useEffectEvent((event: globalThis.KeyboardEvent) => {
    const input = inputRef.current
    if (!input || engine.finished || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    if (document.activeElement === input) return
    const printable = splitGraphemes(event.key).length === 1
    if (!printable && event.key !== 'Backspace') return
    if (event.key === ' ' && event.target instanceof HTMLElement && event.target.closest('button, a, [role="button"]')) return
    event.preventDefault()
    input.focus({ preventScroll: true })
    applyInput(input, event.key === 'Backspace' ? 'deleteContentBackward' : 'insertText', inputTimestamp(event.timeStamp), printable ? event.key : '')
  })

  useEffect(() => {
    window.addEventListener('keydown', captureKey)
    return () => window.removeEventListener('keydown', captureKey)
  }, [])

  function handleInput(event: FormEvent<HTMLTextAreaElement>) {
    const nativeEvent = event.nativeEvent as InputEvent
    if (composing.current || nativeEvent.isComposing) return
    window.cancelAnimationFrame(compositionFrame.current ?? 0)
    if (blockedEdits.test(nativeEvent.inputType)) {
      resetInput(event.currentTarget)
      return
    }

    const operation = nativeEvent.inputType || (event.currentTarget.value ? 'insertText' : 'deleteContentBackward')
    applyInput(event.currentTarget, operation, inputTimestamp(event.timeStamp))
  }

  function keepInputAtEnd(input: HTMLTextAreaElement) {
    if (composing.current) return
    const end = input.value.length
    if (input.selectionStart !== end || input.selectionEnd !== end) input.setSelectionRange(end, end)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (composing.current || event.nativeEvent.isComposing) return
    if (!event.altKey && !event.ctrlKey && !event.metaKey && /^(Arrow|Home|End|Page)/.test(event.key)) {
      event.preventDefault()
    }
  }

  return (
    <div className="typing-test">
      <div className="typing-stage">
        <Passage engine={engine} revision={engine.revision} />
        <textarea
          ref={inputRef}
          className="typing-input"
          aria-label="Typing test input"
          aria-describedby="typing-passage"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          rows={1}
          defaultValue={sentinel}
          disabled={engine.finished}
          onFocus={event => keepInputAtEnd(event.currentTarget)}
          onSelect={event => keepInputAtEnd(event.currentTarget)}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={event => event.preventDefault()}
          onDrop={event => event.preventDefault()}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={event => {
            composing.current = false
            const input = event.currentTarget
            const text = event.data
            const now = inputTimestamp(event.timeStamp)
            // Some keyboards emit a final input event, while others commit at compositionend.
            // Let the input event handle the edit first and use the frame only as a fallback.
            window.cancelAnimationFrame(compositionFrame.current ?? 0)
            compositionFrame.current = window.requestAnimationFrame(() => {
              applyInput(input, 'insertText', now, text)
            })
          }}
        />
      </div>
      <div className="typing-feedback">
        <p className="typing-focus-hint" aria-hidden="true">
          <span className="typing-focus-touch">Tap the passage to type</span>
        </p>
      </div>
    </div>
  )
}
