/**
 * Full-loop check on the dev instance: send one prompt that makes the model
 * call `geogebra_hello`, then verify the custom chat card renders and its
 * "open in sidebar" button lands on the sidebar tab.
 *
 *   node scripts/ui-agent-check.mjs <url>
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const url = process.argv[2]
if (url === undefined) throw new Error('usage: node scripts/ui-agent-check.mjs <url>')
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
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text())
})

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(2500)

  const dismiss = page.getByRole('button', { name: '继续' })
  if (await dismiss.count() > 0) await dismiss.first().click()

  const composer = page.locator('div[contenteditable="true"][role="textbox"]').first()
  await composer.waitFor({ timeout: 30_000 })
  await composer.click()
  await page.keyboard.type('请调用 geogebra_hello 工具，参数 text 用「测试成功」。只调用工具，不要做别的事。')
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '发送消息' }).click()
  console.log('prompt sent, waiting for the tool card...')

  const card = page.getByText('GeoGebra probe', { exact: true })
  await card.waitFor({ timeout: 120_000 })
  console.log('custom tool card rendered')
  await page.waitForTimeout(1200)
  await page.screenshot({ path: resolve(outDir, 'agent-1-card.png') })

  // Tool rows start collapsed; expanding is what shows the registered view.
  await page.getByText(/geogebra_hello 工具调用完成/).first().click().catch(() => {})
  await page.waitForTimeout(1000)
  await page.screenshot({ path: resolve(outDir, 'agent-2-expanded.png') })

  const frames = page.frames().map(frame => frame.url())
  console.log('frames:', JSON.stringify(frames))
  const board = page.frameLocator('iframe[title="GeoGebra board placeholder"]')
  console.log('card iframe text:', JSON.stringify(await board.locator('body').innerText().catch(e => `(unreadable: ${e.message})`)))

  await page.getByRole('button', { name: '在右侧栏打开' }).first().click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: resolve(outDir, 'agent-2-sidebar.png') })
  console.log('sidebar frames:', JSON.stringify(page.frames().map(frame => frame.url())))
  console.log('errors:', errors.length, JSON.stringify(errors.slice(0, 5)))
} finally {
  await browser.close()
}
