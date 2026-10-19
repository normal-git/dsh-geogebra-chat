/**
 * Inline-board check: the body card itself must render the live GeoGebra board
 * and show the command result; the sidebar board must mirror the same state.
 *
 *   node scripts/inline-check.mjs <url>
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const url = process.argv[2]
if (url === undefined) throw new Error('usage: node scripts/inline-check.mjs <url>')
const outDir = resolve(import.meta.dirname, '..', '.dev')
mkdirSync(outDir, { recursive: true })

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

const boardFrames = async () => {
  const result = []
  for (const frame of page.frames()) {
    if (frame.url() !== 'about:srcdoc') continue
    const info = await frame.evaluate(() => {
      if (!window.ggbAPI) return null
      return { objects: window.ggbAPI.getAllObjectNames(), c: window.ggbAPI.getValueString('c') }
    }).catch(() => null)
    if (info) result.push(info)
  }
  return result
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(2500)

  const dismiss = page.getByRole('button', { name: '继续' })
  if (await dismiss.count() > 0) await dismiss.first().click()

  const composer = page.locator('div[contenteditable="true"][role="textbox"]').first()
  await composer.click()
  await page.keyboard.type(
    '请调用 geogebra_show（appName 用 graphing），然后调用 geogebra_command 执行 c: (x-1)^2+(y-2)^2=4。只做这两件事，然后一句话汇报。',
  )
  await page.getByRole('button', { name: '发送消息' }).click()
  console.log('prompt sent...')

  const card = page.getByText('GeoGebra 画板', { exact: true }).first()
  await card.waitFor({ timeout: 180_000 })
  await page.waitForTimeout(15000)

  console.log('boards before sidebar:', JSON.stringify(await boardFrames()))
  await page.screenshot({ path: resolve(outDir, 'inline.png') })

  const sidebar = page.getByRole('button', { name: '在侧栏打开' }).first()
  if (await sidebar.count() > 0) {
    await sidebar.click()
    await page.waitForTimeout(12000)
    console.log('boards after sidebar:', JSON.stringify(await boardFrames()))
    await page.screenshot({ path: resolve(outDir, 'inline-sidebar.png') })
  }

  console.log('errors:', errors.length, JSON.stringify(errors.slice(0, 6)))
} finally {
  await browser.close()
}
