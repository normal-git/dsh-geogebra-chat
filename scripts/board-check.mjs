/**
 * Phase 1 smoke test: the sidebar tab must load the real GeoGebra applet from
 * the CDN, evaluate `f(x)=x^2`, and answer API calls.
 *
 *   node scripts/board-check.mjs <url>
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const url = process.argv[2]
if (url === undefined) throw new Error('usage: node scripts/board-check.mjs <url>')
const outDir = resolve(import.meta.dirname, '..', '.dev')
mkdirSync(outDir, { recursive: true })

const executablePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(path => path !== undefined && existsSync(path))
if (executablePath === undefined) throw new Error('no Chrome/Edge found')

const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(2500)

  const dismiss = page.getByRole('button', { name: '继续' })
  if (await dismiss.count() > 0) await dismiss.first().click()

  const openSidebar = page.getByRole('button', { name: '打开右侧边栏' })
  if (await openSidebar.count() > 0) { await openSidebar.first().click(); await page.waitForTimeout(1000) }

  await page.getByText('GeoGebra', { exact: true }).first().click()
  console.log('opened the GeoGebra tab; waiting for the applet...')

  const frame = page.frames().find(f => f.url() === 'about:srcdoc')
  if (frame === undefined) throw new Error('board iframe not found')

  await frame.waitForFunction(() => typeof window.ggbAPI === 'object' && window.ggbAPI !== null, null, { timeout: 90_000 })
  const info = await frame.evaluate(() => ({
    objects: window.ggbAPI.getAllObjectNames(),
    f: window.ggbAPI.getValueString('f'),
    f2: window.ggbAPI.getValueString('f(2)'),
    xmlLength: window.ggbAPI.getXML().length,
  }))
  console.log('applet ready:', JSON.stringify(info))
  await page.waitForTimeout(1500)
  await page.screenshot({ path: resolve(outDir, 'board.png') })
  console.log('errors:', errors.length, JSON.stringify(errors.slice(0, 6)))
} finally {
  await browser.close()
}
