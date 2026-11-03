import { memo, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { TypingEngine, TypingWord } from './engine'

const Word = memo(function Word({ word, active, activeCharacter }: {
  word: TypingWord
  active: boolean
  revision: number
  activeCharacter: RefObject<HTMLSpanElement | null>
}) {
  const cursor = Math.min(word.entries.length, word.expected.length)
  return (
    <>
      <span className="typing-word" data-current-word={active || undefined}>
        {word.expected.map((character, index) => {
          const entry = word.entries[index]
          const state = entry ? (entry.correct ? 'correct' : 'wrong') : word.submitted ? 'missed' : 'pending'
          return (
            <span key={index} className={`typing-char typing-char--${state}`}
              data-active={active && index === cursor || undefined}
              ref={active && index === cursor ? activeCharacter : undefined}>
              {character}
            </span>
          )
        })}
        {active && cursor === word.expected.length && (
          <span data-active ref={activeCharacter} aria-hidden="true">{'\u200b'}</span>
        )}
      </span>
      {word.separator}
    </>
  )
})

export const Passage = memo(function Passage({ engine, revision }: { engine: TypingEngine; revision: number }) {
  const viewport = useRef<HTMLDivElement>(null)
  const passage = useRef<HTMLParagraphElement>(null)
  const caret = useRef<HTMLSpanElement>(null)
  const activeCharacter = useRef<HTMLSpanElement>(null)
  const schedule = useRef<(() => void) | undefined>(undefined)

  useLayoutEffect(() => {
    const container = viewport.current
    const text = passage.current
    const cursor = caret.current
    if (!container || !text || !cursor) return

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let scrollFrame = 0
    let lineHeight = 0
    let fontSize = 0
    let scrollTarget = 0
    let previousLine: number | undefined

    function glideTo(target: number) {
      window.cancelAnimationFrame(scrollFrame)
      scrollTarget = target
      const start = container!.scrollTop
      const distance = target - start
      if (motion.matches || Math.abs(distance) < 1) {
        container!.scrollTop = target
        return
      }

      const duration = Math.min(300, 190 + 30 * Math.abs(distance) / lineHeight)
      const started = performance.now()
      function step(now: number) {
        const progress = motion.matches ? 1 : Math.min(1, Math.max(0, (now - started) / duration))
        const eased = 1 - (1 - progress) ** 3
        container!.scrollTop = start + distance * eased
        if (progress < 1) scrollFrame = window.requestAnimationFrame(step)
      }
      scrollFrame = window.requestAnimationFrame(step)
    }

    function queuePosition() {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const active = activeCharacter.current
        if (!active) return
        const bounds = active.getBoundingClientRect()
        const origin = text!.getBoundingClientRect()
        const x = bounds.left - origin.left
        const y = bounds.top - origin.top
        if (!lineHeight) {
          const style = getComputedStyle(container!)
          lineHeight = Number.parseFloat(style.lineHeight)
          fontSize = Number.parseFloat(style.fontSize)
        }
        const line = Math.floor((y + 0.5) / lineHeight)
        const firstLine = Math.round(scrollTarget / lineHeight)
        const targetLine = Math.max(0, Math.min(line, Math.max(firstLine, line - 1)))
        const target = targetLine * lineHeight

        const height = Math.min(fontSize, bounds.height)
        cursor!.dataset.lineChange = String(previousLine !== undefined && line !== previousLine)
        previousLine = line
        cursor!.style.transform = `translate3d(${x}px, ${y + (bounds.height - height) / 2}px, 0) scaleY(${height / fontSize})`
        cursor!.dataset.positioned = 'true'
        if (target !== scrollTarget) glideTo(target)
      })
    }

    function reflow() {
      lineHeight = 0
      queuePosition()
    }

    schedule.current = queuePosition
    const observer = new ResizeObserver(reflow)
    observer.observe(container)
    document.fonts.addEventListener('loadingdone', reflow)
    queuePosition()
    return () => {
      schedule.current = undefined
      window.cancelAnimationFrame(frame)
      window.cancelAnimationFrame(scrollFrame)
      observer.disconnect()
      document.fonts.removeEventListener('loadingdone', reflow)
    }
  }, [])

  useLayoutEffect(() => schedule.current?.(), [revision])

  return (
    <div className="typing-viewport" ref={viewport}>
      <p className="typing-passage" id="typing-passage" ref={passage}>
        {engine.leadingSpace}
        {engine.words.slice(0, engine.wordIndex + 32).map((word, index) => (
          <Word key={index} word={word} revision={word.revision} active={index === engine.wordIndex}
            activeCharacter={activeCharacter} />
        ))}
        <span className="typing-caret" ref={caret} aria-hidden="true" />
      </p>
    </div>
  )
})
