import type { Page } from '@playwright/test'

export const FINISHED = 'tock-and-the-windy-day'
export const WAITING = 'moo-moos-missing-moon-pie'

/** Opens the renderer against the fake engine. `speed` makes the fake crew work faster. */
export async function openDemo(page: Page, speed = 12): Promise<void> {
  await page.goto(`/?demo&speed=${speed}`)
  await page.getByTestId('app').waitFor()
  await page.getByTestId('episode-card').first().waitFor()
}

export async function openEpisode(page: Page, id: string): Promise<void> {
  await page.locator(`[data-testid="episode-card"][data-episode="${id}"]`).click()
  await page.getByTestId('episode-panel').waitFor()
}

export interface StudioInfo {
  agents: number
  sprites: number
  rooms: string[]
  positions: Record<string, { x: number; y: number }>
}

export async function studioInfo(page: Page): Promise<StudioInfo> {
  return page.evaluate(() => (globalThis as unknown as { __studio: StudioInfo }).__studio)
}
