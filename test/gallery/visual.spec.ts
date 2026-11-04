import { expect, test } from 'playwright/test'
import { READY, SCENES } from './scenes'

// One screenshot per gallery scene, compared with its baseline in __screenshots__/<platform>/.
for (const scene of SCENES) {
  test(scene.title, async ({ page }) => {
    await page.goto(`/?scene=${scene.id}`)
    await page.waitForSelector(`html[${READY}]`)
    expect(await page.getAttribute('html', READY)).toBe('')
    await expect(page).toHaveScreenshot(`${scene.id}.png`)
  })
}
