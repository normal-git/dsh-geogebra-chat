/**
 * End-to-end UI check for the dev instance: open a fresh session, find the
 * plugin's guide capsule in the right sidebar, open the tab, and confirm the
 * iframe actually rendered.
 *
 *   node scripts/ui-check.mjs <url>
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const url = process.argv[2]
if (url === undefined) throw new Error('usage: node scripts/ui-check.mjs <url>')
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

  await page.getByText('新会话', { exact: true }).first().click()
  await page.waitForTimeout(1500)

  const openSidebar = page.getByRole('button', { name: '打开右侧边栏' })
  if (await openSidebar.count() > 0) {
    await openSidebar.first().click()
    await page.waitForTimeout(1200)
    console.log('opened the right sidebar')
  }
  await page.screenshot({ path: resolve(outDir, 'check-1-session.png') })

  const capsule = page.getByText('GeoGebra', { exact: true })
  const capsuleCount = await capsule.count()
  console.log('guide capsules named GeoGebra:', capsuleCount)
  if (capsuleCount === 0) {
    console.log('sidebar text:', (await page.locator('body').innerText()).slice(-800))
  } else {
    await capsule.first().click()
    await page.waitForTimeout(2000)
    await page.screenshot({ path: resolve(outDir, 'check-2-tab.png') })

    const frames = page.frames().map(frame => frame.url())
    console.log('frames:', JSON.stringify(frames))

    const board = page.frameLocator('iframe[title="GeoGebra board placeholder"]')
    const boardText = await board.locator('body').innerText().catch(error => `(unreadable: ${error.message})`)
    console.log('board iframe text:', JSON.stringify(boardText))
    console.log('tab title present:', await page.getByText('GeoGebra', { exact: true }).count() > 0)
  }

  console.log('errors:', errors.length, JSON.stringify(errors.slice(0, 5)))
} finally {
  await browser.close()
}
