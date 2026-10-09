import { test } from '@playwright/test'
import { FINISHED, WAITING, openDemo, openEpisode, studioInfo } from './helpers'

/** Design review shots, written to .claude/temp/ui-shots/. Run with: SHOTS=1 npx playwright test screenshots */
const DIR = '.claude/temp/ui-shots'
test.skip(!process.env.SHOTS, 'set SHOTS=1 to take design screenshots')

test('take screenshots', async ({ page }) => {
  test.setTimeout(240_000)
  await openDemo(page, 1)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${DIR}/01-studio-idle.png` })

  // start an episode and let the crew get busy
  await page.getByTestId('new-episode').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${DIR}/02-new-episode-empty.png` })
  await page.getByTestId('theme-input').fill('Tock and the lost red balloon')
  await page.getByTestId('type-mystery').click()
  await page.getByTestId('cast-tock').click()
  await page.getByTestId('cast-bobbin').click()
  await page.getByTestId('cast-moo_moo').click()
  await page.screenshot({ path: `${DIR}/03-new-episode-filled.png` })
  await page.getByTestId('start-episode').click()
  await page.waitForTimeout(9000)
  await page.screenshot({ path: `${DIR}/04-studio-working.png` })
  const info = await studioInfo(page)
  const box = (await page.getByTestId('studio-canvas').locator('canvas').boundingBox())!
  const p = info.positions['screenwriter-wilbur-wobblewick']!
  await page.mouse.click(box.x + (p.x * box.width) / 1280, box.y + (p.y * box.height) / 720)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${DIR}/05-agent-drawer.png` })
  await page.getByTestId('open-terminal').click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${DIR}/06-terminal.png` })
  await page.getByTestId('terminal-close').click()

  await openEpisode(page, FINISHED)
  for (const tab of ['brief', 'script', 'shots', 'animatic', 'render', 'final']) {
    await page.getByTestId(`tab-${tab}`).click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${DIR}/10-tab-${tab}.png` })
  }
  await openEpisode(page, WAITING)
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${DIR}/20-approval-animatic.png` })
  await page.getByTestId('request-changes').click()
  await page.screenshot({ path: `${DIR}/21-request-changes.png` })
  await page.getByTestId('nav-agents').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${DIR}/30-crew.png` })
  await page.getByTestId('nav-settings').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${DIR}/31-settings.png` })
  // render progress while the render farm works
  await page.getByTestId('nav-studio').click()
  await page.waitForTimeout(100)
})

test('render in progress screenshots', async ({ page }) => {
  test.setTimeout(240_000)
  await openDemo(page, 6)
  await openEpisode(page, WAITING)
  await page.getByTestId('approve').click()
  await page.getByTestId('tab-render').click()
  await page.waitForTimeout(5000)
  await page.screenshot({ path: `${DIR}/22-render-progress.png` })
  await page.getByTestId('nav-studio').click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${DIR}/23-studio-render.png` })
})
