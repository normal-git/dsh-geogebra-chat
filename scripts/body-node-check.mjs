/**
 * Body-level transcript node check: after one turn that calls
 * `geogebra_show`, the card must be visible in the chat body WITHOUT expanding
 * the Turn process fold.
 *
 *   node scripts/body-node-check.mjs <url>
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const url = process.argv[2]
if (url === undefined) throw new Error('usage: node scripts/body-node-check.mjs <url>')
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

  const composer = page.locator('div[contenteditable="true"][role="textbox"]').first()
  await composer.click()
  await page.keyboard.type('请调用 geogebra_show 工具，参数 appName 用 graphing。只调用工具，不要做别的事。')
  await page.getByRole('button', { name: '发送消息' }).click()
  console.log('prompt sent, waiting for the turn to settle...')

  const card = page.getByText('GeoGebra 画板', { exact: true }).first()
  await card.waitFor({ timeout: 120_000 })
  await page.waitForTimeout(2500)

  const visible = await card.isVisible()
  const box = await card.boundingBox()
  console.log('body card visible:', visible, 'box:', JSON.stringify(box))
  await page.screenshot({ path: resolve(outDir, 'body-node.png') })
  console.log('errors:', errors.length, JSON.stringify(errors.slice(0, 6)))
} finally {
  await browser.close()
}
