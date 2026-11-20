import { readFile } from 'node:fs/promises'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

try { loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url))) } catch (error) { if (error.code !== 'ENOENT') throw error }

const session = { facts: null, settings: null }
let verifiedPair = null
let saving = false
const trimmed = value => typeof value === 'string' ? value.trim() : ''
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

export function getStudioConfig() {
  return {
    ...session, apiKey: session.apiKey || process.env.OPENAI_API_KEY || '',
    blogId: session.blogId ?? process.env.NAVER_BLOG_ID ?? '',
    model: session.model || process.env.OPENAI_MODEL || 'gpt-6.2-astra'
  }
}

export function localRequest(req) {
  const addr = req.socket?.remoteAddress
  if (!['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(addr)) return false
  try {
    const host = new URL('http://' + req.headers.host)
    if (!localHosts.has(host.hostname)) return false
    const origin = req.headers.origin
    return (!origin || origin === host.origin) && req.headers['sec-fetch-site'] !== 'cross-site'
  } catch { return false }
}

const serverFile = async name => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'))

async function publicSettings() {
  const { apiKey, model, blogId, facts, settings } = getStudioConfig()
  const available = facts ?? await serverFile('facts.json')
  const approved = available.filter(f => f.product === '녹취 제품' && f.status === 'approved' && [f.id, f.text, f.source, f.approved_by].every(trimmed))
  const config = settings ?? await serverFile('settings.json')
  const selected = approved.find(f => f.id === 'studio-confirmed') || approved[0]
  return {
    model, blogId, keyConfigured: Boolean(apiKey),
    keyVerified: Boolean(verifiedPair && verifiedPair.key === apiKey && verifiedPair.model === model),
    factCount: approved.length, factText: selected?.text || '', factSource: selected?.source || '',
    reviewer: selected?.approved_by || '', cta: config.cta?.confirmed ? config.cta.text : ''
  }
}

function failure(status, message) { return Object.assign(new Error(message), { status }) }
async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw failure(415,'JSON 형식이 필요합니다.')
  let length = 0
  const chunks = []
  for await (const c of req) {
    length += Buffer.byteLength(c)
    if (length > 16_384) throw failure(413, '설정값이 너무 깁니다.')
    chunks.push(Buffer.from(c))
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString())
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body
  } catch { throw failure(400, '설정값을 읽을 수 없습니다.') }
}

async function save(body) {
  const previous = getStudioConfig()
  const next = {}
  const key = trimmed(body.apiKey) || previous.apiKey
  const model = trimmed(body.model) || previous.model
  if (!/^[\w.:-]{1,120}$/.test(model)) throw failure(400,'모델 ID를 확인해 주세요.')
  const blogId = body.blogId === undefined ? previous.blogId : trimmed(body.blogId)
  if (blogId && !/^[a-z\d_-]{2,60}$/i.test(blogId)) throw failure(400,'네이버 블로그 주소 끝의 블로그 ID만 입력해 주세요.')
  Object.assign(next, { model, blogId })
  if (body.review) {
    const {text,source,reviewer,cta,confirmed} = body.review
    if (confirmed !== true || ![text,source,reviewer,cta].every(x => trimmed(x) && x.length <= 1500)) throw failure(400,'제품 문구·원문 위치·확인자·상담 안내를 입력하고 원문 확인을 선택해 주세요.')
    const records = previous.facts ?? await serverFile('facts.json')
    next.facts = [...records.filter(f => f.id !== 'studio-confirmed'), {id:'studio-confirmed', product:'녹취 제품', text:text.trim(), source:source.trim(), approved_by:reviewer.trim(), status:'approved'}]
    next.settings = {...(previous.settings ?? await serverFile('settings.json')), cta:{text:cta.trim(),confirmed:true}}
  }
  if (key && (!verifiedPair || verifiedPair.key !== key || verifiedPair.model !== model)) {
    let result
    try {
      result = await fetch('https://api.openai.com/v1/models/' + encodeURIComponent(model), {
        headers: {Authorization:'Bearer ' + key}, signal: AbortSignal.timeout(12000)
      })
    } catch { throw failure(503,'OpenAI에 연결하지 못했습니다. 네트워크를 확인해 주세요.') }
    if (!result.ok) throw failure(400, result.status === 401 ? 'OpenAI가 API 키를 승인하지 않았습니다.' : '이 키로 선택한 모델에 접근할 수 없습니다. 모델 ID와 프로젝트 권한을 확인해 주세요.')
    verifiedPair = {key,model}
  }
  if (trimmed(body.apiKey)) next.apiKey = key
  Object.assign(session, next)
}

export async function handleStudioConfig(req,res) {
  const reply = (status, payload) => {
    res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'})
    res.end(JSON.stringify(payload))
  }
  if (!localRequest(req)) return reply(403,{message:'연결 설정은 이 기기의 로컬 스튜디오에서 열어 주세요.'})
  if (!['GET','POST'].includes(req.method)) return reply(405,{message:'지원하지 않는 요청입니다.'})
  if (req.method === 'POST' && saving) return reply(409,{message:'다른 설정을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.'})
  const mutating = req.method === 'POST'
  try {
    if (mutating) { saving = true; await save(await readBody(req)) }
    reply(200,await publicSettings())
  } catch (error) {
    reply(error.status || 500,{message:error.status ? error.message : '연결 설정을 읽을 수 없습니다.'})
  } finally { if (mutating) saving = false }
}

