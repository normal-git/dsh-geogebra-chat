/**
 * Interactive UI probe for the dev instance: dismiss the welcome notice, open a
 * fresh session, list the buttons that could open the right sidebar, and take
 * screenshots. Used to discover the shell's selectors for the real smoke test.
 *
 *   node scripts/ui-probe.mjs <url>
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const url = process.argv[2]
if (url === undefined) throw new Error('usage: node scripts/ui-probe.mjs <url>')
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
page.on('pageerror', error => console.log('[pageerror]', error.message))
page.on('console', message => {
  if (message.type() === 'error') console.log('[console.error]', message.text())
})

const dumpButtons = async (label) => {
  const items = await page.locator('button, [role="button"]').evaluateAll(nodes => nodes.map((node) => {
    const el = /** @type {HTMLElement} */ (node)
    return {
      text: (el.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
      aria: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      testid: el.getAttribute('data-testid'),
    }
  }).filter(item => item.text !== '' || item.aria !== null || item.title !== null))
  console.log(`--- buttons (${label}) ---`)
  for (const item of items) console.log(JSON.stringify(item))
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(2500)

  const dismiss = page.getByRole('button', { name: '继续' })
  if (await dismiss.count() > 0) {
    await dismiss.first().click()
    await page.waitForTimeout(500)
    console.log('dismissed welcome notice')
  }

  const newSession = page.getByText('新会话', { exact: true }).first()
  if (await newSession.count() > 0) {
    await newSession.click()
    await page.waitForTimeout(1500)
    console.log('opened a new session')
  }
  await page.screenshot({ path: resolve(outDir, 'probe-session.png') })
  await dumpButtons('after new session')

  console.log('title:', await page.title())
  console.log('url:', page.url())
} finally {
  await browser.close()
}
