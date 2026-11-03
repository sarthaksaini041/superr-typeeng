const topics = [
  'How small software teams build reliable systems',
  'What makes a language model useful',
  'The chemistry behind sourdough bread',
  'What we can learn from the moons of Jupiter',
  'How forests recover after a wildfire',
  'The everyday life of a medieval mapmaker',
  'Why some small businesses thrive on one street',
  'How a debugger helps programmers investigate mistakes',
  'Why familiar smells bring back vivid memories',
  'The quiet rituals of an early morning market',
  'How photographers work with natural light',
  'What makes a good question in a classroom',
  'Why cats land on their feet',
  'The engineering of a city bicycle',
  'What happens inside a coral reef at night',
  'How libraries decide what to collect',
  'The origins of punctuation',
  'How weather forecasts turn observations into predictions',
  'Why human beings invent games',
  'A day in the life of a railway signaler',
  'How a film editor shapes a conversation',
  'Why some languages sound faster than others',
  'What makes an old building cool in summer',
  'How plants tell one season from another',
] as const

export function chooseRandomTopic(current: string): string {
  const alternatives = topics.filter(topic => topic !== current.trim())
  return alternatives[Math.floor(Math.random() * alternatives.length)]
}
