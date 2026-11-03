import { describe, expect, it } from 'vitest'
import { calculateResult, TypingEngine } from './engine'

describe('character attempts', () => {
  it('compares case, punctuation, consecutive spaces and Unicode graphemes exactly', () => {
    const engine = new TypingEngine("A  e\u0301👩🏽‍💻'!", 30)

    engine.insert('a ', 100)
    engine.insert(' é👩🏽‍💻’', 1_000)
    const result = engine.insert('!', 5_100)

    expect(engine.words.map(word => word.entries.map(entry => entry.correct))).toEqual([[false], [false, true, false, true]])
    expect(result).toMatchObject({
      reason: 'passage_completed',
      elapsedMs: 5_000,
      errors: 3,
      unresolvedErrors: 3,
    })
    expect(result?.accuracy).toBeCloseTo(3 / 6 * 100)
  })

  it('rewinds both correct and wrong input while preserving historical attempts', () => {
    const engine = new TypingEngine('ab', 30)

    engine.backspace(100)
    engine.insert('z', 500)
    engine.backspace(600)
    expect(engine.words[0].entries.map(entry => entry.correct)).toEqual([])
    engine.insert('a', 700)
    engine.backspace(800)
    expect(engine.words[0].entries.map(entry => entry.correct)).toEqual([])
    engine.insert('a', 900)
    const result = engine.insert('b', 12_500)

    expect(result).toMatchObject({
      reason: 'passage_completed',
      elapsedMs: 12_000,
      rawWpm: 4,
      accuracy: 75,
      errors: 1,
      unresolvedErrors: 0,
    })
    expect(result?.wpm).toBeCloseTo(3)
  })

  it('finishes on a wrong final character and ignores separate late input', () => {
    const engine = new TypingEngine('ab', 30)
    engine.insert('a', 500)
    const result = engine.insert('z', 6_500)

    expect(result).toMatchObject({ elapsedMs: 6_000, errors: 1, unresolvedErrors: 1 })
    expect(engine.insert('c', 7_000)).toBeNull()
    expect(engine.backspace(7_100)).toBeNull()
    expect(engine.words[0].entries).toEqual([
      { character: 'a', correct: true },
      { character: 'z', correct: false },
    ])
  })

  it('caps extras on the active word and preserves the next word and historical errors', () => {
    const engine = new TypingEngine('a! next', 30)
    engine.insert('a!' + '🤖'.repeat(25), 500)
    expect(engine.words[0].entries).toHaveLength(22)
    expect(engine.words[0].incorrect).toBe(20)
    engine.insert(' ', 600)
    expect(engine.wordIndex).toBe(1)
    expect(engine.words[1].entries).toEqual([])
    expect(engine.insert('next', 6_500)).toMatchObject({ errors: 25, unresolvedErrors: 20 })
  })
})

describe('monotonic deadlines', () => {
  it('does not start on empty input, nonprintable input, or backspace alone', () => {
    const engine = new TypingEngine('a b', 30)
    expect(engine.remainingMs(20)).toBe(30_000)
    engine.insert('', 20)
    engine.insert('\t\n', 21)
    engine.backspace(22)
    expect(engine.expire(60_000)).toBeNull()
    expect(engine.deadline).toBeNull()
    expect(engine.remainingMs(60_000)).toBe(30_000)
    engine.insert('   ', 64_000)
    expect(engine.deadline).toBeNull()
    engine.insert('a', 65_000)
    expect(engine.deadline).toBe(95_000)
    expect(engine.remainingMs(65_250)).toBe(29_750)
  })

  it('expires after a delayed callback at the original deadline, ignoring untyped text', () => {
    const engine = new TypingEngine('long passage', 45)
    engine.insert('l', 100)
    expect(engine.expire(40_000)).toBeNull()
    engine.insert('z', 42_000)
    expect(engine.deadline).toBe(45_100)

    expect(engine.expire(56_500)).toEqual({
      reason: 'time_expired',
      elapsedMs: 45_000,
      rawWpm: (2 / 5) / 0.75,
      wpm: (1 / 5) / 0.75,
      accuracy: 50,
      errors: 1,
      unresolvedErrors: 1,
      missedCharacters: 0,
    })
    expect(engine.remainingMs(100_000)).toBe(0)
    expect(engine.expire(100_000)).toBeNull()
  })

  it('completes just before the deadline and finalizes only once', () => {
    const engine = new TypingEngine('ab', 30)
    engine.insert('a', 100)
    const result = engine.insert('b', 30_099.8)

    expect(result?.reason).toBe('passage_completed')
    expect(result?.elapsedMs).toBeCloseTo(29_999.8)
    expect(engine.expire(30_100)).toBeNull()
  })

  it('gives timeout precedence when the next input arrives at the deadline', () => {
    const engine = new TypingEngine('ab', 30)
    engine.insert('a', 100)

    expect(engine.insert('b', 30_100)).toMatchObject({ reason: 'time_expired', elapsedMs: 30_000 })
    expect(engine.expire(30_100)).toBeNull()
    expect(engine.words[0].entries.map(entry => entry.correct)).toEqual([true])
  })

  it('preserves the original deadline after deleting all typed characters', () => {
    const engine = new TypingEngine('ab', 30)
    engine.insert('a', 100)
    engine.backspace(110)

    expect(engine.words[0].entries.map(entry => entry.correct)).toEqual([])
    expect(engine.expire(30_100)).toMatchObject({
      elapsedMs: 30_000,
      reason: 'time_expired',
      accuracy: 100,
    })
  })

  it('isolates a restarted test from the previous engine and deadline', () => {
    const previous = new TypingEngine('ab', 30)
    previous.insert('a', 100)
    previous.insert('b', 200)
    const restarted = new TypingEngine('ab', 30)

    expect(previous.expire(30_100)).toBeNull()
    expect(restarted.deadline).toBeNull()
    expect(restarted.words[0].entries).toEqual([])
    expect(restarted.remainingMs(30_100)).toBe(30_000)
  })
})

describe('metric bounds', () => {
  it('keeps rates finite for a single immediate attempt and zero-attempt calculation', () => {
    const engine = new TypingEngine('a', 30)
    const result = engine.insert('a', 120)

    expect(result?.elapsedMs).toBe(0)
    expect(Number.isFinite(result?.wpm)).toBe(true)
    expect(calculateResult('time_expired', 0, 0, 0, 0)).toMatchObject({
      rawWpm: 0,
      wpm: 0,
      accuracy: 0,
      errors: 0,
    })
  })
})

describe('word navigation', () => {
  it('retains exact separators and only submits once when Space is repeated', () => {
    const engine = new TypingEngine('Hi,  there! Last.', 30)
    engine.insert('Hi,', 100)
    expect(engine.wordIndex).toBe(0)
    engine.insert('   ', 200)
    expect(engine.wordIndex).toBe(1)
    expect(engine.words[0]).toMatchObject({ separator: '  ', submitted: true, missed: 0 })
    engine.backspace(300)
    expect(engine.wordIndex).toBe(1)
    engine.insert('there! ', 400)
    expect(engine.wordIndex).toBe(2)
    expect(engine.insert('Last.', 6_100)).toMatchObject({ errors: 0, accuracy: 100 })
  })

  it('counts missed punctuation and other omissions without adding typing attempts', () => {
    const engine = new TypingEngine('beautiful, first. End.', 30)
    engine.insert('beauti ', 100)
    engine.insert('firsx ', 200)
    expect(engine.wordIndex).toBe(2)
    expect(engine.words[0]).toMatchObject({ missed: 4, incorrect: 0 })
    expect(engine.words[1]).toMatchObject({ missed: 1, incorrect: 1 })
    engine.insert('End ', 300)
    expect(engine.finished).toBe(false)
    const result = engine.insert('.', 12_100)
    expect(result).toMatchObject({ missedCharacters: 5, errors: 6, unresolvedErrors: 6, rawWpm: 17 })
    expect(result?.accuracy).toBeCloseTo(16 / 17 * 100)
  })

  it('reopens a word with a typo and missed characters and preserves error history', () => {
    const engine = new TypingEngine('Hello, world!', 30)
    engine.insert('Hex ', 100)
    engine.backspace(200)
    expect(engine.wordIndex).toBe(0)
    expect(engine.words[0]).toMatchObject({ submitted: false, missed: 0, incorrect: 1 })
    engine.backspace(300)
    engine.backspace(400)
    const result = engine.insert('ello, world!', 12_100)
    expect(result).toMatchObject({ errors: 4, missedCharacters: 3, unresolvedErrors: 0 })
  })

  it.each([',', '.', '?', '!', ':', ';', "'", '"', '-', '(', ')'])('compares %s as an exact part of the word', punctuation => {
    const engine = new TypingEngine(`a${punctuation} b`, 30)
    engine.insert('a# ', 100)
    expect(engine.words[0]).toMatchObject({ missed: 0, incorrect: 1 })
    engine.backspace(200)
    engine.backspace(300)
    expect(engine.insert(`${punctuation} b`, 1_100)).toMatchObject({ errors: 1, unresolvedErrors: 0 })
  })
})
