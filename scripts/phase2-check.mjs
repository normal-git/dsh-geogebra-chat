/**
 * Phase 2 end-to-end check: the model calls `geogebra_show`, the board opens
 * automatically, `geogebra_command` executes on the applet, and the transcript
 * keeps only the body card (no custom card inside the process fold).
 *
 *   node scripts/phase2-check.mjs <url>
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const url = process.argv[2]
if (url === undefined) throw new Error('usage: node scripts/phase2-check.mjs <url>')
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
  await page.keyboard.type(
    '请按顺序做三件事：1) 调用 geogebra_show，appName 用 graphing；2) 等画板打开后调用 geogebra_command 执行 c: (x-1)^2+(y-2)^2=4；3) 调用 geogebra_state 读取状态。最后用一句话汇报，不要做别的。',
  )
  await page.getByRole('button', { name: '发送消息' }).click()
  console.log('prompt sent, waiting for the agent turn...')

  const card = page.getByText('GeoGebra 画板', { exact: true }).first()
  await card.waitFor({ timeout: 180_000 })
  await page.waitForTimeout(20_000)

  const frame = page.frames().find(f => f.url() === 'about:srcdoc')
  if (frame === undefined) throw new Error('board iframe not found')
  await frame.waitForFunction(() => window.ggbAPI, null, { timeout: 90_000 })
  const info = await frame.evaluate(() => ({
    objects: window.ggbAPI.getAllObjectNames(),
    c: window.ggbAPI.getValueString('c'),
  }))
  console.log('board:', JSON.stringify(info))
  console.log('custom toolview cards in process fold:', await page.locator('[data-slot="tool.call.toolview"]').count())
  await page.screenshot({ path: resolve(outDir, 'phase2.png') })
  console.log('errors:', errors.length, JSON.stringify(errors.slice(0, 6)))
} finally {
  await browser.close()
}
