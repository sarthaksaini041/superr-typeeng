import { expect, test, type Page } from '@playwright/test'
import { starterPassage } from '../src/shared/starter'

async function startSample(page: Page, touch = false) {
  await page.evaluate(() => { Math.random = () => 0 })
  const button = page.getByRole('button', { name: 'Free passages' })
  if (touch) await button.tap()
  else await button.click()
  const dialog = page.getByRole('dialog', { name: 'Free passages' })
  await expect(dialog).toBeVisible()
  const randomButton = dialog.getByRole('button', { name: 'Random passage' })
  if (touch) await randomButton.tap()
  else await randomButton.click()
  await expect(page.getByRole('textbox', { name: 'Typing test input' })).toBeVisible()
}

async function chooseDuration(page: Page, seconds: number) {
  await page.getByRole('combobox', { name: 'Test duration' }).click()
  await page.getByRole('option', { name: `${seconds}s`, exact: true }).click()
}

test('setup supports dice, topic limits, and a persisted duration', async ({ page }) => {
  await page.goto('/')
  const topic = page.getByRole('textbox', { name: 'Passage topic' })
  const send = page.getByRole('button', { name: 'Generate passage' })
  const dice = page.getByRole('button', { name: 'Choose a random topic' })
  await expect(send).toBeDisabled()
  const duration = page.getByRole('combobox', { name: 'Test duration' })
  const progress = page.getByRole('meter', { name: 'Topic characters used' })
  await expect(duration).toHaveText('30s')
  await expect(progress).toHaveCount(0)
  await dice.click()
  const firstRoll = await topic.inputValue()
  expect(firstRoll).not.toBe('')
  await dice.click()
  await expect(topic).not.toHaveValue(firstRoll)
  await topic.fill('a'.repeat(205))
  await expect(topic).toHaveValue('a'.repeat(200))
  await expect(progress).toHaveAttribute('aria-valuenow', '200')
  await topic.blur()
  await expect(topic).toHaveCSS('text-overflow', 'ellipsis')
  await expect(topic).toHaveValue('a'.repeat(200))
  await topic.clear()
  await expect(progress).toHaveCount(0)

  await chooseDuration(page, 90)
  await page.reload()
  await expect(duration).toHaveText('90s')
})

test('generation can be cancelled, handles provider and quota errors, retries, restarts without another AI request, and generates a new topic with a different duration', async ({ page }) => {
  const requests: unknown[] = []
  let releaseFirst!: () => void
  const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve })
  await page.route('**/api/generate-passage', async route => {
    requests.push(route.request().postDataJSON())
    if (requests.length === 1) {
      await firstResponse
      await route.fulfill({
        json: {
          passage: starterPassage(30),
          model: '@cf/google/gemma-4-26b-a4b-it',
          wordCount: 105,
          characterCount: starterPassage(30).length,
        },
      }).catch(() => {})
    } else if (requests.length === 2) {
      await route.fulfill({ status: 502, json: { error: 'Could not generate a passage. Try again.' } })
    } else if (requests.length === 3) {
      await route.fulfill({
        status: 429,
        json: { error: 'The daily free AI quota has been reached. Try free passages or try again tomorrow.' },
      })
    } else if (requests.length === 4) {
      await route.fulfill({
        json: {
          passage: starterPassage(30),
          model: '@cf/google/gemma-4-26b-a4b-it',
          wordCount: 105,
          characterCount: starterPassage(30).length,
        },
      })
    } else {
      await route.fulfill({
        json: {
          passage: starterPassage(45),
          model: '@cf/google/gemma-4-26b-a4b-it',
          wordCount: 160,
          characterCount: starterPassage(45).length,
        },
      })
    }
  })

  await page.goto('/')
  const topic = page.getByRole('textbox', { name: 'Passage topic' })
  await topic.fill('  The old topic  ')
  await topic.press('Enter')
  await expect(page.getByText('Generating your passage.', { exact: true })).toBeAttached()
  await expect.poll(() => requests.length).toBe(1)
  await expect(topic).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(topic).toBeEditable()
  await topic.fill('  The new topic  ')
  await page.getByRole('button', { name: 'Generate passage' }).click()
  await expect(page.getByRole('alert')).toContainText('Could not generate a passage')
  releaseFirst()
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('alert')).toContainText('The daily free AI quota has been reached')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: 'The new topic' })).toBeVisible()
  await expect(page.getByRole('timer')).toContainText('0:30')
  await page.getByRole('button', { name: 'Restart' }).click()
  await expect(page.getByRole('heading', { name: 'The new topic' })).toBeVisible()
  expect(requests).toHaveLength(4)

  await page.getByRole('button', { name: 'New topic' }).click()
  await chooseDuration(page, 45)
  await topic.fill('Ocean currents')
  await topic.press('Enter')
  await expect(page.getByRole('heading', { name: 'Ocean currents' })).toBeVisible()
  await expect(page.getByRole('timer')).toContainText('0:45')
  expect(requests).toEqual([
    { topic: 'The old topic', duration: 30 },
    { topic: 'The new topic', duration: 30 },
    { topic: 'The new topic', duration: 30 },
    { topic: 'The new topic', duration: 30 },
    { topic: 'Ocean currents', duration: 45 },
  ])
})

test('the final incorrect insertion ends the test and restart clears it', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await startSample(page)
  const input = page.getByRole('textbox', { name: 'Typing test input' })
  await expect(input).toBeFocused()
  await page.clock.fastForward(35_000)
  await expect(page.getByRole('timer')).toContainText('0:30')

  const passage = starterPassage(30)
  await page.keyboard.type('x')
  await expect(page.locator('.typing-char--wrong')).toHaveCount(1)
  await page.keyboard.press('Backspace')
  await expect(page.locator('.typing-char--wrong')).toHaveCount(0)
  await page.clock.fastForward(2_000)
  await page.keyboard.insertText(passage.slice(0, -1) + 'x')
  await expect(page.getByRole('heading', { name: 'Passage complete' })).toBeVisible()
  const accuracy = ((passage.length - 1) / (passage.length + 1) * 100).toFixed(1)
  await expect(page.locator('.metric').filter({ hasText: /^Accuracy/ }).locator('dd')).toHaveText(`${accuracy}%`)
  await expect(page.getByText('Errors', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Uncorrected', { exact: true })).toHaveCount(0)
  const shownElapsed = await page.locator('.metric').filter({ hasText: /^Time/ }).locator('dd').innerText()
  expect(Number.parseFloat(shownElapsed)).toBeGreaterThanOrEqual(2)
  expect(Number.parseFloat(shownElapsed)).toBeLessThan(30)
  await expect(input).toHaveCount(0)

  await page.getByRole('button', { name: 'Restart' }).click()
  await expect(page.getByRole('timer')).toContainText('0:30')
  await page.clock.fastForward(30_000)
  await expect(page.getByRole('timer')).toContainText('0:30')
  await expect(page.locator('.typing-char--wrong')).toHaveCount(0)
  await page.getByRole('button', { name: 'New topic' }).click()
  await expect(page.getByRole('textbox', { name: 'Passage topic' })).toHaveValue('')
})

test('timeout preserves typed attempts and records the full duration', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await startSample(page)
  await page.keyboard.type(starterPassage(30).slice(0, 1))
  await page.clock.fastForward(1_000)
  await expect(page.getByRole('timer')).toContainText('0:29')
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.clock.fastForward(29_000)
  await expect(page.getByRole('heading', { name: 'Time’s up' })).toBeVisible()
  await expect(page.locator('.metric').filter({ hasText: /^Time/ }).locator('dd')).toHaveText('30.0s')
  await expect(page.locator('.metric').filter({ hasText: /^Accuracy/ }).locator('dd')).toHaveText('100%')
})

test('Caps Lock state is reflected while typing', async ({ page }) => {
  await page.goto('/')
  await startSample(page)
  const input = page.getByRole('textbox', { name: 'Typing test input' })
  await input.dispatchEvent('keydown', { key: 'CapsLock', modifierCapsLock: true })
  await expect(page.getByText('Caps lock is on')).toBeVisible()
  await input.dispatchEvent('keyup', { key: 'CapsLock', modifierCapsLock: false })
  await expect(page.getByText('Caps lock is on')).toHaveCount(0)
})

test('paste is blocked and an IME commit advances the cursor once', async ({ page }) => {
  await page.goto('/')
  await startSample(page)
  const input = page.getByRole('textbox', { name: 'Typing test input' })
  const firstCharacter = starterPassage(30).slice(0, 1)
  const pastePrevented = await input.evaluate(element => {
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    return !element.dispatchEvent(event)
  })
  expect(pastePrevented).toBe(true)
  await expect(page.locator('.typing-char--correct')).toHaveCount(0)

  await input.evaluate((element, character) => {
    const textarea = element as HTMLTextAreaElement
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    textarea.value += character
    textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'insertCompositionText', data: character, isComposing: true,
    }))
  }, firstCharacter)
  await expect(page.locator('.typing-char--correct')).toHaveCount(0)
  await input.evaluate((element, character) => {
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: character }))
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: character }))
  }, firstCharacter)
  await expect(page.locator('.typing-char--correct')).toHaveCount(1)
  await expect(page.locator('.typing-char--wrong')).toHaveCount(0)
  await page.keyboard.press('ArrowLeft')
  expect(await input.evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(1)
  await page.keyboard.type(starterPassage(30).slice(1, 2))
  await expect(page.locator('.typing-char--correct')).toHaveCount(2)
})

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test(`setup and typing fit a ${viewport.width}px viewport`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.getByRole('textbox', { name: 'Passage topic' })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Generate passage' })).toBeInViewport()
    await expect(page.getByRole('combobox', { name: 'Test duration' })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width)
    await startSample(page)
    await expect(page.getByRole('timer')).toBeInViewport()
    await expect(page.getByRole('textbox', { name: 'Typing test input' })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width)
  })
}

test.describe('touch interaction', () => {
  test.use({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true })

  test('tap focuses a long passage and scrolling keeps the active character visible', async ({ page }) => {
    await page.goto('/')
    await chooseDuration(page, 180)
    await startSample(page, true)
    const input = page.getByRole('textbox', { name: 'Typing test input' })
    const passage = starterPassage(180)
    const characters = page.locator('.typing-char')
    await expect(input).not.toBeFocused()
    expect(await characters.count()).toBeLessThan(passage.length / 3)
    await input.tap()
    await expect(input).toBeFocused()
    await expect(input).toHaveAttribute('autocapitalize', 'off')

    const before = await characters.count()
    await page.keyboard.insertText(passage.slice(0, 320))
    await expect(page.locator('.typing-char--correct')).toHaveCount(passage.slice(0, 320).replaceAll(' ', '').length)
    expect(await characters.count()).toBeGreaterThan(before)
    await expect(page.locator('[data-active]')).toBeInViewport()
    expect(await page.locator('.typing-viewport').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(393)

    for (let index = 320; index < passage.length; index += 240) {
      await page.keyboard.insertText(passage.slice(index, index + 240))
    }
    await expect(page.getByRole('heading', { name: 'Passage complete' })).toBeVisible()
    await expect(page.locator('.metric').filter({ hasText: /^Accuracy/ }).locator('dd')).toHaveText('100%')
  })
})

test('Space submits a word, extras stay attached, and Backspace reopens omissions', async ({ page }) => {
  await page.goto('/')
  await startSample(page)
  const active = page.locator('.typing-passage [data-active]')
  const caret = page.locator('.typing-caret')
  await expect(caret).toHaveAttribute('data-positioned', 'true')
  const start = await caret.evaluate(element => element.style.transform)
  await page.keyboard.type('Be')
  await expect.poll(() => caret.evaluate(element => element.style.transform)).not.toBe(start)
  await page.keyboard.press('Space')
  await expect(page.locator('.typing-char--missed')).toHaveCount(4)
  await expect(active).toHaveText('d')
  await page.keyboard.press('Space')
  await expect(active).toHaveText('d')
  await page.keyboard.press('Backspace')
  await expect(active).toHaveText('f')
  await expect(page.locator('.typing-char--missed')).toHaveCount(0)
  await page.keyboard.type('forexy')
  await expect(page.locator('.typing-word').first()).toHaveText('Before')
  await expect(active).toHaveText('\u200b')
  await page.keyboard.press('Backspace')
  await expect(active).toHaveText('\u200b')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await expect(active).toHaveText('e')
  await page.keyboard.type('ez')
  await expect(page.locator('.typing-word').first()).toHaveText('Before')
  await page.keyboard.press('Space')
  await expect(active).toHaveText('d')

  await page.setViewportSize({ width: 390, height: 740 })
  await expect(active).toBeInViewport()
  await expect.poll(() => caret.evaluate(element => {
    const target = document.querySelector('.typing-passage [data-active]')!.getBoundingClientRect()
    return Math.abs(element.getBoundingClientRect().left - target.left)
  })).toBeLessThan(2)

  await page.evaluate(async () => {
    const face = new FontFace('Typing test fallback', 'local("DejaVu Sans Mono")')
    document.fonts.add(face)
    const viewport = document.querySelector<HTMLElement>('.typing-viewport')!
    viewport.style.fontFamily = '"Typing test fallback", monospace'
    await document.fonts.ready
  })
  await expect.poll(() => caret.evaluate(element => {
    const target = document.querySelector('.typing-passage [data-active]')!.getBoundingClientRect()
    return Math.abs(element.getBoundingClientRect().left - target.left)
  })).toBeLessThan(2)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.keyboard.type('d')
  await expect(active).toHaveText('a')
  await expect(caret).toHaveCSS('transition-duration', '0s')
})

test('duration menu stays beside the topic field and retains selection on resize', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/')
  const duration = page.getByRole('combobox', { name: 'Test duration' })
  await duration.press('Enter')
  await expect(page.getByRole('option')).toHaveCount(6)
  await duration.press('End')
  await duration.press('Enter')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Passage topic' }).fill('Station clocks')
  const field = await page.locator('.topic-field').boundingBox()
  const menu = await duration.boundingBox()
  expect(menu!.x).toBeGreaterThan(field!.x + field!.width)
  expect(menu!.y).toBe(field!.y)
  expect(menu!.height).toBe(field!.height)
  await page.setViewportSize({ width: 1024, height: 768 })
  await expect(duration).toHaveText('180s')
  await duration.press('ArrowDown')
  await duration.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
})

test('repeated mistakes stay on the baseline and extras stay outside the passage', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const width of [390, 1024]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    await startSample(page)
    await page.getByRole('textbox', { name: 'Typing test input' }).focus()
    const wordLayout = () => page.locator('.typing-word').evaluateAll(words =>
      words.slice(0, 12).map(word => {
        const { x, y, width, height } = word.getBoundingClientRect()
        return [word.textContent?.replaceAll('\u200b', ''), x, y, width, height]
      }))
    const before = await wordLayout()
    await page.keyboard.insertText('Before dawn, bhe eeeeeeeeee eeee ee ee e')
    const thirdWord = page.locator('.typing-word').nth(2)
    await expect(thirdWord).toHaveText('the')
    await expect(thirdWord.locator('.typing-char--wrong')).toHaveText(['t'])
    await expect(thirdWord.locator('.typing-char--correct')).toHaveText(['h', 'e'])
    await expect(page.locator('.typing-word').nth(3)).toHaveText('station')
    await expect(page.locator('.typing-char--wrong').first()).toHaveCSS('text-decoration-line', 'none')
    await expect(page.locator('.typing-char--missed').first()).toHaveCSS('text-decoration-line', 'none')
    expect(await wordLayout()).toEqual(before)

    await page.keyboard.insertText('eeeeeeeeeeeeee')
    expect(await wordLayout()).toEqual(before)
    await page.keyboard.press('Space')
    expect(await wordLayout()).toEqual(before)
  }
})

test('typing hides surrounding controls without shifting the passage or timer', async ({ page }) => {
  await page.goto('/')
  await startSample(page)
  const timer = page.getByRole('timer')
  const passage = page.locator('.typing-viewport')
  const topic = page.locator('.session-topic')
  const actions = page.locator('.session-actions')
  await expect(topic).toBeVisible()
  await expect(actions).toBeVisible()
  const passagePosition = await passage.boundingBox()
  const timerPosition = await timer.boundingBox()

  await page.keyboard.type('B')
  await expect(topic).toHaveCSS('opacity', '0')
  await expect(actions).toBeHidden()
  await expect(page.locator('.typing-feedback')).toBeHidden()
  await expect(page.getByText('superr-typeeng')).toBeVisible()
  await expect(timer).toBeVisible()
  await expect(passage).toBeVisible()
  expect(await passage.boundingBox()).toEqual(passagePosition)
  expect(await timer.boundingBox()).toEqual(timerPosition)
})

test('line scrolling glides through intermediate positions and respects reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion })
    await page.goto('/')
    await startSample(page)
    const result = await page.locator('.typing-viewport').evaluate(async (viewport, sample) => {
      const words = Array.from(viewport.querySelectorAll('.typing-word'))
      const lineHeight = parseFloat(getComputedStyle(viewport).lineHeight)
      const top = words[0].getBoundingClientRect().top
      const thirdLine = words.findIndex(word => word.getBoundingClientRect().top >= top + 1.9 * lineHeight)
      const prefix = sample.split(' ').slice(0, thirdLine).join(' ') + ' '
      const input = viewport.parentElement!.querySelector('textarea')!
      input.value += prefix
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      const offsets: number[] = []
      for (let index = 0; index < 30; index++) {
        await new Promise(requestAnimationFrame)
        offsets.push(viewport.scrollTop)
      }
      return offsets
    }, starterPassage(30))
    const final = result.at(-1)!
    expect(final).toBeGreaterThan(0)
    expect(result.some(offset => offset > 0 && offset < final)).toBe(reducedMotion === 'no-preference')
    await expect(page.locator('.typing-passage [data-active]')).toBeInViewport()
  }
})

test('daily 5-generation quota updates dynamically, blocks exhausted requests, and restart consumes no quota', async ({ page }) => {
  let quotaRemaining = 5
  const generateRequests: unknown[] = []

  await page.route('**/api/quota', async route => {
    await route.fulfill({
      json: {
        limit: 5,
        used: 5 - quotaRemaining,
        remaining: quotaRemaining,
        resetsAt: '2026-11-04T18:30:00.000Z',
        timeZone: 'Asia/Kolkata',
      },
    })
  })

  await page.route('**/api/generate-passage', async route => {
    generateRequests.push(route.request().postDataJSON())
    if (generateRequests.length === 1) {
      quotaRemaining = 3
      await route.fulfill({
        json: {
          passage: starterPassage(30),
          model: '@cf/google/gemma-4-26b-a4b-it',
          provider: 'shared',
          wordCount: 105,
          characterCount: starterPassage(30).length,
          quota: {
            limit: 5,
            used: 2,
            remaining: 3,
            resetsAt: '2026-11-04T18:30:00.000Z',
          },
        },
      })
    } else {
      quotaRemaining = 0
      await route.fulfill({
        json: {
          passage: starterPassage(30),
          model: '@cf/google/gemma-4-26b-a4b-it',
          provider: 'shared',
          wordCount: 105,
          characterCount: starterPassage(30).length,
          quota: {
            limit: 5,
            used: 5,
            remaining: 0,
            resetsAt: '2026-11-04T18:30:00.000Z',
          },
        },
      })
    }
  })

  await page.goto('/')
  await expect(page.getByText('5 free generations remaining today')).toBeVisible()

  await page.getByRole('button', { name: 'Settings' }).click()
  const settingsDialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(settingsDialog).toContainText(
    'Get 5 free AI generations every day. Use free passages anytime, or connect your own API key for more.',
  )
  await expect(settingsDialog.locator('.settings-quota-badge')).toHaveText('5 free generations remaining today')
  await settingsDialog.getByRole('button', { name: 'Close settings' }).click()

  const topic = page.getByRole('textbox', { name: 'Passage topic' })
  await topic.fill('Deep sea trenches')
  await topic.press('Enter')
  await expect(page.getByRole('heading', { name: 'Deep sea trenches' })).toBeVisible()
  expect(generateRequests).toHaveLength(1)

  // Restarting a passage consumes no quota and makes no AI request.
  await page.getByRole('button', { name: 'Restart' }).click()
  await expect(page.getByRole('heading', { name: 'Deep sea trenches' })).toBeVisible()
  expect(generateRequests).toHaveLength(1)

  await page.getByRole('button', { name: 'New topic' }).click()
  await expect(page.getByText('3 free generations remaining today')).toBeVisible()

  await topic.fill('Alpine glaciers')
  await topic.press('Enter')
  await expect(page.getByRole('heading', { name: 'Alpine glaciers' })).toBeVisible()
  expect(generateRequests).toHaveLength(2)

  await page.getByRole('button', { name: 'New topic' }).click()
  await expect(page.getByText("You've used your 5 free generations for today.")).toBeVisible()

  // Attempting to generate when 0 remaining prevents further shared AI requests and offers Free passages + Settings.
  await topic.fill('Desert mirages')
  await topic.press('Enter')
  expect(generateRequests).toHaveLength(2)

  const errorBanner = page.locator('.error-notification')
  await expect(errorBanner.getByRole('alert')).toContainText("You've used your 5 free generations for today.")
  await expect(errorBanner.getByRole('button', { name: 'Free passages' })).toBeVisible()
  await expect(errorBanner.getByRole('button', { name: 'Settings' })).toBeVisible()
})

test('multi-provider BYOK settings stay in memory only, validate keys, mask saved keys, and bypass shared quota', async ({ page }) => {
  const requests: { authorization: string | undefined; body: unknown }[] = []
  await page.route('**/api/generate-passage', async route => {
    requests.push({
      authorization: (await route.request().allHeaders()).authorization,
      body: route.request().postDataJSON(),
    })
    await route.fulfill({
      json: {
        passage: starterPassage(30),
        model: 'gemini-2.5-flash',
        provider: 'google',
        wordCount: 105,
        characterCount: starterPassage(30).length,
        quota: {
          limit: 5,
          used: 0,
          remaining: 5,
          resetsAt: '2026-11-04T18:30:00.000Z',
        },
      },
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  const providerCombobox = dialog.getByRole('combobox', { name: 'AI provider' })
  const modelReveal = dialog.locator('.settings-model-reveal')
  const modelCombobox = dialog.getByRole('combobox', { name: 'Model' })

  // Model selector is hidden before a valid API key is entered
  await expect(modelReveal).toHaveAttribute('data-verified', 'false')

  const expectedProviders = [
    {
      id: 'google',
      name: 'Google Gemini',
      defaultModel: 'gemini-2.5-flash',
      defaultModelLabel: 'Gemini 2.5 Flash',
      placeholder: 'AIza…',
      keyUrl: 'https://aistudio.google.com/apikey',
      requiresAccount: false,
    },
    {
      id: 'openai',
      name: 'OpenAI',
      defaultModel: 'gpt-4o-mini',
      defaultModelLabel: 'GPT-4o mini',
      placeholder: 'sk-…',
      keyUrl: 'https://platform.openai.com/api-keys',
      requiresAccount: false,
    },
    {
      id: 'anthropic',
      name: 'Anthropic Claude',
      defaultModel: 'claude-3-5-haiku-latest',
      defaultModelLabel: 'Claude 3.5 Haiku',
      placeholder: 'sk-ant-…',
      keyUrl: 'https://console.anthropic.com/settings/keys',
      requiresAccount: false,
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      defaultModel: 'google/gemma-3-27b-it',
      defaultModelLabel: 'Gemma 3 27B IT',
      placeholder: 'sk-or-v1-…',
      keyUrl: 'https://openrouter.ai/keys',
      requiresAccount: false,
    },
    {
      id: 'groq',
      name: 'Groq',
      defaultModel: 'llama-3.3-70b-versatile',
      defaultModelLabel: 'Llama 3.3 70B Versatile',
      placeholder: 'gsk_…',
      keyUrl: 'https://console.groq.com/keys',
      requiresAccount: false,
    },
    {
      id: 'mistral',
      name: 'Mistral AI',
      defaultModel: 'mistral-small-latest',
      defaultModelLabel: 'Mistral Small',
      placeholder: 'mistral-…',
      keyUrl: 'https://console.mistral.ai/api-keys',
      requiresAccount: false,
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      defaultModel: 'deepseek-chat',
      defaultModelLabel: 'DeepSeek V3 (Chat)',
      placeholder: 'sk-…',
      keyUrl: 'https://platform.deepseek.com/api_keys',
      requiresAccount: false,
    },
    {
      id: 'together',
      name: 'Together AI',
      defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      defaultModelLabel: 'Llama 3.3 70B Turbo',
      placeholder: 'tgp_v1_…',
      keyUrl: 'https://api.together.ai/settings/api-keys',
      requiresAccount: false,
    },
    {
      id: 'fireworks',
      name: 'Fireworks AI',
      defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
      defaultModelLabel: 'Llama 3.3 70B Instruct',
      placeholder: 'fw_…',
      keyUrl: 'https://fireworks.ai/account/api-keys',
      requiresAccount: false,
    },
    {
      id: 'cloudflare',
      name: 'Cloudflare Workers AI',
      defaultModel: '@cf/google/gemma-4-26b-a4b-it',
      defaultModelLabel: 'Gemma 4 26B A4B Instruct',
      placeholder: 'cfut_…',
      keyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
      requiresAccount: true,
    },
  ]

  for (const spec of expectedProviders) {
    await providerCombobox.click()
    await dialog.getByRole('option', { name: spec.name, exact: true }).click()
    await expect(providerCombobox).toHaveAttribute('data-value', spec.id)
    await expect(providerCombobox).toHaveText(spec.name)
    await expect(modelReveal).toHaveAttribute('data-verified', 'false')
    const keyInput = dialog.getByLabel(`${spec.name} API key`)
    await expect(keyInput).toHaveAttribute('placeholder', spec.placeholder)
    const keyLink = dialog.getByRole('link', { name: `Get ${spec.name} API key` })
    await expect(keyLink).toHaveAttribute('href', spec.keyUrl)
    if (spec.requiresAccount) {
      await expect(dialog.getByLabel('Cloudflare Account ID')).toBeVisible()
    } else {
      await expect(dialog.getByLabel('Cloudflare Account ID')).toHaveCount(0)
    }
  }

  // Validate Cloudflare Account ID requirement before saving (Model stays hidden until Account ID is also valid)
  await dialog.getByLabel('Cloudflare Workers AI API key').fill('cfut_valid_cloudflare_token_12345')
  await dialog.getByLabel('Cloudflare Account ID').fill('short')
  await expect(modelReveal).toHaveAttribute('data-verified', 'false')
  await dialog.getByRole('button', { name: 'Save key' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Enter a valid Cloudflare Account ID.')

  // Switch to Google Gemini and test password show/hide toggle + key validation
  await providerCombobox.click()
  await dialog.getByRole('option', { name: 'Google Gemini', exact: true }).click()
  await expect(dialog.getByLabel('Cloudflare Account ID')).toHaveCount(0)
  const geminiKeyInput = dialog.getByLabel('Google Gemini API key')
  await expect(geminiKeyInput).toHaveAttribute('type', 'password')
  await dialog.getByRole('button', { name: 'Show API key' }).click()
  await expect(geminiKeyInput).toHaveAttribute('type', 'text')
  await dialog.getByRole('button', { name: 'Hide API key' }).click()
  await expect(geminiKeyInput).toHaveAttribute('type', 'password')

  // Reject empty or malformed API keys and keep Model hidden
  await dialog.getByRole('button', { name: 'Save key' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Enter a valid Google Gemini API key.')
  await geminiKeyInput.fill('invalid-gemini-key')
  await expect(modelReveal).toHaveAttribute('data-verified', 'false')
  await dialog.getByRole('button', { name: 'Save key' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Enter a valid Google Gemini API key.')

  // Entering a valid Google Gemini key smoothly reveals the Model dropdown
  const validGeminiKey = 'AIzaSyTestBrowserMemoryOnlyKey12345'
  await geminiKeyInput.fill(validGeminiKey)
  await expect(modelReveal).toHaveAttribute('data-verified', 'true')
  await expect(modelCombobox).toBeVisible()
  await expect(modelCombobox).toHaveAttribute('data-value', 'gemini-2.5-flash')
  await modelCombobox.click()
  await dialog.getByRole('option', { name: 'Gemini 2.5 Pro', exact: true }).click()
  await expect(modelCombobox).toHaveAttribute('data-value', 'gemini-2.5-pro')
  await modelCombobox.click()
  await dialog.getByRole('option', { name: 'Gemini 2.5 Flash', exact: true }).click()
  await expect(modelCombobox).toHaveAttribute('data-value', 'gemini-2.5-flash')
  await dialog.getByRole('button', { name: 'Save key' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Connected · Google Gemini (Gemini 2.5 Flash)')).toBeVisible()

  // Verify localStorage and sessionStorage have zero keys stored
  const storageKeys = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }))
  expect(storageKeys.local.filter(key => key !== 'superr-typeeng.duration')).toEqual([])
  expect(storageKeys.session).toEqual([])

  // Reopen Settings and confirm key is masked and never shown in full
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(dialog.getByLabel('Google Gemini API key')).toHaveValue('')
  await expect(dialog.getByLabel('Google Gemini API key')).toHaveAttribute(
    'placeholder',
    'Key configured (AIza••••)',
  )
  await expect(dialog.locator('#settings-connection-status')).toHaveText(
    'Connected · Google Gemini (Gemini 2.5 Flash) · AIza••••',
  )
  await expect(dialog.getByRole('button', { name: 'Remove key' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close settings' }).click()

  // Generate passage using BYOK configuration without consuming shared quota
  const topic = page.getByRole('textbox', { name: 'Passage topic' })
  await topic.fill('Harbor life')
  await topic.press('Enter')
  await expect(page.getByRole('heading', { name: 'Harbor life' })).toBeVisible()
  expect(requests).toEqual([
    {
      authorization: undefined,
      body: {
        topic: 'Harbor life',
        duration: 30,
        provider: {
          id: 'google',
          apiKey: validGeminiKey,
          model: 'gemini-2.5-flash',
        },
      },
    },
  ])

  // Remove key clears BYOK back to shared quota mode
  await page.getByRole('button', { name: 'New topic' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await dialog.getByRole('button', { name: 'Remove key' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('5 free generations remaining today')).toBeVisible()

  await topic.fill('Woodland')
  await topic.press('Enter')
  await expect(page.getByRole('heading', { name: 'Woodland' })).toBeVisible()
  expect(requests[1]).toEqual({
    authorization: undefined,
    body: { topic: 'Woodland', duration: 30 },
  })
})

test('free passages dialog filters by category and duration, selects passages offline, and works when quota is exhausted', async ({ page }) => {
  const requests: string[] = []
  await page.route('**/api/*passage', route => {
    requests.push(route.request().url())
    return route.abort()
  })
  await page.route('**/api/quota', async route => {
    await route.fulfill({
      json: {
        limit: 5,
        used: 5,
        remaining: 0,
        resetsAt: '2026-11-04T18:30:00.000Z',
        timeZone: 'Asia/Kolkata',
      },
    })
  })

  await page.goto('/')
  await expect(page.getByText("You've used your 5 free generations for today.")).toBeVisible()

  await page.getByRole('button', { name: 'Free passages' }).click()
  const dialog = page.getByRole('dialog', { name: 'Free passages' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.passages-subtitle')).toHaveCount(0)

  const categoryGroup = dialog.getByRole('group', { name: 'Category' })
  const durationGroup = dialog.getByRole('group', { name: 'Test duration' })
  const cards = dialog.locator('.passage-card')
  await expect(cards).toHaveCount(100)
  await expect(cards.nth(1).locator('.passage-card-title')).toHaveText('Down the Rabbit Hole')
  await expect(cards.nth(1).locator('.passage-card-source')).toHaveText("Alice's Adventures in Wonderland")
  await expect(cards.nth(1).locator('.passage-card-meta')).not.toContainText('words')
  await expect(cards.nth(1)).not.toContainText('Excerpt')

  // Filter by Science Fiction category
  await categoryGroup.getByRole('button', { name: 'Science Fiction' }).click()
  const sciFiCount = await cards.count()
  expect(sciFiCount).toBeGreaterThan(0)
  expect(sciFiCount).toBeLessThan(100)
  await expect(cards.first().locator('.passage-card-badge')).toHaveText('Science Fiction')
  await expect(cards.first().locator('.passage-card-title')).toHaveText('The Fourth Dimension Explained')
  await expect(cards.first().locator('.passage-card-source')).toHaveText('The Time Machine')

  // Filter by Classic Fiction category and 90s duration
  await categoryGroup.getByRole('button', { name: 'Classic Fiction' }).click()
  await durationGroup.getByRole('button', { name: '90s', exact: true }).click()
  await expect(cards.first().locator('.passage-card-badge')).toHaveText('Classic Fiction')
  await expect(cards.first().locator('.passage-card-duration')).toHaveText('90s')
  await expect(cards.first().locator('.passage-card-meta')).not.toContainText('words')

  // Selecting a passage from the list starts the typing test immediately with that topic & duration
  await cards.first().click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('timer')).toContainText('1:30')
  await expect(page.getByRole('textbox', { name: 'Typing test input' })).toBeVisible()
  const firstHeading = await page.getByRole('heading', { level: 1 }).innerText()
  expect(firstHeading.length).toBeGreaterThan(0)

  // Return to setup and test Random passage with a different duration
  await page.getByRole('button', { name: 'New topic' }).click()
  await chooseDuration(page, 180)
  await startSample(page)
  await expect(page.getByRole('timer')).toContainText('3:00')
  expect(requests).toHaveLength(0)
})

test('every passage line starts flush left at any viewport width', async ({ page }) => {
  await page.goto('/')
  await chooseDuration(page, 180)
  await startSample(page)
  for (let width = 320; width <= 1920; width += 7) {
    await page.setViewportSize({ width, height: 900 })
    const lineStarts = await page.locator('.typing-word').evaluateAll(words => {
      const starts = new Map<number, number>()
      for (const word of words) {
        const { top, left } = word.getBoundingClientRect()
        const line = Math.round(top)
        starts.set(line, Math.min(starts.get(line) ?? Infinity, left))
      }
      return [...starts.values()]
    })
    expect(lineStarts.length, `${width}px renders several lines`).toBeGreaterThan(1)
    for (const left of lineStarts) expect(left, `${width}px line start`).toBeCloseTo(lineStarts[0], 0)
  }
})

const crampedViewports = [
  { width: 1440, height: 900 }, { width: 1366, height: 600 }, { width: 1280, height: 520 },
  { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 },
  { width: 667, height: 375 }, { width: 568, height: 320 }, { width: 480, height: 240 },
]

async function expectInsideViewport(page: Page, selector: string, label: string) {
  const viewport = page.viewportSize()!
  const box = (await page.locator(selector).boundingBox())!
  expect(box.x, `${label} left`).toBeGreaterThanOrEqual(0)
  expect(box.y, `${label} top`).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width, `${label} right`).toBeLessThanOrEqual(viewport.width)
  expect(box.y + box.height, `${label} bottom`).toBeLessThanOrEqual(viewport.height)
}

test('duration menu flips or scrolls to stay on screen and keeps every option reachable', async ({ page }) => {
  for (const size of crampedViewports) {
    const label = `${size.width}x${size.height}`
    await page.setViewportSize(size)
    await page.goto('/')
    const duration = page.getByRole('combobox', { name: 'Test duration' })
    await duration.click()
    await expect(page.getByRole('option')).toHaveCount(6)
    await expect(page.locator('.duration-options')).toHaveCSS('opacity', '1')
    await expectInsideViewport(page, '.duration-options', `${label} menu`)
    await duration.press('End')
    await expect(page.getByRole('option', { name: '180s' })).toBeInViewport({ ratio: 1 })
    await duration.press('Enter')
    await expect(duration).toHaveText('180s')
    await page.evaluate(() => localStorage.clear())
  }
})

test('settings and free passages dialogs stay on screen with a saved key and an error message', async ({ page }) => {
  for (const size of crampedViewports) {
    const label = `${size.width}x${size.height}`
    await page.setViewportSize(size)
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByLabel('OpenAI API key').fill('sk-test-browser-only-example')
    await dialog.getByRole('button', { name: 'Save key' }).click()
    await expect(dialog).toHaveCount(0)

    await page.getByRole('button', { name: 'Settings' }).click()
    await dialog.getByLabel('OpenAI API key').fill('not-a-key')
    await dialog.getByRole('button', { name: 'Save key' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Enter a valid OpenAI API key.')
    await expectInsideViewport(page, '.settings-dialog', `${label} settings dialog`)
    await dialog.getByRole('button', { name: 'Remove key' }).click()
    await expect(dialog).toHaveCount(0)

    await page.getByRole('button', { name: 'Free passages' }).click()
    const passagesDialog = page.getByRole('dialog', { name: 'Free passages' })
    await expect(passagesDialog).toBeVisible()
    await expectInsideViewport(page, '.passages-dialog', `${label} passages dialog`)
    await passagesDialog.getByRole('button', { name: 'Close free passages' }).click()
    await expect(passagesDialog).toHaveCount(0)
  }
})

test('typing while the passage is unfocused captures the first keystroke immediately', async ({ page }) => {
  await page.goto('/')
  await startSample(page)
  const input = page.getByRole('textbox', { name: 'Typing test input' })
  await input.evaluate(element => (element as HTMLTextAreaElement).blur())
  await expect(input).not.toBeFocused()
  await expect(page.getByText('Click the passage to focus')).toHaveCount(0)

  const passage = starterPassage(30)
  await page.keyboard.type(passage.slice(0, 5))
  await expect(input).toBeFocused()
  await expect(page.locator('.typing-char--correct')).toHaveCount(passage.slice(0, 5).replaceAll(' ', '').length)

  await input.evaluate(element => (element as HTMLTextAreaElement).blur())
  await page.keyboard.press('Backspace')
  await expect(input).toBeFocused()
  await expect(page.locator('.typing-char--correct')).toHaveCount(passage.slice(0, 4).replaceAll(' ', '').length)
})
