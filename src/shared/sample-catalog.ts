import { PASSAGE_LIMITS, splitGraphemes, type Duration } from './passage'
import publishedPassages from './sample-passages.json'
import { starterPassage, starterTopic } from './starter'

export const SAMPLE_CATEGORIES = [
  'All',
  'Everyday & Modern',
  'Science Fiction',
  'Mystery & Adventure',
  'Gothic & Speculative',
  'Classic Fiction',
] as const

export type SampleCategory = (typeof SAMPLE_CATEGORIES)[number]
export type ConcreteSampleCategory = Exclude<SampleCategory, 'All'>

export interface SampleCatalogItem {
  id: number
  title: string
  subtitle: string
  excerptLabel: string
  source: string
  category: ConcreteSampleCategory
  preview: string
  passage: string
}

export interface SampleListItem {
  id: number
  title: string
  subtitle: string
  excerptLabel: string
  source: string
  category: ConcreteSampleCategory
  preview: string
  duration: Duration
  wordCount: number
  characterCount: number
}

export interface SampleByIdResult {
  index: number
  id: number
  title: string
  subtitle: string
  excerptLabel: string
  source: string
  category: ConcreteSampleCategory
  preview: string
  passage: string
  wordCount: number
  characterCount: number
}

const BOOK_METADATA: Record<string, { category: ConcreteSampleCategory; source: string }> = {
  [starterTopic]: {
    category: 'Everyday & Modern',
    source: 'Original Vignette',
  },
  'Anne of Green Gables': {
    category: 'Everyday & Modern',
    source: 'L. M. Montgomery',
  },
  'Little Women': {
    category: 'Everyday & Modern',
    source: 'Louisa May Alcott',
  },
  'The Time Machine': {
    category: 'Science Fiction',
    source: 'H. G. Wells',
  },
  'The War of the Worlds': {
    category: 'Science Fiction',
    source: 'H. G. Wells',
  },
  'Treasure Island': {
    category: 'Mystery & Adventure',
    source: 'Robert Louis Stevenson',
  },
  'The Adventures of Sherlock Holmes': {
    category: 'Mystery & Adventure',
    source: 'Arthur Conan Doyle',
  },
  'Moby-Dick': {
    category: 'Mystery & Adventure',
    source: 'Herman Melville',
  },
  "Alice's Adventures in Wonderland": {
    category: 'Gothic & Speculative',
    source: 'Lewis Carroll',
  },
  Frankenstein: {
    category: 'Gothic & Speculative',
    source: 'Mary Shelley',
  },
  Dracula: {
    category: 'Gothic & Speculative',
    source: 'Bram Stoker',
  },
  'The Picture of Dorian Gray': {
    category: 'Gothic & Speculative',
    source: 'Oscar Wilde',
  },
  'Pride and Prejudice': {
    category: 'Classic Fiction',
    source: 'Jane Austen',
  },
  'Great Expectations': {
    category: 'Classic Fiction',
    source: 'Charles Dickens',
  },
  'Jane Eyre': {
    category: 'Classic Fiction',
    source: 'Charlotte Bronte',
  },
}

function buildPreview(passage: string): string {
  const normalized = passage.replace(/\s+/g, ' ').trim()
  const maxLen = 140
  const ending = /[.!?]["')\]]*(?= |$)/g
  let candidate = ''
  for (const match of normalized.matchAll(ending)) {
    const end = match.index + match[0].length
    if (end <= maxLen) {
      candidate = normalized.slice(0, end)
      if (candidate.length >= 48) return candidate
    } else {
      break
    }
  }
  if (candidate.length >= 24) return candidate
  if (normalized.length <= maxLen) return normalized
  const cut = normalized.lastIndexOf(' ', maxLen - 3)
  return `${normalized.slice(0, cut > 40 ? cut : maxLen - 3)}...`
}

function countWords(passage: string): number {
  const trimmed = passage.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

const rawSamples = [{ title: starterTopic, passage: starterPassage(180) }, ...publishedPassages]

const titleTotals = new Map<string, number>()
for (const entry of rawSamples) {
  titleTotals.set(entry.title, (titleTotals.get(entry.title) ?? 0) + 1)
}

const titleCounts = new Map<string, number>()

export const samples: SampleCatalogItem[] = rawSamples.map((entry, index) => {
  const occurrence = (titleCounts.get(entry.title) ?? 0) + 1
  titleCounts.set(entry.title, occurrence)
  const total = titleTotals.get(entry.title) ?? 1
  const meta = BOOK_METADATA[entry.title] ?? {
    category: 'Classic Fiction' as const,
    source: 'Public Domain Literature',
  }
  const excerptLabel = total > 1 ? `Excerpt ${occurrence} of ${total}` : 'Featured Passage'
  const subtitle = `${meta.source} · ${excerptLabel}`

  return {
    id: index + 1,
    title: entry.title,
    subtitle,
    excerptLabel,
    source: meta.source,
    category: meta.category,
    preview: buildPreview(entry.passage),
    passage: entry.passage,
  }
})

export function sampleForDuration(passage: string, duration: Duration): string {
  if (duration === 180) return passage

  const { minChars, maxChars } = PASSAGE_LIMITS[duration]
  // Sample texts use ASCII so code-unit offsets also count typing characters.
  const ending = /[.!?]["')\]]*(?= |$)/g
  for (const match of passage.matchAll(ending)) {
    const end = match.index + match[0].length
    if (end >= minChars && end <= maxChars) return passage.slice(0, end)
  }
  return passage.slice(0, passage.lastIndexOf(' ', maxChars))
}

export function getSampleById(id: number, duration: Duration): SampleByIdResult {
  const foundIndex = samples.findIndex(sample => sample.id === id)
  const index = foundIndex >= 0 ? foundIndex : 0
  const sample = samples[index]
  const passage = sampleForDuration(sample.passage, duration)
  return {
    index,
    id: sample.id,
    title: sample.title,
    subtitle: sample.subtitle,
    excerptLabel: sample.excerptLabel,
    source: sample.source,
    category: sample.category,
    preview: sample.preview,
    passage,
    wordCount: countWords(passage),
    characterCount: splitGraphemes(passage).length,
  }
}

export function listSamples(options?: {
  category?: SampleCategory
  duration?: Duration
  query?: string
}): SampleListItem[] {
  const category = options?.category ?? 'All'
  const duration = options?.duration ?? 30
  const normalizedQuery = options?.query?.trim().toLowerCase() ?? ''

  return samples
    .filter(sample => {
      if (category !== 'All' && sample.category !== category) return false
      if (!normalizedQuery) return true
      return (
        sample.title.toLowerCase().includes(normalizedQuery) ||
        sample.subtitle.toLowerCase().includes(normalizedQuery) ||
        sample.source.toLowerCase().includes(normalizedQuery) ||
        sample.category.toLowerCase().includes(normalizedQuery) ||
        sample.preview.toLowerCase().includes(normalizedQuery)
      )
    })
    .map(sample => {
      const passage = sampleForDuration(sample.passage, duration)
      return {
        id: sample.id,
        title: sample.title,
        subtitle: sample.subtitle,
        excerptLabel: sample.excerptLabel,
        source: sample.source,
        category: sample.category,
        preview: sample.preview,
        duration,
        wordCount: countWords(passage),
        characterCount: splitGraphemes(passage).length,
      }
    })
}

export function chooseSample(duration: Duration, previous: number | null) {
  const offset = Math.floor(Math.random() * (samples.length - (previous === null ? 0 : 1)))
  const index = previous !== null && offset >= previous ? offset + 1 : offset
  const sample = samples[index]
  return {
    index,
    id: sample.id,
    title: sample.title,
    subtitle: sample.subtitle,
    excerptLabel: sample.excerptLabel,
    source: sample.source,
    category: sample.category,
    preview: sample.preview,
    passage: sampleForDuration(sample.passage, duration),
  }
}
