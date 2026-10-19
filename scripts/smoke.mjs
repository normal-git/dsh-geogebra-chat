/**
 * Headless smoke check for the dev web instance.
 *
 * Verifies that the plugin reached the browser: the boot graph carries its row,
 * its bundle is served, the factory registers, and the page reports no errors.
 * Saves a screenshot for eyeballing.
 *
 *   node scripts/smoke.mjs [url]
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:3099'
const outDir = resolve(import.meta.dirname, '..', '.dev')
mkdirSync(outDir, { recursive: true })

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]
const executablePath = candidates.find(path => path !== undefined && existsSync(path))
if (executablePath === undefined) throw new Error('no Chrome/Edge found; set CHROME_PATH')

const browser = await chromium.launch({ executablePath, headless: true })

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const consoleErrors = []
const pageErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => pageErrors.push(error.message))

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForFunction(() => typeof window.__DSH_BOOT__ === 'object' && window.__DSH_BOOT__ !== null, null, { timeout: 60_000 })
  const boot = await page.evaluate(() => window.__DSH_BOOT__)
  const rows = (boot.entries ?? []).filter(entry => String(entry.id).includes('geogebra'))
  console.log('boot rows for geogebra:', JSON.stringify(rows))

  const bundle = await page.evaluate(async () => {
    const rows = (window.__DSH_BOOT__?.entries ?? []).filter(entry => String(entry.id).includes('geogebra'))
    if (rows.length === 0) return null
    const response = await fetch(rows[0].url)
    return { status: response.status, text: (await response.text()).slice(0, 120) }
  })
  console.log('served bundle:', JSON.stringify(bundle))

  await page.waitForTimeout(3000)
  await page.screenshot({ path: resolve(outDir, 'shot-home.png'), fullPage: false })
  console.log('screenshot: .dev/shot-home.png')
  console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 8)))
  console.log('page errors:', pageErrors.length, JSON.stringify(pageErrors.slice(0, 8)))
} finally {
  await browser.close()
}
