// Run with Node and an installed Chrome: node qa/editor-lifecycle.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'
import { makeHandler } from '../server.mjs'

const offlinePublisher = {
  status: async () => ({
    openai: { configured: false },
    naver: { configured: false, connected: false, mode: 'local' }
  }),
  close() {}
}
const handler = makeHandler(undefined, offlinePublisher)
const server = createServer(handler)
let browser
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = 'http://127.0.0.1:' + server.address().port
  browser = await chromium.launch(process.env.NAVER_CHROME_PATH
    ? { executablePath: process.env.NAVER_CHROME_PATH, headless: true }
    : { channel: 'chrome', headless: true })
  const page = await browser.newPage()
  const control = id => page.locator('#' + id)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin || route.request().method() !== 'GET') return route.abort()
    return route.continue()
  })
  const approve = async () => {
    await control('check-copy').check()
    await control('check-photo').check()
    await control('approve').click()
  }
  const edit = () => control('blog-view-mode').selectOption('edit')
  const title = page.locator('#blog-editor-fields [data-field="title"]')
  await page.goto(origin)
  await control('quick-sample').click()
  await page.locator('#blog-preview figure img').waitFor()
  const original = await page.locator('#blog-preview h1').textContent()
  await approve()
  await edit()
  assert(await control('check-copy').isChecked())
  await control('cancel-blog-edits').click()
  assert(await control('export').isEnabled())

  await edit()
  await title.fill('확인되지 않은 수치 100')
  assert(await control('export').isDisabled())
  assert(await control('check-copy').isDisabled())
  assert(!await control('check-copy').isChecked())
  await control('tab-card').click()
  assert.equal(await control('tab-blog').getAttribute('aria-selected'), 'true')
  await control('blog-view-mode').selectOption('markdown')
  assert.equal(await control('blog-view-mode').inputValue(), 'edit')
  assert(await control('blog-editor-error').isVisible())
  assert.equal(await title.inputValue(), '확인되지 않은 수치 100')
  await control('cancel-blog-edits').click()
  assert(await control('check-copy').isEnabled())
  assert(await control('export').isDisabled())
  assert.equal(await page.locator('#blog-preview h1').textContent(), original)

  for (const destination of ['markdown', 'card']) {
    const updated = destination === 'markdown' ? '상담의 다음 약속' : '다음 담당자에게 남기는 기록'
    await edit()
    await title.fill(updated)
    if (destination === 'markdown') {
      await control('blog-view-mode').selectOption('markdown')
      assert((await control('blog-markdown').textContent()).includes('# ' + updated))
      await control('blog-view-mode').selectOption('preview')
    } else {
      await control('tab-card').click()
      await control('tab-blog').click()
    }
    assert.equal(await page.locator('#blog-preview h1').textContent(), updated)
    assert(await control('check-copy').isEnabled())
    assert(await control('export').isDisabled())
    await approve()
  }
  assert.deepEqual(errors, [])
  console.log('PASS: review retention, dirty gating, inline validation, cancel, mode/tab save and reapproval')
} finally {
  await browser?.close()
  server.closeAllConnections()
  server.close()
  handler.close()
}
