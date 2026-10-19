/**
 * Conflict check: with both the inline board and the sidebar mirror open, the
 * host snapshot must stay stable (no write ping-pong) and both boards must show
 * the same construction.
 *
 *   node scripts/conflict-check.mjs <url> <session title> <snapshot file>
 */
import { chromium } from 'playwright-core'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const [url, title, snapshot] = process.argv.slice(2)
if (url === undefined || title === undefined || snapshot === undefined) {
  throw new Error('usage: node scripts/conflict-check.mjs <url> <session title> <snapshot>')
}

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
      ? { objects: window.ggbAPI.getAllObjectNames(), xml: window.ggbAPI.getXML().length }
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

  await page.getByText(title, { exact: true }).first().click()
  await page.waitForTimeout(12_000)
  console.log('inline board:', JSON.stringify(await boards()))

  const mtimeBefore = statSync(snapshot).mtimeMs
  await page.getByRole('button', { name: '在侧栏打开' }).first().click()
  await page.waitForTimeout(14_000)
  const mtimeAfter = statSync(snapshot).mtimeMs
  console.log('snapshot rewritten while both open:', mtimeAfter !== mtimeBefore)
  console.log('boards:', JSON.stringify(await boards()))
  await page.screenshot({ path: resolve(import.meta.dirname, '..', '.dev', 'conflict.png') })
  console.log('errors:', errors.length, JSON.stringify(errors.slice(0, 5)))
} finally {
  await browser.close()
}
