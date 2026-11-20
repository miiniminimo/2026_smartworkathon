import { renderBlogHtml } from '../public/blog-format.js'

export function blogLocation(raw) {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !['blog.naver.com','m.blog.naver.com'].includes(url.hostname)) return null
    const direct = url.pathname.match(/^\/([\w-]+)(?:\/(\d+))?\/?$/)
    if (direct && !direct[1].endsWith('.naver')) return { blogId:direct[1], postId:direct[2] || '' }
    if (!['/PostList.naver','/PostView.naver','/BlogHome.naver'].includes(url.pathname)) return null
    const blogId = url.searchParams.get('blogId')
    const postId = url.pathname === '/PostView.naver' ? url.searchParams.get('logNo') : ''
    if (!/^[\w-]{2,60}$/.test(blogId || '') || (url.pathname === '/PostView.naver' && !/^\d+$/.test(postId || ''))) return null
    return { blogId, postId }
  } catch { return null }
}

const titleSelector = '.se-documentTitle .se-text-paragraph, .se-documentTitle [contenteditable=true]'
const bodySelector = ':is(.se-components-wrap,.se-main-container) .se-component.se-text .se-text-paragraph, :is(.se-components-wrap,.se-main-container) .se-text:not(.se-documentTitle) [contenteditable=true]'
const photoSelector = ':is(.se-components-wrap,.se-main-container) .se-component.se-image img, :is(.se-components-wrap,.se-main-container) .se-component.se-imageStrip img'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const compact = str => str.replace(/\s+/gu,'')
const blockText = block => block.type === 'list' ? block.items.join(' ') : block.text || ''

export async function findEditor(page) {
  const until = Date.now() + 16000
  while (Date.now() < until && !page.isClosed()) {
    for (const frame of page.frames()) {
      if (!/^https:\/\/(?:m\.)?blog\.naver\.com\//i.test(frame.url())) continue
      if (await frame.locator(titleSelector).first().isVisible().catch(() => false)) return frame
    }
    await pause(250)
  }
  throw Error('글쓰기 화면을 확인하지 못했습니다. 네이버 창에서 로그인·본인 확인·안내 창을 처리한 뒤 다시 시도해 주세요.')
}

async function pasteBlocks(frame, blocks, tags = []) {
  const page = frame.page()
  const html = renderBlogHtml({version:1,title:'',blocks,tags},{includeTitle:false})
  const plain = [...blocks.map(blockText), tags.map(tag => '#' + tag).join(' ')].filter(Boolean).join('\n\n')
  // The system paste gesture lets SmartEditor import its supported subset of HTML.
  await frame.evaluate(async ({ html, plain }) => {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html':new Blob([html],{type:'text/html'}), 'text/plain':new Blob([plain],{type:'text/plain'})
    })])
  }, {html,plain})
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v')
  const needle = compact((tags.length ? '#' + tags.at(-1) : blockText(blocks.at(-1))).slice(-18))
  await frame.waitForFunction(needle => document.querySelector('.se-components-wrap, .se-main-container')?.innerText.replace(/\s+/gu,'').includes(needle), needle, {timeout:7000})
}

// Exposed for integration tests against a local editor fixture. No private Naver APIs are used.
export async function fillEditor(frame, article, onFirstWrite) {
  const page = frame.page()
  const title = frame.locator(titleSelector).first()
  const body = frame.locator(bodySelector)
  const existing = await title.innerText()
  if (existing.trim() && existing.trim() !== '제목') throw Error('네이버 편집기에 기존 제목이 있습니다. 빈 글쓰기 화면에서 다시 시도해 주세요.')
  if (await frame.locator(photoSelector).count() || !(await body.first().isVisible())) throw Error('빈 본문을 확인할 수 없습니다. 네이버 편집기 상태를 확인해 주세요.')
  const originalBody = await body.evaluateAll(paragraphs => paragraphs.map(p => {
    const copy=p.cloneNode(true)
    copy.querySelectorAll('[class*=placeholder]').forEach(el=>el.remove())
    return copy.textContent.replace(/[\u200b\ufeff]/gu,'').trim()
  }).join(''))
  if (originalBody && !/^(본문을 입력하세요\.?|내용을 입력하세요\.?)$/.test(originalBody)) throw Error('편집기에 기존 본문이 있어 중단했습니다. 작성 중인 글을 먼저 정리해 주세요.')
  const split = article.blocks.findIndex(block => block.type === 'image')
  if (split < 0 || !article.image?.data) throw Error('발행 원고에 사진이 없습니다.')
  await title.click({timeout:5000})
  onFirstWrite()
  await page.keyboard.insertText(article.title)
  await body.first().click({timeout:5000})
  await pasteBlocks(frame,article.blocks.slice(0,split))
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  const before = await frame.locator(photoSelector).count()
  const upload = frame.locator('input[type=file][accept*=image i]').first()
  const file = {name:article.image.mimeType === 'image/png' ? 'field-photo.png' : 'field-photo.jpg', mimeType:article.image.mimeType,buffer:Buffer.from(article.image.data,'base64')}
  if (await upload.count()) await upload.setInputFiles(file,{timeout:5000})
  else {
    const button = frame.locator('button.se-image-toolbar-button,button[data-name=image],button[aria-label="사진"],button[title="사진"]').first()
    const [chooser] = await Promise.all([page.waitForEvent('filechooser',{timeout:7000}),button.click({timeout:6000})])
    await chooser.setFiles(file)
  }
  await frame.waitForFunction(({selector,before}) => [...document.querySelectorAll(selector)].slice(before).some(img => img.complete && img.naturalWidth > 0), {selector:photoSelector,before},{timeout:22000})
  const uploadedComponent = frame.locator(':is(.se-components-wrap,.se-main-container) .se-component.se-image, :is(.se-components-wrap,.se-main-container) .se-component.se-imageStrip').last()
  const next = uploadedComponent.locator('xpath=following-sibling::*[contains(concat(" ",normalize-space(@class)," ")," se-text ")][1]//*[contains(@class,"se-text-paragraph")]').first()
  if (await next.isVisible()) await next.click()
  else {
    await frame.locator(photoSelector).last().click()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
  }
  const caption = article.blocks[split].caption
  const after = [...(caption ? [{type:'meta',text:caption}] : []), ...article.blocks.slice(split+1)]
  await pasteBlocks(frame,after,article.tags)
  // Both clipboard pastes have already produced their expected visible tail. Read the
  // editable DOM in document order; native SmartEditor may nest text and photo
  // components in different wrappers from the public post reader.
  const observed = await frame.evaluate(({photoSelector,titleSelector}) => {
    const visible = el => el && !el.closest('[hidden],[aria-hidden="true"],[class*=placeholder],script,style') &&
      el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
    const textNodes = (container, visit) => {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (visible(node.parentElement)) visit(node)
      }
    }
    const titleParts = [...document.querySelectorAll(titleSelector)].filter(visible).map(el => {
      let text = ''
      textNodes(el, node => { text += node.textContent })
      return text
    })
    const photo = [...document.querySelectorAll(photoSelector)].find(img => visible(img) && img.complete && img.naturalWidth > 0)
    const root = photo?.closest('.se-components-wrap') || photo?.closest('.se-main-container')
    let before = '', after = ''
    if (root) textNodes(root, node => {
      if (node.parentElement.closest('.se-documentTitle')) return
      if (photo.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) before += node.textContent
      else after += node.textContent
    })
    return {titleParts,photoLoaded:Boolean(photo && root),before,after}
  }, {photoSelector,titleSelector})
  return assessEditorTransfer(observed,article)
}

export function assessEditorTransfer(observed, article) {
  const title = value => String(value || '').normalize('NFC').replace(/[\u200b-\u200d\ufeff]/gu,'').replace(/\s+/gu,' ').trim()
  const compact = value => title(value).replace(/\s+/gu,'')
  const typographic = value => compact(value).normalize('NFKC').replace(/[‘’]/gu,"'").replace(/[“”]/gu,'"').replace(/[‐‑‒–—]/gu,'-')
  const split = article.blocks.findIndex(b => b.type === 'image')
  const paragraphs = article.blocks.filter(b => b.type === 'paragraph')
  const facts = article.blocks.filter(b => b.type === 'fact')
  const critical = [
    ['첫 본문 문단',paragraphs[0]?.text],
    ['마지막 본문 문단',paragraphs.at(-1)?.text],
    ...facts.map((b,i) => ['근거 문구 ' + (i+1), b.text]),
    ['마무리 안내',article.blocks.find(b => b.type === 'cta')?.text]
  ]
  const missing = []
  if (!observed.titleParts.some(actual => title(actual) === title(article.title))) missing.push('정확한 글 제목')
  if (!observed.photoLoaded || split < 0) missing.push('열리는 현장 사진')
  if (!facts.length) missing.push('근거 문구')
  const whole = typographic(observed.before + observed.after)
  for (const [label,text] of critical) if (!text || !whole.includes(typographic(text))) missing.push(label)
  if (missing.length) throw Error('네이버 편집기에서 다음 항목을 확인하지 못했습니다. ' + missing.join(', ') + '.')

  const texts = parts => parts.flatMap(b => b.type === 'list' ? b.items : [b.text]).filter(Boolean)
  const first = texts(article.blocks.slice(0,split))
  const rest = [article.blocks[split].caption,...texts(article.blocks.slice(split+1)),...article.tags.map(t=>'#'+t)].filter(Boolean)
  const ordered = (raw, parts, normalize) => {
    const haystack = normalize(raw)
    let offset = 0
    for (const part of parts) {
      const needle = normalize(part)
      const start = haystack.indexOf(needle,offset)
      if (start < 0) return false
      offset = start + needle.length
    }
    return true
  }
  if (ordered(observed.before,first,compact) && ordered(observed.after,rest,compact)) return {layout:'verified'}
  const typographyOnly = ordered(observed.before,first,typographic) && ordered(observed.after,rest,typographic)
  if (typographyOnly) return {layout:'review',detail:'일부 문장부호의 표시가 달라 원고와 대조해 주세요.'}
  const labels = {notice:'안내 문구',meta:'현장 정보',paragraph:'본문 일부',heading:'소제목',quote:'인용문',list:'목록'}
  const incomplete = new Set()
  for (const block of article.blocks) {
    const parts = block.type === 'image' ? [block.caption] : texts([block])
    if (parts.some(part => part && !whole.includes(typographic(part)))) {
      incomplete.add(block.type === 'image' ? '사진 설명' : labels[block.type] || '원고 일부')
    }
  }
  if (article.tags.some(t => !whole.includes(typographic('#'+t)))) incomplete.add('태그')
  if (incomplete.size) return {layout:'review',detail:'다음 항목의 전체 문구를 편집기에서 대조해 주세요. ' + [...incomplete].join(', ') + '.'}
  return {layout:'review',detail:'원고 문구를 확인했습니다. 사진의 위치와 앞뒤 문단 순서를 원고와 대조해 주세요.'}
}

// Reader evidence is deliberately separate from editor selectors. A typed title in
// a compose tab, a blog home, or an outbound link cannot prove publication.
function trustedNaverUrl(raw, base) {
  try {
    const url = new URL(raw, base)
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password &&
        ['blog.naver.com', 'm.blog.naver.com'].includes(url.hostname)) return url
  } catch { /* A missing or malformed address is not evidence. */ }
  return null
}

function postUrl(raw, blogId, base) {
  const url = trustedNaverUrl(raw, base)
  const location = url && blogLocation(url.href)
  return location?.blogId === blogId && /^\d+$/u.test(location.postId || '')
    ? 'https://blog.naver.com/' + blogId + '/' + location.postId : null
}

function exactText(value) {
  return String(value ?? '').normalize('NFC').replace(/[\u200B\uFEFF]/gu, '').replace(/\s+/gu, ' ').trim()
}

async function readerSnapshot(frame, title) {
  return frame.evaluate(expected => {
    const clean = value => String(value ?? '').normalize('NFC').replace(/[\u200B\uFEFF]/gu, '').replace(/\s+/gu, ' ').trim()
    const articleSelectors = [
      '.se-documentTitle .se-title-text', '.se-documentTitle', '.se_documentTitle',
      '.htitle .itemSubjectBoldfont', '.pcol1 .tit_h3', '.post_title .tit',
      'h1[itemprop="headline"]', '[data-testid="post-title"]',
    ]
    let titles = []
    for (const selector of articleSelectors) {
      titles = [...document.querySelectorAll(selector)].map(el => clean(el.innerText || el.textContent)).filter(Boolean)
      if (titles.length) break
    }
    const metas = [...document.querySelectorAll('link[rel~="canonical"], meta[property="og:url"]')]
      .map(el => el.getAttribute('href') || el.getAttribute('content')).filter(Boolean)
    const matches = []
    for (const link of document.querySelectorAll('a[href]')) {
      if (link.closest('.se-main-container, .se-components-wrap, .se_component_wrap')) continue
      const labels = [link.innerText, link.getAttribute('title'), link.getAttribute('aria-label')]
      for (const child of link.querySelectorAll('.ell, .tit, [class*="title" i]')) labels.push(child.textContent)
      if (labels.some(value => clean(value) === expected)) matches.push(link.href)
    }
    return { titles, metas, ogTitle: clean(document.querySelector('meta[property="og:title"]')?.content), matches }
  }, title).catch(() => null)
}

async function inspectPost(page, blogId, title) {
  const matches = new Set()
  if (!page || page.isClosed() || !title) return { published: null, matches }
  const top = trustedNaverUrl(page.url())
  const topOwner = top && (blogLocation(top.href)?.blogId || top.searchParams.get('blogId'))
  if (!top || (topOwner && topOwner !== blogId)) return { published: null, matches }
  const topPost = postUrl(top.href, blogId)
  const articles = new Set()
  const frames = []
  for (const frame of page.frames()) {
    const url = trustedNaverUrl(frame.url())
    if (!url || /(?:PostWrite|WriteForm|PostUpdate|PostEditor)/iu.test(url.pathname)) continue
    const location = blogLocation(url.href)
    const owner = location?.blogId || url.searchParams.get('blogId')
    if (owner !== blogId) continue
    const state = await readerSnapshot(frame, title)
    if (!state) continue
    const framePost = postUrl(url.href, blogId)
    const postIds = new Set([framePost].filter(Boolean))
    let foreignArticle = false
    for (const meta of state.metas) {
      const address = trustedNaverUrl(meta, url)?.href
      const parsed = address && blogLocation(address)
      if (!parsed?.postId) continue
      if (parsed.blogId !== blogId) foreignArticle = true
      else postIds.add(postUrl(address, blogId))
    }
    frames.push({ frame, url, location, state, framePost, postIds, foreignArticle })
  }
  const main = frames.find(entry => entry.frame === page.mainFrame?.() || entry.url.href === top.href)
  const wrapperIds = new Set([topPost, ...(main?.postIds || [])].filter(Boolean))
  if (main?.foreignArticle || wrapperIds.size > 1) return { published: null, matches }
  for (const { url, location, state, framePost, postIds, foreignArticle } of frames) {
    const candidates = new Set([...wrapperIds, ...postIds])
    const articleTitles = [...new Set(state.titles.map(exactText))]
    // Check post metadata only when the reader did not render an article heading.
    const actual = articleTitles.length === 1 ? articleTitles[0] : !articleTitles.length ? exactText(state.ogTitle) : ''
    if (!foreignArticle && actual === title && candidates.size === 1) articles.add([...candidates][0])
    // A recommendation in a numbered article or an editor is never a blog-list receipt.
    if (!wrapperIds.size && !framePost && !foreignArticle && location?.blogId === blogId &&
        (url.pathname === '/PostList.naver' || url.pathname.replace(/\/$/u,'') === '/' + blogId || url.pathname === '/BlogHome.naver')) {
      for (const link of state.matches) {
        const candidate = postUrl(link, blogId, url)
        if (candidate) matches.add(candidate)
      }
    }
  }
  return { published: articles.size === 1 ? [...articles][0] : null, matches }
}

// Only visit a canonicalized numbered URL under the requested account. This
// temporary reader tab never clicks a link or modifies the editor or its draft.
export async function confirmPostCandidate(context, rawUrl, blogId, title) {
  const target = postUrl(rawUrl, blogId)
  const expected = exactText(title)
  if (!target || !expected || !context) return null
  let reader
  try {
    reader = await context.newPage()
    await reader.goto(target, { waitUntil: 'domcontentloaded', timeout: 4500 })
    const deadline = Date.now() + 2200
    do {
      const result = await inspectPost(reader, blogId, expected)
      if (result.published) return result.published === target ? target : null
      if (reader.isClosed() || !trustedNaverUrl(reader.url())) return null
      await pause(200)
    } while (Date.now() < deadline)
    return null
  } catch { return null }
  finally { if (reader) await reader.close().catch(() => {}) }
}

export async function confirmPost(page, blogId, title) {
  const expected = exactText(title)
  const { published, matches } = await inspectPost(page, blogId, expected)
  if (published) return published
  if (matches.size !== 1 || !page.context) return null
  return confirmPostCandidate(page.context(), [...matches][0], blogId, expected)
}
