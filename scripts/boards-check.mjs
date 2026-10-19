/**
 * New-model check: one agent turn creates a named board; the card renders the
 * construction and the Host stores the sheet.
 *
 *   node scripts/boards-check.mjs <url>
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const url = process.argv[2]
if (url === undefined) throw new Error('usage: node scripts/boards-check.mjs <url>')
const outDir = resolve(import.meta.dirname, '..', '.dev')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
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
    '请调用 geogebra_create：name 用「圆与中点」，commands 两行：\n'
    + 'c: (x-1)^2+(y-2)^2=4\n'
    + 'M=(1,2)\n'
    + '只调用这一个工具，然后根据返回值用一句话汇报。',
  )
  await page.getByRole('button', { name: '发送消息' }).click()
  console.log('prompt sent, waiting for the board card...')

  const title = page.getByText(/圆与中点 · b\d+/).first()
  await title.waitFor({ timeout: 120_000 })
  await page.waitForTimeout(12000)
  console.log('card title:', await title.innerText())

  const boards = []
  for (const frame of page.frames()) {
    if (frame.url() !== 'about:srcdoc') continue
    const info = await frame.evaluate(() => window.ggbAPI
      ? { objects: window.ggbAPI.getAllObjectNames(), c: window.ggbAPI.getValueString('c') }
      : null).catch(() => null)
    if (info) boards.push(info)
  }
  console.log('boards:', JSON.stringify(boards))
  await page.screenshot({ path: resolve(outDir, 'boards.png') })
  console.log('errors:', errors.length, JSON.stringify(errors.slice(0, 6)))
} finally {
  await browser.close()
}
