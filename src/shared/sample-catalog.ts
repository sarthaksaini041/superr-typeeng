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
  author: string
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
  author: string
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
  author: string
  category: ConcreteSampleCategory
  preview: string
  passage: string
  wordCount: number
  characterCount: number
}

const BOOK_METADATA: Record<
  string,
  { category: ConcreteSampleCategory; author: string; titles: readonly string[] }
> = {
  [starterTopic]: {
    category: 'Everyday & Modern',
    author: 'Original Vignette',
    titles: [starterTopic],
  },
  "Alice's Adventures in Wonderland": {
    category: 'Gothic & Speculative',
    author: 'Lewis Carroll',
    titles: [
      'Down the Rabbit Hole',
      'The Caucus-Race and a Long Tale',
      'Bill the Lizard Goes Down the Chimney',
      'A Serpent Among the Treetops',
      'Painting the White Roses Red',
      "The Queen's Croquet Ground",
      'The Lobster Quadrille',
    ],
  },
  Frankenstein: {
    category: 'Gothic & Speculative',
    author: 'Mary Shelley',
    titles: [
      'Letters from the Northern Ice',
      'Midnight Labours in the Workshop',
      'Justine in the Prison Cell',
      'The History of the De Lacey Family',
      'A Journey Through the Scottish Highlands',
      'The Threat of the Wedding Night',
      'A Final Farewell Upon the Ice',
    ],
  },
  'Pride and Prejudice': {
    category: 'Classic Fiction',
    author: 'Jane Austen',
    titles: [
      'A New Neighbor at Netherfield Park',
      'A Turn About the Drawing-Room',
      'An Evening at the Netherfield Ball',
      'Dining with Lady Catherine at Rosings',
      'The Regiment Leaves Meryton',
      'Bitter Regrets Over Wickham',
      'Walking Together to Oakham Mount',
      'A Letter of Congratulations from Lydia',
    ],
  },
  Dracula: {
    category: 'Gothic & Speculative',
    author: 'Bram Stoker',
    titles: [
      'Nightfall at the Hotel Royale',
      "A Texas Suitor's Proposal",
      'A Midnight Blood Transfusion',
      'Telegrams from Whitby',
      'Carting the Boxes of Earth',
      'Hypnosis Before the Dawn',
      'The Chase Through the Borgo Pass',
    ],
  },
  'Treasure Island': {
    category: 'Mystery & Adventure',
    author: 'Robert Louis Stevenson',
    titles: [
      'The Old Sea-Dog at the Admiral Benbow',
      "Flint's Map in the Oilskin Packet",
      'First Sight of Skeleton Island',
      'The Marooned Man of the Island',
      'Boarding the Drifting Hispaniola',
      'Dr. Livesey at the Stockade',
      'Homeward Bound from the Spanish Main',
    ],
  },
  'The Adventures of Sherlock Holmes': {
    category: 'Mystery & Adventure',
    author: 'Arthur Conan Doyle',
    titles: [
      'A Scandal in Bohemia',
      'The Capture of John Clay',
      'A Visitor in the Storm',
      'The Clue of the Battered Billycock',
      'The Strange Case of the Beryl Coronet',
      'Forty-Seven Missing Thousand-Pound Notes',
      'The Mastiff at the Copper Beeches',
    ],
  },
  'The Picture of Dorian Gray': {
    category: 'Gothic & Speculative',
    author: 'Oscar Wilde',
    titles: [
      "In the Painter's Summer Studio",
      'Wandering Through Grey London Streets',
      'A Sudden Engagement to Sibyl Vane',
      'After the Tragedy at the Theatre',
      'Basil Hallward on the Eve of Departure',
      'Mist Along the East End Docks',
      'Before the Altered Portrait',
    ],
  },
  'Moby-Dick': {
    category: 'Mystery & Adventure',
    author: 'Herman Melville',
    titles: [
      'Extracts of the Great Leviathan',
      'Signing Aboard the Pequod',
      'The Whiteness of the Whale',
      'A Nantucket Whaleboat Crew',
      'The Spouting of the Sperm Whale',
      "Does the Whale's Magnitude Diminish?",
      'The Final Chase of the White Whale',
    ],
  },
  'The Time Machine': {
    category: 'Science Fiction',
    author: 'H. G. Wells',
    titles: [
      'The Fourth Dimension Explained',
      'Launching into Futurity',
      'The Twilight of Humanity',
      "Descent into the Morlocks' Well",
      'Across the Valley Towards the Green Palace',
      'A Fire in the Dark Forest',
      'Two Strange White Flowers',
    ],
  },
  'The War of the Worlds': {
    category: 'Science Fiction',
    author: 'H. G. Wells',
    titles: [
      'The Eve of the Martian Invasion',
      'Return to the Horsell Common Pit',
      'A Fighting-Machine in the Wey',
      'Flight of the London Refugees',
      'The Martian Handling-Machines',
      'Wandering Across Putney Heath',
      'Reflections After the Wreckage',
    ],
  },
  'Great Expectations': {
    category: 'Classic Fiction',
    author: 'Charles Dickens',
    titles: [
      'The Convict on the Marshes',
      "Mr. Pumblechook's Arithmetic",
      "Measured for a Suit at Mr. Trabb's",
      'Walking with Estella in the Garden',
      'A Stranger on the Dark Staircase',
      'Miss Havisham by the Ashen Hearth',
      'Return to the Forge After Eleven Years',
    ],
  },
  'Jane Eyre': {
    category: 'Classic Fiction',
    author: 'Charlotte Bronte',
    titles: [
      'Preface to the Second Edition',
      'Advertising for a Governess Post',
      'Preparations for the Guests at Thornfield',
      'A Summons to Gateshead Hall',
      'Refusing to Be a Mistress',
      'St. John Rivers in the Winter Storm',
      'Ten Years at Ferndean',
    ],
  },
  'Anne of Green Gables': {
    category: 'Everyday & Modern',
    author: 'L. M. Montgomery',
    titles: [
      'Mrs. Rachel Lynde Is Surprised',
      'Marilla Decides to Keep Anne',
      'An October Morning at Green Gables',
      'Leaping into the Spare-Room Bed',
      'An Unfortunate Lily Maid',
      'Kindred Spirits After the Concert',
      'The Bend in the Road',
    ],
  },
  'Little Women': {
    category: 'Everyday & Modern',
    author: 'Louisa May Alcott',
    titles: [
      'Christmas Morning Without Presents',
      "Marmee's Secret Against Anger",
      'Tea and Overshoes in the Parlor',
      "Morning Calls at Aunt March's",
      'Secrets on the Sofa Pillow',
      'Lazy Laurence Takes Heart',
      'Under the Umbrella in the Rain',
    ],
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

const titleCounts = new Map<string, number>()

export const samples: SampleCatalogItem[] = rawSamples.map((entry, index) => {
  const occurrenceIndex = titleCounts.get(entry.title) ?? 0
  titleCounts.set(entry.title, occurrenceIndex + 1)

  const meta = BOOK_METADATA[entry.title]
  const curatedTitle = meta?.titles[occurrenceIndex] ?? entry.title
  const source = entry.title === starterTopic ? 'Original Vignette' : entry.title
  const author = meta?.author ?? 'Public Domain Literature'
  const category = meta?.category ?? 'Classic Fiction'

  return {
    id: index + 1,
    title: curatedTitle,
    subtitle: source,
    excerptLabel: source,
    source,
    author,
    category,
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
    author: sample.author,
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
        sample.source.toLowerCase().includes(normalizedQuery) ||
        sample.author.toLowerCase().includes(normalizedQuery) ||
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
        author: sample.author,
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
    author: sample.author,
    category: sample.category,
    preview: sample.preview,
    passage: sampleForDuration(sample.passage, duration),
  }
}
