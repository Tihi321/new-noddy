import { expect, test } from '@playwright/test'
import { FINISHED, WAITING, openDemo, openEpisode, studioInfo } from './helpers'

test.describe('Toybox Studio UI (demo engine)', () => {
  test('demo loads with the crew and two episodes', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await openDemo(page)
    await expect(page.getByTestId('connection')).toContainText('demo engine')
    await expect(page.locator('.brand-name')).toHaveText('Toybox Studio')
    await expect(page.getByTestId('episode-card')).toHaveCount(2)
    expect(errors).toEqual([])
  })

  test('studio canvas draws the rooms and the whole crew', async ({ page }) => {
    await openDemo(page)
    const canvas = page.getByTestId('studio-canvas').locator('canvas')
    await expect(canvas).toBeVisible()
    await expect.poll(async () => (await studioInfo(page))?.sprites).toBe(16)
    const info = await studioInfo(page)
    expect(info.rooms).toEqual(['writers_room', 'art_dept', 'stage', 'sound_booth', 'workshop', 'render_farm', 'edit_suite'])
    // the canvas is not blank: a plain one compresses to a few hundred bytes
    const png = await canvas.screenshot()
    expect(png.length).toBeGreaterThan(30_000)
  })

  test('clicking a crew member opens its panel with the model picker', async ({ page }) => {
    await openDemo(page)
    await expect.poll(async () => (await studioInfo(page))?.sprites).toBe(16)
    const info = await studioInfo(page)
    const box = (await page.getByTestId('studio-canvas').locator('canvas').boundingBox())!
    const p = info.positions['director-ludo-longshot']!
    await page.mouse.click(box.x + (p.x * box.width) / 1280, box.y + (p.y * box.height) / 720)
    await expect(page.getByTestId('agent-drawer')).toContainText('Ludo Longshot')
    await expect(page.getByTestId('model-picker')).toBeVisible()
    await page.getByTestId('model-picker').selectOption('anthropic/claude-sonnet-5-5')
    await expect(page.getByTestId('agent-drawer')).toContainText('claude-sonnet-5-5')
    await page.getByTestId('pause-agent').click()
    await expect(page.getByTestId('agent-drawer')).toContainText('paused')
  })

  test('New Episode dialog submits and the crew starts', async ({ page }) => {
    await openDemo(page)
    await page.getByTestId('new-episode').click()
    await expect(page.getByTestId('new-episode-dialog')).toBeVisible()
    await expect(page.getByTestId('start-episode')).toBeDisabled()
    await page.getByTestId('theme-chip').first().click()
    await expect(page.getByTestId('theme-input')).toHaveValue('A windy day')
    await page.getByTestId('theme-input').fill('A lost red balloon')
    await page.getByTestId('type-mystery').click()
    await page.getByTestId('cast-moo_moo').click()
    await page.getByTestId('cast-tock').click()
    await page.getByTestId('length-input').fill('4')
    await page.getByTestId('start-episode').click()
    await expect(page.getByTestId('new-episode-dialog')).toBeHidden()
    await expect(page.getByTestId('episode-card')).toHaveCount(3)
    await expect(page.getByTestId('episode-card').first()).toContainText('Moo Moo')
    await expect(page.getByTestId('on-air')).toHaveClass(/on/)
  })

  test('episode tabs render their content', async ({ page }) => {
    await openDemo(page)
    await openEpisode(page, FINISHED)
    const stepper = page.getByTestId('episode-panel').getByTestId('stepper')
    await expect(stepper).toBeVisible()
    await expect(stepper.locator('[data-state="done"]')).not.toHaveCount(0)

    await expect(page.getByTestId('brief-tab')).toContainText('Tock and the Windy Day')

    await page.getByTestId('tab-script').click()
    await expect(page.getByTestId('script-tab')).toBeVisible()
    await expect(page.getByTestId('scene')).toHaveCount(4)
    await expect(page.getByTestId('mumble').first()).toContainText('🗨')
    await expect(page.getByTestId('subtitle').first()).toContainText('Good morning')
    await expect(page.getByTestId('emotion').first()).toBeVisible()

    await page.getByTestId('tab-shots').click()
    await expect(page.getByTestId('shot-card')).toHaveCount(18)
    await expect(page.getByTestId('thumb').first()).toBeVisible()
    await expect.poll(() => page.getByTestId('thumb').first().evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(0)

    await page.getByTestId('tab-animatic').click()
    await expect(page.getByTestId('animatic-tab')).toBeVisible()

    await page.getByTestId('tab-render').click()
    await expect(page.getByTestId('render-tab')).toBeVisible()
    await expect(page.getByTestId('render-row')).toHaveCount(18)
    await expect(page.getByTestId('render-eta')).toContainText('finished')

    await page.getByTestId('tab-final').click()
    await expect(page.getByTestId('final-tab')).toBeVisible()
    await expect(page.getByTestId('open-folder')).toBeVisible()
  })

  test('approving the animatic moves the episode on to the render and the final cut', async ({ page }) => {
    await openDemo(page)
    await openEpisode(page, WAITING)
    const banner = page.getByTestId('approval-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toHaveAttribute('data-checkpoint', 'animatic')
    await expect(page.getByTestId('tabbody-animatic')).toBeVisible()
    await page.getByTestId('approve').click()
    await expect(banner).toBeHidden()
    await page.getByTestId('tab-render').click()
    await expect(page.getByTestId('render-tab')).toBeVisible()
    await expect(page.getByTestId('render-row').first()).toBeVisible()
    // the render farm reports progress, then the episode finishes
    await expect(page.getByTestId('episode-status')).toHaveText('done', { timeout: 45_000 })
    await page.getByTestId('tab-final').click()
    await expect(page.getByTestId('final-tab')).toBeVisible()
  })

  test('script approval with a change request, then approve, through to done', async ({ page }) => {
    test.setTimeout(120_000)
    await openDemo(page, 20)
    await page.getByTestId('new-episode').click()
    await page.getByTestId('theme-input').fill('Granny bakes a cake')
    await page.getByTestId('start-episode').click()
    await expect(page.getByTestId('episode-card')).toHaveCount(3)
    await page.locator('[data-testid="episode-card"]').first().click()
    const banner = page.getByTestId('approval-banner')
    await expect(banner).toHaveAttribute('data-checkpoint', 'script', { timeout: 40_000 })
    await expect(page.getByTestId('script-tab')).toBeVisible()
    await page.getByTestId('request-changes').click()
    await expect(page.getByTestId('send-changes')).toBeDisabled()
    await page.getByTestId('changes-note').fill('Please add a scene at the bakery with a cake.')
    await page.getByTestId('send-changes').click()
    // the crew rewrites, then asks again
    await expect(banner).toBeHidden()
    await expect(banner).toHaveAttribute('data-checkpoint', 'script', { timeout: 40_000 })
    await page.getByTestId('approve').click()
    await expect(banner).toHaveAttribute('data-checkpoint', 'animatic', { timeout: 60_000 })
    await page.getByTestId('approve').click()
    await expect(page.getByTestId('episode-status')).toHaveText('done', { timeout: 60_000 })
  })

  test('terminal streams a live job, the crew table and settings render', async ({ page }) => {
    await openDemo(page, 4)
    await page.getByTestId('new-episode').click()
    await page.getByTestId('theme-input').fill('Rainy day puddles')
    await page.getByTestId('start-episode').click()
    await page.getByTestId('toggle-terminal').click()
    await expect(page.getByTestId('terminal')).toBeVisible()
    await page.getByTestId('terminal-agent').selectOption('producer-penny-pennywhistle')
    await expect(page.getByTestId('job-block').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('terminal-log')).toContainText('title', { timeout: 15_000 })
    await page.getByTestId('nav-agents').click()
    await expect(page.getByTestId('agent-row')).toHaveCount(16)
    await expect(page.getByTestId('agents-panel').getByTestId('model-picker').first()).toBeVisible()
    await page.getByTestId('nav-settings').click()
    await expect(page.getByTestId('providers')).toContainText('anthropic')
    await expect(page.getByTestId('providers')).toContainText('key set')
  })
})
