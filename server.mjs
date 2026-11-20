import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ApiError, generate } from './server/generate.mjs'
import { createPublisher } from './server/publishing.mjs'
import { getStudioConfig, handleStudioConfig, localRequest } from './server/studio-config.mjs'

const publicRoot = fileURLToPath(new URL('./public/', import.meta.url))
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

async function readJson(request, limit = 64 * 1024) {
  const invalid = () => new ApiError(400, 'INVALID_INPUT', '올바른 JSON 형식의 현장 정보를 보내 주세요.')
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw invalid()
  }
  const tooLarge = () => new ApiError(413, 'PAYLOAD_TOO_LARGE', '요청 크기를 줄여 다시 시도해 주세요.')
  if (Number(request.headers['content-length']) > limit) throw tooLarge()
  let byteLength = 0
  const chunks = []
  for await (const chunk of request) {
    byteLength += chunk.length
    if (byteLength > limit) throw tooLarge()
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw invalid()
  }
}

async function serveStatic(request, response, pathname) {
  let path
  try {
    const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).slice(1)
    path = resolve(publicRoot, relative)
    if (!path.startsWith(resolve(publicRoot) + sep) || !mime[extname(path)]) throw new Error('Unknown file')
    const bytes = await readFile(path)
    response.writeHead(200, { 'Content-Type': mime[extname(path)], 'Content-Length': bytes.length })
    response.end(request.method === 'HEAD' ? undefined : bytes)
  } catch {
    json(response, 404, { code: 'NOT_FOUND', message: '요청한 파일을 찾을 수 없습니다.' })
  }
}

async function publishingConfig() {
  const config = getStudioConfig()
  const load = async name => JSON.parse(await readFile(new URL('./server/' + name, import.meta.url), 'utf8'))
  return { ...config, facts: config.facts ?? await load('facts.json'), settings: config.settings ?? await load('settings.json') }
}

export function makeHandler(generateContent = generate, publisher = createPublisher({ getConfig: publishingConfig })) {
  const actions = new Map([
    ['/api/integrations', { method: 'GET', run: () => publisher.status() }],
    ['/api/integrations/naver/login', { method: 'POST', run: () => publisher.login() }],
    ['/api/publish/rehearsal', { method: 'POST', run: () => publisher.rehearsal() }],
    ['/api/publish/status', { method: 'POST', run: req => readJson(req).then(body => publisher.publicationStatus(body)) }],
    ['/api/publish', { method: 'POST', run: req => readJson(req, 12 * 1024 * 1024).then(body => publisher.publish(body)) }]
  ])
  const handler = async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname
      if (pathname === '/api/integrations/config') return await handleStudioConfig(request, response)
      const action = actions.get(pathname)
      if (action) {
        if (!localRequest(request)) return json(response, 403, { code: 'LOCAL_ONLY', message: '네이버 연동은 이 기기의 로컬 스튜디오에서 사용해 주세요.' })
        if (request.method !== action.method) {
          response.setHeader('Allow', action.method)
          return json(response, 405, { code: 'METHOD_NOT_ALLOWED', message: '지원하지 않는 요청입니다.' })
        }
        // Browser forms cannot trigger an operation across origins with a simple POST.
        if (action.method === 'POST' && request.headers['content-type']?.split(';')[0] !== 'application/json') {
          return json(response, 415, { code: 'INVALID_INPUT', message: 'JSON 요청이 필요합니다.' })
        }
        return json(response, 200, await action.run(request))
      }
      if (pathname === '/api/generate') {
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST')
          return json(response, 405, { code: 'METHOD_NOT_ALLOWED', message: 'POST 요청만 허용합니다.' })
        }
        const body = await readJson(request)
        return json(response, 200, publisher.remember(body, await generateContent(body)))
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD')
        return json(response, 405, { code: 'METHOD_NOT_ALLOWED', message: '지원하지 않는 요청입니다.' })
      }
      await serveStatic(request, response, pathname)
    } catch (error) {
      if (error instanceof ApiError) return json(response, error.status, { code: error.code, message: error.message })
      return json(response, 500, { code: 'SERVER_ERROR', message: '서버 설정을 확인한 뒤 다시 시도해 주세요.' })
    }
  }
  handler.close = () => publisher.close()
  return handler
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.HOST || '127.0.0.1'
  const port = Number(process.env.PORT || 3000)
  const handler = makeHandler()
  const server = createServer(handler)
  server.listen(port, host, () => {
    console.log('티링크 콘텐츠 스튜디오 http://' + host + ':' + port)
  })
  const shutdown = () => { handler.close(); server.close(); server.closeAllConnections() }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
