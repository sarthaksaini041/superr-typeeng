import { splitGraphemes } from '../shared/passage'
import type { Duration } from '../shared/passage'

export type FinishReason = 'passage_completed' | 'time_expired'

export interface TypingResult {
  reason: FinishReason
  elapsedMs: number
  wpm: number
  rawWpm: number
  accuracy: number
  errors: number
  unresolvedErrors: number
  missedCharacters: number
}

export interface TypingEntry {
  character: string
  correct: boolean
}

export function calculateResult(
  reason: FinishReason,
  elapsedMs: number,
  correctAttempts: number,
  errors: number,
  unresolvedErrors: number,
  missedCharacters = 0,
): TypingResult {
  const attempts = correctAttempts + errors
  const minutes = Math.max(elapsedMs, 1) / 60_000

  return {
    reason,
    elapsedMs,
    wpm: correctAttempts / 5 / minutes,
    rawWpm: attempts / 5 / minutes,
    accuracy: attempts ? correctAttempts / attempts * 100 : 0,
    errors: errors + missedCharacters,
    unresolvedErrors,
    missedCharacters,
  }
}

export interface TypingWord {
  expected: string[]
  separator: string
  entries: TypingEntry[]
  incorrect: number
  missed: number
  submitted: boolean
  revision: number
}

const MAX_EXTRA_CHARACTERS = 20

function tokenize(passage: string): TypingWord[] {
  return Array.from(passage.matchAll(/(\S+)(\s*)/gu), ([, word, separator]) => ({
    expected: splitGraphemes(word),
    separator,
    entries: [],
    incorrect: 0,
    missed: 0,
    submitted: false,
    revision: 0,
  }))
}

export class TypingEngine {
  readonly words: readonly TypingWord[]
  readonly leadingSpace: string
  wordIndex = 0
  revision = 0
  private startedAt: number | null = null
  private result: TypingResult | null = null
  private correctAttempts = 0
  private incorrectAttempts = 0
  private missedCharacters = 0
  private unresolvedErrors = 0

  constructor(passage: string, readonly duration: Duration) {
    this.words = tokenize(passage)
    this.leadingSpace = passage.match(/^\s*/u)?.[0] ?? ''
  }

  get deadline(): number | null {
    return this.startedAt === null ? null : this.startedAt + this.duration * 1_000
  }

  get finished(): boolean {
    return this.result !== null
  }

  remainingMs(now: number): number {
    const durationMs = this.duration * 1_000
    const elapsed = this.result?.elapsedMs ?? now - (this.startedAt ?? now)
    return Math.max(0, durationMs - elapsed)
  }

  expire(now: number): TypingResult | null {
    const deadline = this.deadline
    return deadline !== null && now >= deadline ? this.finish('time_expired', deadline) : null
  }

  insert(text: string, now: number): TypingResult | null {
    if (this.finished) return null

    const expired = this.expire(now)
    if (expired) return expired

    for (const character of splitGraphemes(text)) {
      const word = this.words[this.wordIndex]
      if (!word) return null
      const lastWord = this.wordIndex === this.words.length - 1
      if (character === ' ') {
        if (!lastWord && word.entries.length > 0) this.submitWord(word)
        continue
      }
      if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(character) || /^\p{Cf}+$/u.test(character)) continue

      this.startedAt ??= now
      const correct = character === word.expected[word.entries.length]
      if (correct) this.correctAttempts++
      else this.incorrectAttempts++

      if (word.entries.length < word.expected.length + MAX_EXTRA_CHARACTERS) {
        word.entries.push({ character, correct })
        if (!correct) {
          word.incorrect++
          this.unresolvedErrors++
        }
        this.touch(word)
      }

      if (lastWord && word.entries.length === word.expected.length) {
        word.submitted = true
        return this.finish('passage_completed', now)
      }
    }

    return null
  }

  backspace(now: number): TypingResult | null {
    if (this.finished) return null

    const expired = this.expire(now)
    if (expired) return expired

    const word = this.words[this.wordIndex]
    const removed = word?.entries.pop()
    if (removed) {
      if (!removed.correct) {
        word.incorrect--
        this.unresolvedErrors--
      }
      this.touch(word)
    } else {
      const previous = this.words[this.wordIndex - 1]
      if (previous && (previous.incorrect || previous.missed)) {
        this.wordIndex--
        this.unresolvedErrors -= previous.missed
        previous.missed = 0
        previous.submitted = false
        this.touch(previous)
      }
    }
    return null
  }

  private submitWord(word: TypingWord) {
    word.submitted = true
    word.missed = Math.max(0, word.expected.length - word.entries.length)
    this.missedCharacters += word.missed
    this.unresolvedErrors += word.missed
    this.correctAttempts++
    this.wordIndex++
    this.touch(word)
  }

  private touch(word: TypingWord) {
    word.revision++
    this.revision++
  }

  private finish(reason: FinishReason, now: number): TypingResult | null {
    if (this.finished || this.startedAt === null) return null

    this.result = calculateResult(
      reason,
      Math.max(0, now - this.startedAt),
      this.correctAttempts,
      this.incorrectAttempts,
      this.unresolvedErrors,
      this.missedCharacters,
    )
    return this.result
  }
}
