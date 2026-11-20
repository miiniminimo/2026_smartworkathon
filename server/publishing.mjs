import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiError } from './generate.mjs'
import { buildBlogDocument, renderBlogHtml, renderBlogMarkdown } from '../public/blog-format.js'
import { createConnectionPool } from './publishing-mcp.mjs'

const ttl = 2 * 60 * 60 * 1000
const maxImage = 8 * 1024 * 1024
const defaultTool = 'publish_naver_blog'
const unavailable = () => new ApiError(503, 'MCP_UNAVAILABLE', '네이버 MCP 연결과 발행 도구 설정을 확인해 주세요.')
const trustedBlogId = value => typeof value === 'string' && /^[a-z0-9_-]{2,60}$/i.test(value)

function verifiedLink(value, blogId) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !['blog.naver.com', 'm.blog.naver.com'].includes(url.hostname)
      || url.port || url.username || url.password) return null
    const match = /^\/([\w-]+)\/(\d+)\/?$/.exec(url.pathname)
    let logNo
    if (match?.[1] === blogId) logNo = match[2]
    if (url.pathname === '/PostView.naver' && url.searchParams.get('blogId') === blogId) logNo = url.searchParams.get('logNo')
    return /^\d+$/.test(logNo || '') ? 'https://blog.naver.com/' + blogId + '/' + logNo : null
  } catch { return null }
}

function validateImage(image) {
  const invalid = () => new ApiError(400, 'INVALID_PHOTO', '발행 사진을 8MB 이하의 JPEG 또는 PNG로 준비해 주세요.')
  if (!image || !['image/jpeg', 'image/png'].includes(image.mimeType) || typeof image.data !== 'string'
    || image.data.length > Math.ceil(maxImage / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw invalid()
  const bytes = Buffer.from(image.data, 'base64')
  if (bytes.length < 12 || bytes.length > maxImage || bytes.toString('base64') !== image.data) throw invalid()
  const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.subarray(12,16).toString() === 'IHDR'
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217
  if (image.mimeType === 'image/png' ? !png : !jpeg) throw invalid()
  return { mimeType: image.mimeType, data: image.data }
}

function checkEvidence(result, config) {
  const cta = config.settings?.cta
  const approved = result.used_facts.every(used => {
    const candidates = config.facts?.filter(fact => fact.id === used.id) || []
    const fact = candidates[0]
    return candidates.length === 1 && fact.status === 'approved' && fact.product === '녹취 제품'
      && typeof fact.approved_by === 'string' && !!fact.approved_by.trim() && fact.text === used.text && fact.source === used.source
  })
  if (!approved || !cta?.confirmed || cta.text !== result.cta_text) {
    throw new ApiError(409, 'EVIDENCE_CHANGED', '제품 근거 또는 상담 설정이 바뀌었습니다. 새 초안을 만들고 다시 검토해 주세요.')
  }
}

function receipt(output, blogId) {
  const url = output?.status === 'published' && (!output.blogId || output.blogId === blogId) && verifiedLink(output.url, blogId)
  if (url) return { status: 'published', url, blogId, message: '네이버 게시물 주소를 확인했습니다.' }
  if (output?.status === 'draft' && (!output.blogId || output.blogId === blogId)) {
    return { status: 'draft', blogId, ...(output.layout === 'review' ? {layout:'review'} : {}), message: output.layout === 'review' ? '네이버 편집기에 원고와 사진을 전달했습니다. 발행 전 문단과 사진 배치를 대조해 주세요.' : '네이버 편집기에 원고를 전달했습니다. 편집기에서 발행한 뒤 결과를 다시 확인하세요.' }
  }
  return { status: 'uncertain', blogId, message: '게시물 주소를 확인하지 못했습니다. 다시 전송하기 전에 네이버 블로그에서 결과를 확인해 주세요.' }
}

function rejectKnownFailure(output, local = false) {
  if (output?.status !== 'failed' || output.attempted !== false) return
  if (output.code === 'LOGIN_REQUIRED') throw new ApiError(409, 'LOGIN_REQUIRED', '전용 네이버 창에서 대상 계정에 로그인한 뒤 다시 시도해 주세요.')
  if (output.code === 'ACCOUNT_MISMATCH') throw new ApiError(409, 'ACCOUNT_MISMATCH', '네이버 창에서 지정한 블로그 계정으로 전환해 주세요.')
  throw new ApiError(503, 'EDITOR_UNAVAILABLE', local && typeof output.message === 'string' ? output.message.slice(0,240) : '네이버 편집기를 준비하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.')
}

// Durable receipts contain only a content hash, operation ID and outcome. A crash
// after dispatch leaves an uncertain receipt; another process must not post again.
export function publicationJournal(directory = fileURLToPath(new URL('../.studio-runtime/publish/', import.meta.url))) {
  const filename = hash => join(directory, hash + '.json')
  return {
    async reserve(hash, id) {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      try {
        await writeFile(filename(hash), JSON.stringify({ id, status: 'uncertain' }), { flag: 'wx', mode: 0o600 })
        return null
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        // Even a partial write signals a prior attempt; fail closed on replay.
        try { return JSON.parse(await readFile(filename(hash), 'utf8')) } catch { return { id, status: 'uncertain' } }
      }
    },
    async save(hash, id, status) {
      const file = filename(hash)
      const temp = file + '.' + randomUUID()
      await writeFile(temp, JSON.stringify({ id, status: status.status, url: status.url, layout:status.layout }), { mode: 0o600 })
      await rename(temp, file)
    },
    async release(hash) { await unlink(filename(hash)) }
  }
}

export function createPublisher({ getConfig, env = process.env, pool = createConnectionPool({ env }), now = Date.now,
  journal = publicationJournal(), getRehearsal = async () => (await import('./rehearsal.mjs')).rehearsalCase()
} = {}) {
  const drafts = new Map()
  const toolName = () => env.NAVER_MCP_TOOL || defaultTool
  const mode = () => env.NAVER_MCP_URL ? 'http' : 'local'
  const discover = async () => {
    try { return await pool.discover() } catch { throw unavailable() }
  }
  const config = async () => {
    const values = await getConfig()
    if (!trustedBlogId(values.blogId)) throw new ApiError(409, 'NAVER_NOT_CONFIGURED', '연결 설정에서 대상 네이버 블로그 ID를 먼저 지정해 주세요.')
    return values
  }
  const find = token => {
    const entry = drafts.get(token)
    if (!entry || entry.expires <= now()) {
      drafts.delete(token)
      throw new ApiError(409, 'DRAFT_EXPIRED', '이 서버에서 생성한 유효한 실시간 초안이 필요합니다. 새 초안을 생성하고 검토해 주세요.')
    }
    return entry
  }

  function store(input, result, rehearsalBlog = '') {
    for (const [key, entry] of drafts) if (entry.expires <= now()) drafts.delete(key)
    if (drafts.size >= 128) drafts.delete(drafts.keys().next().value)
    const token = randomUUID()
    // Keep text only for a limited review window. Photos never enter this map.
    drafts.set(token, { input, result, rehearsalBlog, expires: now() + ttl })
    return { ...result, publish_token: token }
  }

  function remember(input, result) {
    if (result?.origin !== 'model' || !result.cta_text?.trim() || !result.used_facts?.length) return result
    return store(input, result)
  }

  async function rehearsal() {
    const { blogId } = await config()
    const { result, input, photo } = await getRehearsal()
    if (result.origin !== 'rehearsal' || photo !== '/samples/office-equipment.jpg') throw new Error('Invalid rehearsal fixture')
    return { ...store(input, result, blogId), input, photo }
  }

  async function status() {
    const current = await getConfig()
    const configured = trustedBlogId(current.blogId)
    const naver = {
      configured, connected: false, mode: mode(), blogId: configured ? current.blogId : '',
      tool: toolName(), message: '대상 블로그 ID를 설정해 주세요.'
    }
    if (configured) {
      try {
        const { tools } = await discover()
        naver.connected = tools.has(toolName())
        naver.message = naver.connected ? '발행 도구가 연결되었습니다. 로그인은 네이버 창에서 확인합니다.' : '설정한 이름의 발행 도구가 없습니다.'
      } catch { naver.message = 'MCP 서버에 연결할 수 없습니다.' }
    }
    return { openai: { configured: Boolean(current.apiKey), model: current.model }, naver }
  }

  async function login() {
    const current = await config()
    if (mode() !== 'local') throw new ApiError(409, 'EXTERNAL_LOGIN', '외부 MCP 서버에서 네이버 계정을 연결해 주세요.')
    const { client, tools } = await discover()
    if (!tools.has('open_naver_login')) throw unavailable()
    let response
    try { response = await client.call('open_naver_login', { blogId: current.blogId }, 45000) } catch { throw unavailable() }
    if (response?.status !== 'opened') throw new ApiError(503, 'LOGIN_WINDOW_UNAVAILABLE', '전용 네이버 창을 열 수 없습니다. 브라우저 설치 및 실행 환경을 확인해 주세요.')
    return { status: 'opened', blogId: current.blogId, message: '전용 네이버 창에서 로그인을 완료해 주세요.' }
  }

  async function publish(body) {
    const entry = find(body?.publish_token)
    if (!body?.confirmation || !['content','photo','publish'].every(key => body.confirmation[key] === true)) {
      throw new ApiError(409, 'REVIEW_REQUIRED', '현재 원고와 사진, 네이버 전송을 모두 확인해 주세요.')
    }
    const current = await config()
    const blogId = current.blogId
    if (body.blogId !== blogId) throw new ApiError(409, 'ACCOUNT_CHANGED', '대상 블로그가 변경되었습니다. 계정과 원고를 다시 확인해 주세요.')
    if (entry.rehearsalBlog && (entry.rehearsalBlog !== blogId || Object.keys(body.edits || {}).length || body.image)) {
      throw new ApiError(409, 'REHEARSAL_CHANGED', '테스트 발행에는 준비된 계정과 고정 원고·자료 사진을 사용해 주세요.')
    }
    const image = entry.rehearsalBlog
      ? { mimeType: 'image/jpeg', data: (await readFile(new URL('../public/samples/office-equipment.jpg', import.meta.url))).toString('base64') }
      : validateImage(body.image)
    let doc
    try { doc = buildBlogDocument(entry.result, entry.input, body.edits === undefined ? {} : body.edits) } catch (error) {
      throw new ApiError(400, 'INVALID_EDITS', error instanceof TypeError ? error.message : '편집 내용을 확인해 주세요.')
    }
    const fingerprint = createHash('sha256').update(JSON.stringify([blogId, doc, image.mimeType])).update(image.data).digest('hex')
    if (entry.attempt) {
      if (entry.attempt.fingerprint !== fingerprint) throw new ApiError(409, 'ARTICLE_CHANGED', '이미 전송을 요청한 초안입니다. 네이버에서 게시 상태를 확인해 주세요.')
      return entry.attempt.promise
    }
    if (!entry.rehearsalBlog) checkEvidence(entry.result, current)
    const attempt = { id: fingerprint, blogId, fingerprint, title: doc.title, dispatched: false }
    entry.attempt = attempt
    attempt.promise = (async () => {
      try {
        const { client, tools } = await discover()
        if (!tools.has(toolName())) throw unavailable()
        const args = {
          blogId, idempotencyKey: attempt.id, title: doc.title, tags: doc.tags, blocks: doc.blocks,
          html: renderBlogHtml(doc, { includeTitle: false }), markdown: renderBlogMarkdown(doc), image
        }
        const previous = await journal.reserve(fingerprint, attempt.id)
        if (previous) {
          attempt.id = previous.id || fingerprint
          return receipt(previous, blogId)
        }
        attempt.dispatched = true
        const output = await client.call(toolName(), args)
        if (output?.status === 'failed' && output.attempted === false) {
          await journal.release(fingerprint)
          attempt.dispatched = false
          rejectKnownFailure(output, mode() === 'local')
        }
        const outcome = receipt(output, blogId)
        if (mode() === 'local' && ['draft','uncertain'].includes(outcome.status) && typeof output?.message === 'string') outcome.message=output.message.slice(0,300)
        // The reservation still prevents duplicates if an outcome write fails.
        await journal.save(fingerprint, attempt.id, outcome).catch(() => {})
        return outcome
      } catch (error) {
        if (attempt.dispatched) return receipt(null, blogId)
        delete entry.attempt
        throw error instanceof ApiError ? error : unavailable()
      }
    })()
    return attempt.promise
  }

  async function publicationStatus(body) {
    const entry = find(body?.publish_token)
    const attempt = entry.attempt
    if (!attempt) throw new ApiError(409, 'NOT_SUBMITTED', '이 초안의 네이버 전송 기록이 없습니다.')
    const previous = await attempt.promise
    if (previous.status === 'published') return previous
    const current = await config()
    if (current.blogId !== attempt.blogId) return previous
    try {
      const { client, tools } = await discover()
      if (!tools.has('get_naver_publication')) return previous
      const args = { blogId: attempt.blogId, idempotencyKey: attempt.id }
      if (mode() === 'local') {
        args.title = attempt.title
        if (body.url) {
          args.url = verifiedLink(body.url, attempt.blogId)
          if (!args.url) return { ...previous, message:'대상 블로그에서 발행한 개별 게시물 주소를 입력해 주세요.' }
        }
      }
      const value = await client.call('get_naver_publication', args, 25000)
      const newer = receipt(value, attempt.blogId)
      if (newer.status === 'published') {
        attempt.promise = Promise.resolve(newer)
        await journal.save(attempt.fingerprint, attempt.id, newer).catch(() => {})
        return newer
      }
    } catch { /* A read failure must never replay a write. */ }
    return previous
  }

  return { remember, rehearsal, status, login, publish, publicationStatus, close() { pool.close(); drafts.clear() } }
}
