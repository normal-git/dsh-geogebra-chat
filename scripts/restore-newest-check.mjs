/**
 * Restore check after a Host restart: open the newest GeoGebra session, verify
 * the construction comes back from disk, then open the sidebar mirror and make
 * sure the snapshot is not rewritten (no ping-pong).
 *
 *   node scripts/restore-newest-check.mjs <url> <snapshot file>
 */
import { chromium } from 'playwright-core'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const [url, snapshot] = process.argv.slice(2)
if (url === undefined || snapshot === undefined) throw new Error('usage: node scripts/restore-newest-check.mjs <url> <snapshot>')

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })

const boards = async () => {
  const found = []
  for (const frame of page.frames()) {
    if (frame.url() !== 'about:srcdoc') continue
    const info = await frame.evaluate(() => window.ggbAPI
      ? { objects: window.ggbAPI.getAllObjectNames(), c: window.ggbAPI.getValueString('c') }
      : null).catch(() => null)
    if (info) found.push(info)
  }
  return found
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(2500)
  const dismiss = page.getByRole('button', { name: '继续' })
  if (await dismiss.count() > 0) await dismiss.first().click()

  // Newest session in the list starts with "GeoGebra"; the workspace is "dsh-geogebra".
  await page.getByText('调用 GeoGebra 绘制圆', { exact: true }).first().click()
  await page.waitForTimeout(16_000)
  console.log('after restart:', JSON.stringify(await boards()))

  const mtimeBefore = statSync(snapshot).mtimeMs
  const sidebar = page.getByRole('button', { name: '在侧栏打开' }).first()
  if (await sidebar.count() > 0) await sidebar.click()
  await page.waitForTimeout(14_000)
  console.log('snapshot rewritten with both open:', statSync(snapshot).mtimeMs !== mtimeBefore)
  console.log('both boards:', JSON.stringify(await boards()))
  await page.screenshot({ path: resolve(import.meta.dirname, '..', '.dev', 'restore-final.png') })
  console.log('errors:', errors.length, JSON.stringify(errors.slice(0, 5)))
} finally {
  await browser.close()
}

