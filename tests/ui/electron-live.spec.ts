import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import path from 'node:path'

/**
 * Live check of the built app: real Electron, real engine, a COPY of a finished data folder.
 * Skipped unless LIVE=1. Build first (`npm run build`). LIVE_DATA picks the data folder
 * (default .claude/temp/ui-live-data), LIVE_EPISODE the finished episode id inside it.
 */
const DATA = path.resolve(process.env.LIVE_DATA ?? '.claude/temp/ui-live-data')
const EPISODE = process.env.LIVE_EPISODE ?? 'tock-loses-his-cap-on-a-windy-day'
const SHOTS = path.resolve('.claude/temp/ui-shots')

// the spec is type-checked without the DOM lib, so the page-side element shapes are spelled out
interface Img {
  complete: boolean
  naturalWidth: number
}
interface Vid {
  readyState: number
  duration: number
  currentTime: number
  addEventListener(type: string, fn: () => void, opts?: { once: boolean }): void
}

test.describe('live Electron app', () => {
  test.skip(process.env.LIVE !== '1', 'set LIVE=1 to run against the built app')
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(20 * 60_000)

  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    app = await electron.launch({ args: ['.'], cwd: path.resolve('.'), env: { ...process.env, TOYBOX_DATA: DATA } })
    page = await app.firstWindow()
    await page.setViewportSize({ width: 1600, height: 960 })
  })
  test.afterAll(async () => {
    await app?.close().catch(() => undefined)
  })

  const shot = (name: string) => page.screenshot({ path: path.join(SHOTS, `live-${name}.png`) })
  const openFinished = async () => {
    await page.locator(`[data-testid="episode-card"][data-episode="${EPISODE}"]`).click()
    await expect(page.getByTestId('episode-panel')).toHaveAttribute('data-episode', EPISODE)
  }

  test('snapshot arrives and the real episode is in the sidebar', async () => {
    await expect(page.getByTestId('connection')).toHaveClass(/ok/)
    await expect(page.locator(`[data-testid="episode-card"][data-episode="${EPISODE}"]`)).toBeVisible()
    await shot('studio')
  })

  test('Settings shows the detected tools and asks before resetting', async () => {
    await page.getByTestId('nav-settings').click()
    await expect(page.getByTestId('tools').locator('[data-tool]')).toHaveCount(3)
    await expect(page.locator('[data-tool="ffmpeg"]')).not.toHaveAttribute('data-ok', 'unknown', { timeout: 60_000 })
    await shot('settings')
    await page.getByTestId('reset-seed').click()
    await expect(page.getByTestId('reset-confirm')).toBeVisible()
    await page.getByTestId('reset-confirm').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('reset-seed')).toBeVisible()
  })

  test('Script and Shots tabs load the real files, thumbnails load', async () => {
    await openFinished()
    await page.getByTestId('tab-script').click()
    await expect(page.getByTestId('script-tab')).toBeVisible()
    await expect(page.getByTestId('beat-action').first()).toBeVisible()
    await shot('script')
    await page.getByTestId('tab-shots').click()
    await expect(page.getByTestId('shots-tab')).toBeVisible()
    await expect(page.getByTestId('shot-card').first()).toBeVisible()
    await expect(page.getByTestId('open-godot-shot').first()).toBeVisible()
    const thumbs = page.getByTestId('thumb')
    await expect(thumbs.first()).toBeVisible()
    await expect
      .poll(() => thumbs.evaluateAll((els) => els.filter((e) => (e as unknown as Img).complete && (e as unknown as Img).naturalWidth > 0).length))
      .toBeGreaterThan(0)
    expect(await thumbs.first().getAttribute('src')).toMatch(/^toybox-media:/)
    await shot('shots')
  })

  for (const [tab, id] of [
    ['animatic', 'animatic-video'],
    ['final', 'final-video']
  ] as const) {
    test(`${tab} video is playable through toybox-media:`, async () => {
      await openFinished()
      await page.getByTestId(`tab-${tab}`).click()
      const video = page.getByTestId(id)
      await expect(video).toBeVisible()
      expect(await video.getAttribute('src')).toMatch(/^toybox-media:/)
      await expect.poll(() => video.evaluate((v) => (v as unknown as Vid).readyState), { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
      // seeking needs Range requests: jump into the middle and wait for the seek to finish
      const seek = await video.evaluate(
        (v) =>
          new Promise<{ ok: boolean; duration: number; at: number }>((resolve) => {
            const el = v as unknown as Vid
            const target = Math.max(0.5, el.duration / 2)
            el.addEventListener('seeked', () => resolve({ ok: true, duration: el.duration, at: el.currentTime }), { once: true })
            el.addEventListener('error', () => resolve({ ok: false, duration: el.duration, at: el.currentTime }), { once: true })
            el.currentTime = target
          })
      )
      expect(seek.ok).toBe(true)
      expect(seek.duration).toBeGreaterThan(1)
      expect(seek.at).toBeGreaterThan(0.4)
      await expect.poll(() => video.evaluate((v) => (v as unknown as Vid).readyState)).toBeGreaterThanOrEqual(2)
      await shot(tab)
    })
  }

  test('the terminal shows the real log history', async () => {
    await openFinished()
    await page.getByTestId('episode-terminal').click()
    await expect(page.getByTestId('terminal')).toBeVisible()
    await expect(page.getByTestId('job-block').first()).toBeVisible({ timeout: 20_000 })
    expect(await page.getByTestId('job-block').count()).toBeGreaterThan(3)
    await shot('terminal')
    await page.getByTestId('terminal-close').click()
  })

  test('a new tiny episode starts on the live engine and waits for script approval', async () => {
    await page.getByTestId('new-episode').click()
    await expect(page.getByTestId('new-episode-dialog')).toBeVisible()
    // the cast and styles come from the data folder
    await expect(page.getByTestId('cast-tock')).toBeVisible()
    await expect(page.getByTestId('style-select').locator('option')).not.toHaveCount(0)
    await page.getByTestId('theme-input').fill('Tock finds a tiny red button')
    await page.getByTestId('length-input').fill('1')
    await expect(page.getByTestId('approve-script')).toBeChecked()
    await expect(page.getByTestId('approve-animatic')).toBeChecked()
    await shot('new-episode-dialog')
    const before = await page.getByTestId('episode-card').count()
    await page.getByTestId('start-episode').click()
    await expect(page.getByTestId('episode-card')).toHaveCount(before + 1)
    const card = page.locator(`[data-testid="episode-card"]:not([data-episode="${EPISODE}"])`).first()
    // the studio view: someone is working
    await expect(page.getByTestId('on-air')).toHaveClass(/on/, { timeout: 60_000 })
    await shot('studio-working')
    await page.getByTestId('nav-agents').click()
    await expect(page.locator('[data-testid="agent-row"]', { hasText: /working|reviewing|waiting/ }).first()).toBeVisible({ timeout: 60_000 })
    await shot('crew-working')
    await page.getByTestId('nav-studio').click()
    // the script is ready: the approval banner shows up
    await card.click()
    await expect(page.getByTestId('approval-banner')).toHaveAttribute('data-checkpoint', 'script', { timeout: 15 * 60_000 })
    await shot('approval-banner')
    // stop the crew; the engine goes away with the app
    await page.getByTestId('pause-all').click()
  })
})
