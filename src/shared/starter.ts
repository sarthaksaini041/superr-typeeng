import { PASSAGE_LIMITS } from './passage'
import type { Duration } from './passage'

export const starterTopic = 'A quiet morning at the station'

const paragraphs = [
  "Before dawn, the station belonged to the people who kept it running. A cleaner pushed a wide broom along the platform, and a cook lifted the shutter of the little cafe. The first pot of coffee hissed behind the counter. Out on the tracks, a red light held steady above the rails. Rain from the night before had collected in narrow pools between the sleepers, each one catching a piece of the yellow lamps. The clock was two minutes slow, as it had been all week, and the station manager had stopped promising to fix it.",
  "Mara came through the side gate with her coat folded over one arm. She usually took the early train because it was quiet enough to read. This morning she had left her book on the kitchen table. She bought a coffee and took it outside, where the cool air softened the heat rising from the cup. A pigeon walked the edge of the roof with the serious attention of someone inspecting a bridge. It stopped at a loose tile, tilted its head, and continued toward the gutter.",
  "At the other end of the platform, two teenagers leaned over a paper map. One ran a finger along a blue line while the other held the corners against the breeze. They were trying to work out where to change trains. The cleaner set his broom against a column and went over to help. He folded the map once to bring the right two towns closer together, then drew a small circle around the junction with a borrowed pen. The teenagers thanked him and moved closer to the front of the platform.",
  "By the time the crossing bell rang, the sky had turned the color of wet stone. The approaching train sounded a single note, low and brief, and its headlights appeared beyond the signal. A few people stepped back from the yellow line. The driver eased the carriages along the platform until the last door cleared the ramp. For a moment the windows reflected the station exactly as it was, with its crooked clock, empty benches, and one lamp that flickered whenever a train went past.",
  "Inside, the seats smelled faintly of wool and detergent. Mara chose a place by the window and balanced her coffee on the ledge. Across the aisle, a woman in gardening boots unfolded a newspaper with great care, stopping to smooth each crease with the heel of her hand. When the doors closed, someone in the next carriage laughed. The sound carried farther than anyone expected, and the woman looked up and smiled before returning to the weather report.",
  "The train passed a row of houses and then a long stretch of allotments. Under the low light, the plots looked like squares of different fabric sewn together. Bean poles leaned in pairs, and plastic bottles turned in the wind above the cabbages. At the far end, a man in a blue jacket was already opening his shed. He paused with the key in his hand to watch the train go by. Mara lifted her cup by way of greeting, though she knew he was too far away to notice.",
  "Beyond the gardens, the line curved into open country. A thin stream ran alongside the tracks for a while, quick and brown after the rain. It disappeared under a road and came out beside a field of cattle, where it widened into a slow pool. As the train gained speed, the nearest fence posts blurred into a single dark stripe, but the hills in the distance hardly seemed to move. The clouds opened over one of them, and light slid across the grass.",
  "Mara finished the coffee as the conductor came through. He checked her ticket, returned it, and continued down the aisle. When the train pulled into the next town, the first sunlight reached the platform. A baker in a white apron stepped aboard carrying a brown paper parcel. He tucked it beneath his seat and brushed flour from his sleeve. The doors closed again, and the wheels carried them east.",
]

const sentences = paragraphs.join(' ').split(/(?<=\.) /)

export function starterPassage(duration: Duration): string {
  const { minChars } = PASSAGE_LIMITS[duration]
  let passage = ''
  for (const sentence of sentences) {
    passage = passage ? passage + ' ' + sentence : sentence
    if (passage.length >= minChars) break
  }
  return passage
}
