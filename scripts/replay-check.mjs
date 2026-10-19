/**
 * Replay check: after a Host restart, opening the session must restore the
 * construction from the persisted snapshot, and the sync must settle (no
 * revision ping-pong between the inline and sidebar boards).
 *
 *   node scripts/replay-check.mjs <url> <session title> <snapshot file>
 */
import { chromium } from 'playwright-core'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const [url, title, snapshot] = process.argv.slice(2)
if (url === undefined || title === undefined) throw new Error('usage: node scripts/replay-check.mjs <url> <session title> [snapshot]')

const executablePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(path => path !== undefined && existsSync(path))
if (executablePath === undefined) throw new Error('no Chrome/Edge found')

const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(2500)
  const dismiss = page.getByRole('button', { name: '继续' })
  if (await dismiss.count() > 0) await dismiss.first().click()

  await page.getByText(title, { exact: true }).first().click()
  await page.waitForTimeout(20_000)

  const boards = []
  for (const frame of page.frames()) {
    if (frame.url() !== 'about:srcdoc') continue
    const info = await frame.evaluate(() => {
      if (!window.ggbAPI) return null
      return { objects: window.ggbAPI.getAllObjectNames(), c: window.ggbAPI.getValueString('c') }
    }).catch(() => null)
    if (info) boards.push(info)
  }
  console.log('restored boards:', JSON.stringify(boards))
  await page.screenshot({ path: resolve(import.meta.dirname, '..', '.dev', 'replay.png') })

  if (snapshot !== undefined && existsSync(snapshot)) {
    const before = statSync(snapshot).mtimeMs
    await page.waitForTimeout(8000)
    const after = statSync(snapshot).mtimeMs
    console.log('snapshot write during idle window:', after !== before, '(false means sync settled)')
  }
  console.log('errors:', errors.length, JSON.stringify(errors.slice(0, 5)))
} finally {
  await browser.close()
}
