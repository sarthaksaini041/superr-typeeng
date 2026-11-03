import {
  Add01Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  Book02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  DiceFaces05Icon,
  RefreshIcon,
  SentIcon,
  Settings01Icon,
  TextAllCapsIcon,
  Tick02Icon,
  ViewIcon,
  ViewOffSlashIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { DURATIONS, splitGraphemes, TOPIC_MAX_LENGTH, TOPIC_MAX_CODE_UNITS, type Duration } from '../shared/passage'
import {
  AI_PROVIDERS,
  AI_PROVIDER_BY_ID,
  DAILY_FREE_GENERATION_LIMIT,
  formatRemainingQuota,
  isAiProviderId,
  maskApiKey,
  MAX_PERSONAL_KEY_LENGTH,
  validateCloudflareAccountId,
  validateProviderApiKey,
  type AiProviderId,
  type ByokConfig,
} from '../shared/personal-key'
import {
  getSampleById,
  listSamples,
  SAMPLE_CATEGORIES,
  type SampleCategory,
} from '../shared/sample-catalog'
import { readByokConfig, saveByokConfig } from '../personal-key-storage'
import './styles.css'

export { chooseRandomTopic } from './topics'

const iconStroke = 2.25

function EyeMark() {
  return <span className="eye-mark" aria-hidden="true"><span /><span /></span>
}

export function Brand({
  onDice,
  onSettings,
  diceDisabled = false,
  diceVersion = 0,
}: {
  onDice?: () => void
  onSettings?: () => void
  diceDisabled?: boolean
  diceVersion?: number
}) {
  return (
    <header className="site-header">
      <div className="brand-lockup">
        <EyeMark />
        <span>superr-typeeng</span>
      </div>
      {(onDice || onSettings) && (
        <div className="brand-actions">
          {onDice && (
            <button className="icon-button dice-button" type="button" aria-label="Choose a random topic"
              disabled={diceDisabled} onClick={onDice}>
              <span key={diceVersion} className={diceVersion > 0 ? 'dice-spin' : undefined}>
                <HugeiconsIcon icon={DiceFaces05Icon} size={21} strokeWidth={iconStroke} aria-hidden="true" />
              </span>
            </button>
          )}
          {onSettings && (
            <button className="icon-button dice-button" type="button" aria-label="Settings"
              aria-haspopup="dialog" disabled={diceDisabled} onClick={onSettings}>
              <HugeiconsIcon icon={Settings01Icon} size={21} strokeWidth={iconStroke} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </header>
  )
}

type MenuPlacement = { side: 'below' | 'above'; maxHeight?: number }

// Space kept between the menu and the trigger, and between the menu and the screen edge.
const MENU_GAP = 8
const MENU_EDGE = 8

/** Opens the menu on the side with room for it, capping its height when neither side fits. */
function placeMenu(trigger: DOMRect, menuHeight: number, container?: DOMRect | null): MenuPlacement {
  const viewport = window.visualViewport
  const viewportTop = viewport?.offsetTop ?? 0
  const viewportBottom = viewportTop + (viewport?.height ?? document.documentElement.clientHeight)
  const visibleTop = container ? Math.max(viewportTop, container.top + 4) : viewportTop
  const visibleBottom = container ? Math.min(viewportBottom, container.bottom - 4) : viewportBottom
  const below = visibleBottom - trigger.bottom - MENU_GAP - MENU_EDGE
  const above = trigger.top - visibleTop - MENU_GAP - MENU_EDGE
  if (menuHeight <= below) return { side: 'below' }
  if (menuHeight <= above) return { side: 'above' }
  // Whole pixels keep the scrollable area aligned with integer scroll offsets.
  return below >= above
    ? { side: 'below', maxHeight: Math.max(0, Math.floor(below)) }
    : { side: 'above', maxHeight: Math.max(0, Math.floor(above)) }
}

interface SelectMenuOption {
  readonly id: string
  readonly label: string
}

function SettingsSelectMenu({
  id,
  labelId,
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  id: string
  labelId: string
  label: string
  value: string
  options: readonly SelectMenuOption[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const listboxId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<number | null>(null)
  const [placement, setPlacement] = useState<MenuPlacement>({ side: 'below' })
  const open = active !== null && !disabled
  const selectedIndex = Math.max(
    0,
    options.findIndex(item => item.id === value),
  )
  const selectedOption = options[selectedIndex] ?? options[0]

  useLayoutEffect(() => {
    if (!open) return
    let frame = 0
    function measure() {
      frame = 0
      const button = trigger.current
      const list = panel.current
      if (!button || !list) return
      const border = list.offsetHeight - list.clientHeight
      const dialogRect = button.closest('dialog')?.getBoundingClientRect() ?? null
      const naturalHeight = Math.min(list.scrollHeight + border, 232)
      const next = placeMenu(button.getBoundingClientRect(), naturalHeight, dialogRect)
      setPlacement(current =>
        current.side === next.side && current.maxHeight === next.maxHeight ? current : next,
      )
    }
    function queueMeasure() {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }
    measure()
    const viewport = window.visualViewport
    window.addEventListener('resize', queueMeasure)
    window.addEventListener('scroll', queueMeasure, { passive: true, capture: true })
    viewport?.addEventListener('resize', queueMeasure)
    viewport?.addEventListener('scroll', queueMeasure)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', queueMeasure)
      window.removeEventListener('scroll', queueMeasure, { capture: true })
      viewport?.removeEventListener('resize', queueMeasure)
      viewport?.removeEventListener('scroll', queueMeasure)
    }
  }, [open, options.length])

  useEffect(() => {
    const list = panel.current
    const option = active === null ? null : list?.children[active]
    if (!list || !(option instanceof HTMLElement)) return
    const view = list.getBoundingClientRect()
    const item = option.getBoundingClientRect()
    const borderWidth = (list.offsetHeight - list.clientHeight) / 2
    const top = view.top + borderWidth
    const bottom = view.bottom - borderWidth
    if (item.top < top) list.scrollTop -= Math.ceil(top - item.top)
    else if (item.bottom > bottom) list.scrollTop += Math.ceil(item.bottom - bottom)
  }, [active])

  function choose(index: number) {
    const chosen = options[index]
    if (chosen) onChange(chosen.id)
    setActive(null)
    trigger.current?.focus()
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    const key = event.key
    if (key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setActive(null)
    } else if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault()
      const step = key === 'ArrowDown' ? 1 : -1
      setActive(
        active === null
          ? selectedIndex
          : Math.min(options.length - 1, Math.max(0, active + step)),
      )
    } else if (open && (key === 'Home' || key === 'End')) {
      event.preventDefault()
      setActive(key === 'Home' ? 0 : options.length - 1)
    } else if (active !== null && (key === 'Enter' || key === ' ')) {
      event.preventDefault()
      choose(active)
    } else if (key === 'Tab') {
      setActive(null)
    }
  }

  return (
    <div
      className="settings-select-menu"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setActive(null)
      }}
    >
      <button
        ref={trigger}
        id={id}
        className="settings-select-trigger"
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-label={label}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && active !== null ? `${listboxId}-${active}` : undefined}
        data-value={value}
        disabled={disabled}
        onKeyDown={handleKey}
        onClick={() => setActive(open ? null : selectedIndex)}
      >
        <span className="settings-select-value">{selectedOption?.label ?? value}</span>
        <span className="settings-select-chevron" aria-hidden="true">
          <HugeiconsIcon icon={ArrowDown01Icon} size={16} strokeWidth={iconStroke} aria-hidden="true" />
        </span>
      </button>
      <div
        id={listboxId}
        className="settings-select-options"
        role="listbox"
        aria-label={label}
        data-side={placement.side}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="settings-select-clip">
          <div
            className="settings-select-panel"
            ref={panel}
            style={placement.maxHeight === undefined ? undefined : { maxBlockSize: placement.maxHeight }}
          >
            {options.map((option, index) => {
              const isSelected = option.id === value
              return (
                <button
                  key={option.id}
                  id={`${listboxId}-${index}`}
                  className="settings-select-item"
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-value={option.id}
                  data-highlighted={active === index}
                  tabIndex={-1}
                  onClick={() => choose(index)}
                >
                  <span className="settings-select-item-label">{option.label}</span>
                  {isSelected && (
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      size={15}
                      strokeWidth={iconStroke}
                      aria-hidden="true"
                      className="settings-select-check"
                    />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

const PROVIDER_SELECT_OPTIONS: readonly SelectMenuOption[] = AI_PROVIDERS.map(provider => ({
  id: provider.id,
  label: provider.name,
}))

export function SettingsDialog({
  onClose,
  remainingQuota = DAILY_FREE_GENERATION_LIMIT,
  byokConfig,
  onSaveByok,
  onOpenFreePassages,
}: {
  onClose: () => void
  remainingQuota?: number
  byokConfig?: ByokConfig | null
  onSaveByok?: (config: ByokConfig | null) => void
  onOpenFreePassages?: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [savedConfig, setSavedConfig] = useState<ByokConfig | null>(() =>
    byokConfig !== undefined ? byokConfig : readByokConfig(),
  )
  const [selectedProvider, setSelectedProvider] = useState<AiProviderId>(
    () => savedConfig?.provider ?? 'openai',
  )
  const providerSpec = AI_PROVIDER_BY_ID[selectedProvider]
  const [selectedModel, setSelectedModel] = useState<string>(() =>
    savedConfig?.provider === selectedProvider ? savedConfig.model : providerSpec.defaultModel,
  )
  const [keyInput, setKeyInput] = useState('')
  const [accountIdInput, setAccountIdInput] = useState<string>(() =>
    savedConfig?.provider === 'cloudflare' && savedConfig.accountId ? savedConfig.accountId : '',
  )
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  const isCurrentProviderConfigured = savedConfig?.provider === selectedProvider
  const trimmedKey = keyInput.trim()
  const effectiveKey =
    trimmedKey.length > 0
      ? trimmedKey
      : isCurrentProviderConfigured && savedConfig
        ? savedConfig.apiKey
        : ''
  const trimmedAccountId = accountIdInput.trim()
  const isKeyFormatValid = validateProviderApiKey(selectedProvider, effectiveKey)
  const isAccountValid =
    !providerSpec.requiresAccountId || validateCloudflareAccountId(trimmedAccountId)
  const isKeyVerified = isKeyFormatValid && isAccountValid

  const activeSpec = savedConfig ? AI_PROVIDER_BY_ID[savedConfig.provider] : null
  const activeModelLabel = activeSpec
    ? (activeSpec.models.find(item => item.id === savedConfig?.model)?.label ?? savedConfig?.model)
    : null

  function handleProviderChange(nextId: string) {
    if (!isAiProviderId(nextId)) return
    const nextSpec = AI_PROVIDER_BY_ID[nextId]
    setSelectedProvider(nextId)
    setSelectedModel(savedConfig?.provider === nextId ? savedConfig.model : nextSpec.defaultModel)
    setKeyInput('')
    setShowKey(false)
    setError('')
  }

  function handleModelChange(nextModel: string) {
    setSelectedModel(nextModel)
    if (error) setError('')
    if (isKeyVerified) {
      const nextConfig: ByokConfig = {
        provider: selectedProvider,
        apiKey: effectiveKey,
        model: nextModel,
        ...(providerSpec.requiresAccountId ? { accountId: trimmedAccountId } : {}),
      }
      try {
        saveByokConfig(nextConfig)
        setSavedConfig(nextConfig)
        onSaveByok?.(nextConfig)
      } catch {
        // Defer error reporting to explicit Save action if needed.
      }
    }
  }

  function handleSave() {
    if (!validateProviderApiKey(selectedProvider, effectiveKey)) {
      setError(`Enter a valid ${providerSpec.name} API key.`)
      return
    }

    if (providerSpec.requiresAccountId && !validateCloudflareAccountId(trimmedAccountId)) {
      setError('Enter a valid Cloudflare Account ID.')
      return
    }

    const nextConfig: ByokConfig = {
      provider: selectedProvider,
      apiKey: effectiveKey,
      model: selectedModel,
      ...(providerSpec.requiresAccountId ? { accountId: trimmedAccountId } : {}),
    }

    try {
      saveByokConfig(nextConfig)
      setSavedConfig(nextConfig)
      onSaveByok?.(nextConfig)
      setKeyInput('')
      dialog.current?.close()
    } catch {
      setError('This browser could not update the saved key.')
    }
  }

  function handleRemove() {
    try {
      saveByokConfig(null)
      setSavedConfig(null)
      onSaveByok?.(null)
      setKeyInput('')
      setError('')
      dialog.current?.close()
    } catch {
      setError('This browser could not remove the saved key.')
    }
  }

  return (
    <dialog className="settings-dialog" ref={dialog} onClose={onClose} aria-labelledby="settings-title">
      <div className="settings-heading">
        <h2 id="settings-title">Settings</h2>
        <button className="icon-button" type="button" aria-label="Close settings" onClick={() => dialog.current?.close()}>
          <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={iconStroke} aria-hidden="true" />
        </button>
      </div>
      <p className="settings-description">
        Get 5 free AI generations every day. Use free passages anytime, or connect your own API key for more.
      </p>
      <div className="settings-quota-row">
        <span className="settings-quota-badge" data-exhausted={remainingQuota <= 0}>
          {formatRemainingQuota(remainingQuota)}
        </span>
        {onOpenFreePassages && (
          <button
            className="text-button settings-passages-trigger"
            type="button"
            onClick={() => {
              dialog.current?.close()
              onOpenFreePassages()
            }}
          >
            <HugeiconsIcon icon={Book02Icon} size={16} strokeWidth={iconStroke} aria-hidden="true" />
            Free passages
          </button>
        )}
      </div>
      <form
        className="settings-form"
        autoComplete="off"
        onSubmit={event => {
          event.preventDefault()
          handleSave()
        }}
      >
        <div className="settings-field">
          <label id="ai-provider-label" htmlFor="ai-provider-select">AI provider</label>
          <SettingsSelectMenu
            id="ai-provider-select"
            labelId="ai-provider-label"
            label="AI provider"
            value={selectedProvider}
            options={PROVIDER_SELECT_OPTIONS}
            onChange={handleProviderChange}
          />
        </div>

        <div className="settings-field">
          <div className="settings-label-row">
            <label htmlFor="personal-api-key">{providerSpec.name} API key</label>
            <a
              className="settings-key-link"
              href={providerSpec.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Get {providerSpec.name} API key
            </a>
          </div>
          <div className="settings-key-input-wrap">
            <input
              id="personal-api-key"
              name="key"
              type={showKey ? 'text' : 'password'}
              value={keyInput}
              onChange={event => {
                setKeyInput(event.currentTarget.value)
                if (error) setError('')
              }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={MAX_PERSONAL_KEY_LENGTH}
              placeholder={
                isCurrentProviderConfigured && savedConfig
                  ? `Key configured (${maskApiKey(savedConfig.apiKey)})`
                  : providerSpec.placeholder
              }
              aria-describedby="settings-connection-status settings-key-note"
            />
            <button
              className="icon-button settings-key-toggle"
              type="button"
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              aria-pressed={showKey}
              onClick={() => setShowKey(current => !current)}
            >
              <HugeiconsIcon
                icon={showKey ? ViewOffSlashIcon : ViewIcon}
                size={18}
                strokeWidth={iconStroke}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>

        {providerSpec.requiresAccountId && (
          <div className="settings-field">
            <label htmlFor="cloudflare-account-id">Cloudflare Account ID</label>
            <input
              id="cloudflare-account-id"
              name="accountId"
              type="text"
              value={accountIdInput}
              onChange={event => {
                setAccountIdInput(event.currentTarget.value)
                if (error) setError('')
              }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={64}
              placeholder="32-character hex Account ID"
            />
          </div>
        )}

        <div
          className="settings-model-reveal"
          data-verified={isKeyVerified}
          aria-hidden={!isKeyVerified}
          inert={!isKeyVerified}
        >
          <div className="settings-model-reveal-clip">
            <div className="settings-field settings-model-field">
              <div className="settings-label-row">
                <label id="ai-model-label" htmlFor="ai-model-select">Model</label>
                <span className="settings-verified-pill">
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} strokeWidth={iconStroke} aria-hidden="true" />
                  Key verified
                </span>
              </div>
              <SettingsSelectMenu
                id="ai-model-select"
                labelId="ai-model-label"
                label="Model"
                value={selectedModel}
                options={providerSpec.models}
                disabled={!isKeyVerified}
                onChange={handleModelChange}
              />
            </div>
          </div>
        </div>

        <p id="settings-connection-status" className="settings-status" data-connected={Boolean(savedConfig)}>
          {savedConfig && activeSpec
            ? `Connected · ${activeSpec.name} (${activeModelLabel}) · ${maskApiKey(savedConfig.apiKey)}`
            : 'Using shared daily quota'}
        </p>
        <p id="settings-key-note" className="settings-note">
          Your key stays in memory for this session and contacts {providerSpec.name} directly using your own account limits.
        </p>
        {error && <p className="settings-error" role="alert">{error}</p>}
        <div className="settings-actions">
          {savedConfig && (
            <button className="text-button" type="button" onClick={handleRemove}>
              Remove key
            </button>
          )}
          <button className="action-button action-button-primary" type="submit">
            Save key
          </button>
        </div>
      </form>
    </dialog>
  )
}

export function FreePassagesDialog({
  duration,
  onDurationChange,
  onSelectPassage,
  onRandomPassage,
  onClose,
}: {
  duration: Duration
  onDurationChange: (duration: Duration) => void
  onSelectPassage: (sample: { id: number; index: number; title: string; passage: string; duration: Duration }) => void
  onRandomPassage: () => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [category, setCategory] = useState<SampleCategory>('All')
  const items = listSamples({ category, duration })

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])

  return (
    <dialog className="passages-dialog" ref={dialog} onClose={onClose} aria-labelledby="passages-title">
      <div className="passages-heading">
        <div>
          <h2 id="passages-title">Free passages</h2>
          <p className="passages-subtitle">100 built-in passages · Instant practice without AI quota or API keys</p>
        </div>
        <div className="passages-heading-actions">
          <button
            className="action-button action-button-primary passages-random-button"
            type="button"
            onClick={() => {
              dialog.current?.close()
              onRandomPassage()
            }}
          >
            <HugeiconsIcon icon={DiceFaces05Icon} size={17} strokeWidth={iconStroke} aria-hidden="true" />
            Random passage
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Close free passages"
            onClick={() => dialog.current?.close()}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={iconStroke} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="passages-filters">
        <div className="passages-filter-group" role="group" aria-label="Category">
          {SAMPLE_CATEGORIES.map(item => (
            <button
              key={item}
              type="button"
              className="filter-chip"
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="passages-filter-group passages-duration-group" role="group" aria-label="Test duration">
          {DURATIONS.map(seconds => (
            <button
              key={seconds}
              type="button"
              className="filter-chip filter-chip-mono"
              aria-pressed={duration === seconds}
              onClick={() => onDurationChange(seconds)}
            >
              {seconds}s
            </button>
          ))}
        </div>
      </div>

      <div className="passages-list" role="list" aria-label="Free passages list">
        {items.map(item => (
          <div key={item.id} className="passage-card-item" role="listitem">
            <button
              type="button"
              className="passage-card"
              onClick={() => {
                const chosen = getSampleById(item.id, duration)
                dialog.current?.close()
                onSelectPassage({
                  id: chosen.id,
                  index: chosen.index,
                  title: chosen.title,
                  passage: chosen.passage,
                  duration,
                })
              }}
            >
              <div className="passage-card-header">
                <span className="passage-card-title">
                  {item.title}
                  <span className="passage-card-excerpt"> — {item.excerptLabel}</span>
                </span>
                <span className="passage-card-meta">
                  <span className="passage-card-badge">{item.category}</span>
                  <span> · {item.duration}s · ~{item.wordCount} words</span>
                </span>
              </div>
              <p className="passage-card-preview">{item.preview}</p>
            </button>
          </div>
        ))}
      </div>
    </dialog>
  )
}

const generationMessages = [
  'Thinking of something interesting…',
  'Crafting your passage…',
  'Preparing your challenge…',
] as const

function GenerationStatus({ active, onCancel }: { active: boolean; onCancel?: () => void }) {
  return (
    <div className="generation-status" data-active={active} inert={!active}>
      <div className="generation-animation"><EyeMark /></div>
      <div className="generation-messages" aria-hidden="true">
        {generationMessages.map(message => <p key={message}>{message}</p>)}
      </div>
      {active && <span className="visually-hidden" role="status">Generating your passage.</span>}
      {onCancel && <button className="text-button" type="button" onClick={onCancel}>Cancel</button>}
    </div>
  )
}

interface SetupProps {
  topic: string
  onTopicChange: (value: string) => void
  duration: Duration
  onDurationChange: (value: Duration) => void
  onSubmit: () => void
  status: 'idle' | 'generating' | 'error'
  onPractice?: () => void
  practiceBusy?: boolean
  onCancel?: () => void
  remainingQuota?: number
  byokConfig?: ByokConfig | null
}

function DurationMenu({ duration, onChange, disabled }: {
  duration: Duration
  onChange: (duration: Duration) => void
  disabled: boolean
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<number | null>(null)
  const [placement, setPlacement] = useState<MenuPlacement>({ side: 'below' })
  const open = active !== null && !disabled
  const selected = DURATIONS.indexOf(duration)

  useLayoutEffect(() => {
    if (!open) return
    let frame = 0
    function measure() {
      frame = 0
      const button = trigger.current
      const list = panel.current
      if (!button || !list) return
      const border = list.offsetHeight - list.clientHeight
      const next = placeMenu(button.getBoundingClientRect(), list.scrollHeight + border)
      setPlacement(current => current.side === next.side && current.maxHeight === next.maxHeight ? current : next)
    }
    function queueMeasure() {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }
    measure()
    const viewport = window.visualViewport
    window.addEventListener('resize', queueMeasure)
    window.addEventListener('scroll', queueMeasure, { passive: true, capture: true })
    viewport?.addEventListener('resize', queueMeasure)
    viewport?.addEventListener('scroll', queueMeasure)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', queueMeasure)
      window.removeEventListener('scroll', queueMeasure, { capture: true })
      viewport?.removeEventListener('resize', queueMeasure)
      viewport?.removeEventListener('scroll', queueMeasure)
    }
  }, [open])

  useEffect(() => {
    // Keep the keyboard-highlighted option visible when the list is capped and scrolls.
    const list = panel.current
    const option = active === null ? null : list?.children[active]
    if (!list || !(option instanceof HTMLElement)) return
    const view = list.getBoundingClientRect()
    const item = option.getBoundingClientRect()
    const borderWidth = (list.offsetHeight - list.clientHeight) / 2
    const top = view.top + borderWidth
    const bottom = view.bottom - borderWidth
    // Round toward revealing the whole option, since scroll offsets can snap to whole pixels.
    if (item.top < top) list.scrollTop -= Math.ceil(top - item.top)
    else if (item.bottom > bottom) list.scrollTop += Math.ceil(item.bottom - bottom)
  }, [active])

  function choose(index: number) {
    onChange(DURATIONS[index])
    setActive(null)
    trigger.current?.focus()
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    const key = event.key
    if (key === 'Escape' && open) {
      event.preventDefault()
      setActive(null)
    } else if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault()
      const step = key === 'ArrowDown' ? 1 : -1
      setActive(active === null ? selected : Math.min(DURATIONS.length - 1, Math.max(0, active + step)))
    } else if (open && (key === 'Home' || key === 'End')) {
      event.preventDefault()
      setActive(key === 'Home' ? 0 : DURATIONS.length - 1)
    } else if (active !== null && (key === 'Enter' || key === ' ')) {
      event.preventDefault()
      choose(active)
    } else if (key === 'Tab') {
      setActive(null)
    }
  }

  return (
    <div className="duration-menu" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setActive(null)
    }}>
      <button ref={trigger} className="duration-trigger" type="button" role="combobox"
        aria-label="Test duration" aria-expanded={open} aria-controls={id}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled} onKeyDown={handleKey}
        onClick={() => setActive(open ? null : selected)}>
        {duration}s
      </button>
      <div id={id} className="duration-options" role="listbox" aria-label="Test duration"
        data-side={placement.side} aria-hidden={!open} inert={!open}>
        <div className="duration-options-clip">
          <div className="duration-options-panel" ref={panel}
            style={placement.maxHeight === undefined ? undefined : { maxBlockSize: placement.maxHeight }}>
            {DURATIONS.map((seconds, index) => (
              <button key={seconds} id={`${id}-${index}`} className="duration-item" type="button"
                role="option" aria-selected={seconds === duration} data-highlighted={active === index}
                tabIndex={-1} onClick={() => choose(index)}>
                {seconds}s
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function Setup({
  topic,
  onTopicChange,
  duration,
  onDurationChange,
  onSubmit,
  status,
  onPractice,
  practiceBusy = false,
  onCancel,
  remainingQuota = DAILY_FREE_GENERATION_LIMIT,
  byokConfig,
}: SetupProps) {
  const generating = status === 'generating'
  const count = splitGraphemes(topic).length
  const activeByok = byokConfig ? AI_PROVIDER_BY_ID[byokConfig.provider] : null
  const activeModelLabel = activeByok
    ? (activeByok.models.find(item => item.id === byokConfig?.model)?.label ?? byokConfig?.model)
    : null

  return (
    <main className="setup-screen" aria-labelledby="setup-heading">
      <div className="setup-content">
        <h1 id="setup-heading">What would you like to type?</h1>
        <form className="topic-form" onSubmit={event => {
          event.preventDefault()
          if (topic.trim() && !generating) onSubmit()
        }}>
          <div className="topic-field">
            <input type="text" aria-label="Passage topic" name="topic" placeholder="Enter a topic"
              value={topic} disabled={generating} autoComplete="off" maxLength={TOPIC_MAX_CODE_UNITS} aria-describedby="topic-limit"
              onChange={event => onTopicChange(
                splitGraphemes(event.currentTarget.value).slice(0, TOPIC_MAX_LENGTH).join(''),
              )} />
            <span className="topic-progress" role="meter" aria-label="Topic characters used"
              aria-valuemin={0} aria-valuemax={TOPIC_MAX_LENGTH} aria-valuenow={count} aria-hidden={count === 0}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle className="topic-progress-track" cx="12" cy="12" r="9" />
                <circle className="topic-progress-fill" cx="12" cy="12" r="9" pathLength="100"
                  strokeDasharray={`${count / TOPIC_MAX_LENGTH * 100} 100`} transform="rotate(-90 12 12)" />
              </svg>
            </span>
            <span className="visually-hidden" id="topic-limit">Up to {TOPIC_MAX_LENGTH} characters</span>
            <button className="icon-button send-button" type="submit" aria-label="Generate passage"
              disabled={generating || !topic.trim()}>
              <HugeiconsIcon icon={SentIcon} size={20} strokeWidth={iconStroke} aria-hidden="true" />
            </button>
          </div>
          <DurationMenu duration={duration} onChange={onDurationChange} disabled={generating} />
        </form>
        <div className="setup-feedback">
          <GenerationStatus active={generating} onCancel={onCancel} />
          {onPractice && (
            <div className="sample-option" inert={generating}>
              <button className="text-button practice-link" type="button" onClick={onPractice} disabled={practiceBusy}>
                <HugeiconsIcon icon={Book02Icon} size={17} strokeWidth={iconStroke} aria-hidden="true" />
                Free passages
              </button>
              <p className="setup-quota-note" data-exhausted={!activeByok && remainingQuota <= 0}>
                {activeByok
                  ? `Connected · ${activeByok.name} (${activeModelLabel})`
                  : formatRemainingQuota(remainingQuota)}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function SessionActions({
  onRestart,
  onNewTopic,
  prominent = false,
  inactive = false,
}: {
  onRestart: () => void
  onNewTopic: () => void
  prominent?: boolean
  inactive?: boolean
}) {
  return (
    <div className="session-actions" inert={inactive}>
      <button className={prominent ? 'action-button action-button-primary' : 'text-button'}
        type="button" onClick={onRestart}>
        <HugeiconsIcon icon={RefreshIcon} size={17} strokeWidth={iconStroke} aria-hidden="true" />
        Restart
      </button>
      <button className={prominent ? 'action-button action-button-secondary' : 'text-button'}
        type="button" onClick={onNewTopic}>
        <HugeiconsIcon icon={Add01Icon} size={17} strokeWidth={iconStroke} aria-hidden="true" />
        New topic
      </button>
    </div>
  )
}

export function SessionFrame({
  topic,
  remainingMs,
  running,
  onRestart,
  onNewTopic,
  children,
}: {
  topic: string
  remainingMs: number
  running: boolean
  onRestart: () => void
  onNewTopic: () => void
  children: ReactNode
}) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const minutes = Math.floor(seconds / 60)
  const secondsPart = String(seconds % 60).padStart(2, '0')

  return (
    <main className="session-screen" data-running={running} aria-labelledby="session-topic">
      <div className="session-content">
        <div className="session-topline">
          <h1 id="session-topic" className="session-topic">{topic}</h1>
          <div className="session-timer" role="timer">
            <span className="visually-hidden">Time remaining</span>
            <span>{minutes}:{secondsPart}</span>
          </div>
        </div>
        {children}
        <SessionActions onRestart={onRestart} onNewTopic={onNewTopic} inactive={running} />
      </div>
    </main>
  )
}

interface ResultsProps {
  topic: string
  reason: 'passage_completed' | 'time_expired'
  elapsedMs: number
  wpm: number
  rawWpm: number
  accuracy: number
  onRestart: () => void
  onNewTopic: () => void
}

const scoreNumber = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })
const timeNumber = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 2 })

export function Results({
  topic,
  reason,
  elapsedMs,
  wpm,
  rawWpm,
  accuracy,
  onRestart,
  onNewTopic,
}: ResultsProps) {
  const completion = useRef<HTMLHeadingElement>(null)
  const passageCompleted = reason === 'passage_completed'
  const speed = scoreNumber.format(wpm)
  const decimal = speed.lastIndexOf('.')
  const elapsedSeconds = elapsedMs / 1000
  const formattedElapsed = elapsedSeconds >= 60
    ? `${Math.floor(elapsedSeconds / 60)}m ${timeNumber.format(elapsedSeconds % 60)}s`
    : `${timeNumber.format(elapsedSeconds)}s`

  useEffect(() => {
    completion.current?.focus({ preventScroll: true })
  }, [])

  return (
    <main className="results-screen" aria-labelledby="results-heading">
      <div className="results-content">
        <h1 id="results-heading" ref={completion} tabIndex={-1} className="result-heading">
          <HugeiconsIcon icon={passageCompleted ? CheckmarkCircle02Icon : Clock01Icon}
            size={19} strokeWidth={iconStroke} aria-hidden="true" />
          {passageCompleted ? 'Passage complete' : 'Time’s up'}
        </h1>
        <p className="result-topic">{topic}</p>
        <dl className="results-metrics">
          <div className="metric metric-emphasis" data-long-score={speed.length > 5}>
            <dt className="visually-hidden">Words per minute</dt>
            <dd>
              {decimal < 0 ? speed : <>{speed.slice(0, decimal)}<span className="score-decimal">{speed.slice(decimal)}</span></>}
              <small className="score-unit" aria-hidden="true">wpm</small>
            </dd>
          </div>
          <div className="metric">
            <dt>Accuracy</dt><dd>{scoreNumber.format(accuracy)}<small>%</small></dd>
          </div>
          <div className="metric"><dt>Raw speed</dt><dd>{scoreNumber.format(rawWpm)}<small> wpm</small></dd></div>
          <div className="metric"><dt>Time</dt><dd>{formattedElapsed}</dd></div>
        </dl>
        <SessionActions onRestart={onRestart} onNewTopic={onNewTopic} prominent />
      </div>
    </main>
  )
}

export function ErrorNotification({
  message,
  onRetry,
  onDismiss,
  onFreePassages,
  onSettings,
}: {
  message: string
  onRetry?: () => void
  onDismiss: () => void
  onFreePassages?: () => void
  onSettings?: () => void
}) {
  return (
    <div className="error-notification">
      <p role="alert">
        <HugeiconsIcon icon={AlertCircleIcon} size={17} strokeWidth={iconStroke} aria-hidden="true" />
        <span>{message}</span>
      </p>
      <button className="icon-button error-dismiss" type="button" onClick={onDismiss} aria-label="Dismiss error">
        <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={iconStroke} aria-hidden="true" />
      </button>
      <div className="error-actions">
        {onRetry && <button className="text-button error-retry" type="button" onClick={onRetry}>Try again</button>}
        {onFreePassages && (
          <button className="text-button error-action" type="button" onClick={onFreePassages}>
            Free passages
          </button>
        )}
        {onSettings && (
          <button className="text-button error-action" type="button" onClick={onSettings}>
            Settings
          </button>
        )}
      </div>
    </div>
  )
}

export function CapsLock({ active, concealed }: { active: boolean; concealed: boolean }) {
  return (
    <div className="caps-status" role="status" aria-hidden={concealed}>
      {active && (
        <div className="caps-indicator">
          <HugeiconsIcon icon={TextAllCapsIcon} size={17} strokeWidth={iconStroke} aria-hidden="true" />
          Caps lock is on
        </div>
      )}
    </div>
  )
}
