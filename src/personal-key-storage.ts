import {
  AI_PROVIDER_BY_ID,
  isPersonalKey,
  validateByokConfig,
  type ByokConfig,
} from './shared/personal-key'

const legacyStorageKey = 'superr-typeeng.openai-key'

let activeByokConfig: ByokConfig | null = null

function scrubLegacyStorage(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(legacyStorageKey)
    }
  } catch {
    // Web Storage may be unavailable in restricted contexts.
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(legacyStorageKey)
    }
  } catch {
    // Web Storage may be unavailable in restricted contexts.
  }
}

scrubLegacyStorage()

export function readByokConfig(): ByokConfig | null {
  scrubLegacyStorage()
  return activeByokConfig ? { ...activeByokConfig } : null
}

export function saveByokConfig(config: ByokConfig | null): void {
  scrubLegacyStorage()
  if (config === null) {
    activeByokConfig = null
    return
  }
  const validated = validateByokConfig(config)
  activeByokConfig = validated ? { ...validated } : null
}

export function clearByokConfig(): void {
  scrubLegacyStorage()
  activeByokConfig = null
}

export function readPersonalKey(): string | null {
  scrubLegacyStorage()
  return activeByokConfig?.apiKey ?? null
}

export function savePersonalKey(value: string | null): void {
  scrubLegacyStorage()
  if (value === null) {
    activeByokConfig = null
    return
  }
  if (!isPersonalKey(value)) {
    activeByokConfig = null
    return
  }
  activeByokConfig = {
    provider: 'openai',
    apiKey: value,
    model: AI_PROVIDER_BY_ID.openai.defaultModel,
  }
}
