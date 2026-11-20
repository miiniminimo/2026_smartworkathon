import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const version = '2025-11-25'
const supportedVersions = new Set([version, '2025-06-18', '2025-03-26'])
const deadlineMs = 8000
const responseLimit = 2 * 1024 * 1024

function rpcResult(message, id) {
  if (message?.jsonrpc !== '2.0' || message.id !== id || message.error || !('result' in message)) {
    throw new Error('MCP response did not match request')
  }
  return message.result
}

// One persistent child owns the dedicated local browser session. No shell is involved.
export class StdioTransport {
  constructor(command = process.execPath, args = [fileURLToPath(new URL('./naver-browser-mcp.mjs', import.meta.url))]) {
    this.child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
    this.pending = new Map()
    this.buffer = ''
    this.closed = false
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', chunk => this.read(chunk))
    this.child.stdin.on('error', () => this.close())
    this.child.once('error', () => this.close())
    this.child.once('exit', () => this.close())
  }

  read(chunk) {
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer) > responseLimit) return this.close()
    let cut
    while ((cut = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, cut).trim()
      this.buffer = this.buffer.slice(cut + 1)
      if (!line) continue
      let message
      try { message = JSON.parse(line) } catch { return this.close() }
      const waiter = this.pending.get(message.id)
      if (waiter && !message.method) {
        this.pending.delete(message.id)
        waiter.resolve(message)
      }
    }
  }

  async send(message, timeoutMs) {
    if (this.closed) throw new Error('Local MCP stopped')
    if (message.id === undefined) {
      this.child.stdin.write(JSON.stringify(message) + '\n')
      return
    }
    let timer
    try {
      return await new Promise((resolve, reject) => {
        this.pending.set(message.id, { resolve, reject })
        timer = setTimeout(() => reject(new Error('MCP deadline exceeded')), timeoutMs)
        this.child.stdin.write(JSON.stringify(message) + '\n', err => { if (err) reject(err) })
      })
    } finally {
      clearTimeout(timer)
      this.pending.delete(message.id)
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.child.stdin.destroy()
    this.child.kill()
    for (const waiter of this.pending.values()) waiter.reject(new Error('Local MCP stopped'))
    this.pending.clear()
  }
}

export class HttpTransport {
  constructor(endpoint, token = '', fetchImpl = fetch) {
    const url = new URL(endpoint)
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    if (url.username || url.password || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) {
      throw new Error('MCP endpoint requires HTTPS or local HTTP')
    }
    this.endpoint = url
    this.token = token
    this.fetch = fetchImpl
    this.session = ''
    this.version = ''
  }

  async send(message, timeoutMs) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
    if (this.token) headers.Authorization = 'Bearer ' + this.token
    if (this.session) headers['Mcp-Session-Id'] = this.session
    if (this.version) headers['MCP-Protocol-Version'] = this.version
    const response = await this.fetch(this.endpoint, {
      method: 'POST', redirect: 'error', headers, body: JSON.stringify(message),
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error('MCP HTTP ' + response.status)
    }
    if (message.method === 'initialize') this.session = response.headers.get('Mcp-Session-Id') || ''
    if (message.id === undefined) { await response.body?.cancel(); return }
    const sse = response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')
    const decoder = new TextDecoder()
    let buffer = ''
    let size = 0
    // SSE endpoints may leave the stream open after a reply. Resolve on this request's result.
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > responseLimit) throw new Error('Oversized MCP response')
      buffer += decoder.decode(chunk, { stream: true })
      if (sse) {
        let boundary
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const event = buffer.slice(0, boundary.index)
          buffer = buffer.slice(boundary.index + boundary[0].length)
          const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
          if (!data) continue
          const payload = JSON.parse(data)
          if (payload.id === message.id && !payload.method) return payload
        }
      }
    }
    if (sse) throw new Error('MCP response ended without a result')
    return JSON.parse(buffer + decoder.decode())
  }

  close() {
    if (!this.session) return
    const headers = { 'Mcp-Session-Id': this.session, 'MCP-Protocol-Version': this.version || version }
    if (this.token) headers.Authorization = 'Bearer ' + this.token
    this.session = ''
    this.fetch(this.endpoint, { method: 'DELETE', redirect: 'error', headers, signal: AbortSignal.timeout(2000) })
      .then(response => response.body?.cancel()).catch(() => {})
  }
}

export class McpClient {
  constructor(transport) { this.transport = transport; this.nextId = 0 }

  async request(method, params, timeoutMs = deadlineMs) {
    const id = ++this.nextId
    const response = await this.transport.send({ jsonrpc: '2.0', id, method, params }, timeoutMs)
    return rpcResult(response, id)
  }

  async initialize() {
    const init = await this.request('initialize', {
      protocolVersion: version, capabilities: {}, clientInfo: { name: 'tlink-content-studio', version: '1.0.0' }
    })
    if (!supportedVersions.has(init.protocolVersion) || !init.capabilities?.tools) throw new Error('Unsupported MCP server')
    this.transport.version = init.protocolVersion
    await this.transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' }, deadlineMs)
  }

  async tools() {
    const names = new Set()
    const seen = new Set()
    let cursor
    do {
      const page = await this.request('tools/list', cursor ? { cursor } : {})
      if (!Array.isArray(page.tools)) throw new Error('Invalid MCP tool list')
      for (const tool of page.tools) if (typeof tool?.name === 'string') names.add(tool.name)
      cursor = page.nextCursor
      if (cursor && (typeof cursor !== 'string' || seen.has(cursor) || seen.size >= 100)) throw new Error('Invalid MCP pagination')
      seen.add(cursor)
    } while (cursor)
    return names
  }

  async call(name, args, timeoutMs = 120000) {
    const reply = await this.request('tools/call', { name, arguments: args }, timeoutMs)
    let payload = reply.structuredContent
    if (!payload) {
      const text = reply.content?.find(item => item.type === 'text')?.text
      try { payload = JSON.parse(text) } catch { throw new Error('Missing structured MCP result') }
    }
    if (reply.isError && !(payload.status === 'failed' && payload.attempted === false)) throw new Error('MCP tool error')
    return payload
  }

  close() { this.transport.close() }
}

export function createConnectionPool({ env = process.env, makeTransport } = {}) {
  let slot
  function close() {
    if (slot) slot.client.close()
    slot = undefined
  }
  async function connect() {
    const key = JSON.stringify([env.NAVER_MCP_URL || '', env.NAVER_MCP_TOKEN || ''])
    if (!slot || slot.key !== key || slot.client.transport.closed) {
      close()
      const transport = makeTransport ? makeTransport() : env.NAVER_MCP_URL
        ? new HttpTransport(env.NAVER_MCP_URL, env.NAVER_MCP_TOKEN)
        : new StdioTransport()
      const client = new McpClient(transport)
      const entry = { key, client, ready: client.initialize() }
      slot = entry
      try { await entry.ready } catch (error) { if (slot === entry) close(); throw error }
    }
    const active = slot
    await active.ready
    return active.client
  }

  return {
    async discover() {
      // Reconnect only during discovery, before a write tool has received any article.
      for (let attempt = 0; ; attempt++) {
        let client
        try {
          client = await connect()
          return { client, tools: await client.tools() }
        } catch (error) {
          if (slot?.client === client) close()
          if (attempt) throw error
        }
      }
    },
    close
  }
}
