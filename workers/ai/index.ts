import { handleWorkerRequest } from '../../server/passage.ts'
import { DailyQuotaDurableObject } from '../../server/quota.ts'
import type { Env } from './env.ts'

export { DailyQuotaDurableObject }
export type { Env } from './env.ts'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleWorkerRequest(request, env)
  },
}
