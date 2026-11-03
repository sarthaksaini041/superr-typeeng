export const DURATIONS = [30, 45, 60, 90, 120, 180] as const
export type Duration = (typeof DURATIONS)[number]
export const TOPIC_MAX_LENGTH = 200
export const TOPIC_MAX_CODE_UNITS = 600

export function isDuration(value: unknown): value is Duration {
  return DURATIONS.some(duration => duration === value)
}

export const PASSAGE_LIMITS = {
  30: { minChars: 600, maxChars: 900, minWords: 100, maxWords: 115 },
  45: { minChars: 900, maxChars: 1250, minWords: 150, maxWords: 170 },
  60: { minChars: 1200, maxChars: 1650, minWords: 200, maxWords: 230 },
  90: { minChars: 1800, maxChars: 2300, minWords: 300, maxWords: 340 },
  120: { minChars: 2400, maxChars: 3000, minWords: 400, maxWords: 460 },
  180: { minChars: 3600, maxChars: 4000, minWords: 600, maxWords: 680 },
} satisfies Record<Duration, { minChars: number; maxChars: number; minWords: number; maxWords: number }>

const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('en', { granularity: 'grapheme' })
  : undefined

export function splitGraphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), part => part.segment) : Array.from(text)
}
