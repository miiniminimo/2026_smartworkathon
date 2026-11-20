import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { buildExample } from '../public/outputs.js'
import { makeHandler } from '../server.mjs'
import { createPublisher, publicationJournal } from './publishing.mjs'
import { HttpTransport, McpClient, StdioTransport } from './publishing-mcp.mjs'

const account = 'studio-fixture'
const input = { installation_type:'new', region:'서울', field_note:'' }
const fact = { id:'T', status:'approved', product:'녹취 제품', text:'테스트 확인 문구', source:'테스트 원문', approved_by:'테스트 담당자' }
const config = () => ({ apiKey:'test-secret-never-return', model:'test-model', blogId:account, facts:[{...fact}], settings:{cta:{text:'테스트 상담 안내',confirmed:true}} })
const draft = () => ({
  ...buildExample(), origin:'model', cta_text:'테스트 상담 안내', used_facts:[{id:fact.id,text:fact.text,source:fact.source}]
})
const image = {mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9W8QADsAAAAASUVORK5CYII='}
const confirmation = { content:true, photo:true, publish:true }
const output = {status:'published',blogId:account,url:'https://blog.naver.com/'+account+'/1023'}

async function fixture(t, call = async () => output) {
  const dir = await mkdtemp(join(tmpdir(),'studio-publish-'))
  t.after(() => rm(dir,{recursive:true,force:true}))
  const current = config()
  const calls = []
  const tools = new Set(['publish_naver_blog','get_naver_publication','open_naver_login'])
  const client = { async call(name,args) { calls.push({name,args}); return call(name,args) } }
  const pool = { async discover() { return {client,tools} }, close() {} }
  const fresh = () => createPublisher({getConfig:async()=>current,env:{},pool,journal:publicationJournal(dir)})
  const service = fresh()
  const token = service.remember(input,draft()).publish_token
  return {service,current,calls,tools,fresh,req:{publish_token:token,blogId:account,image,confirmation,edits:{}}}
}

test('publish requires a server-issued live token, three explicit checks, destination and unchanged approved facts',async t=>{
  const {service,current,calls,req} = await fixture(t)
  assert.equal(service.remember(input,buildExample()).publish_token,undefined)
  await assert.rejects(service.publish({...req,publish_token:'fake'}),{code:'DRAFT_EXPIRED'})
  for (const key of Object.keys(confirmation)) {
    await assert.rejects(service.publish({...req,confirmation:{...confirmation,[key]:false}}),{code:'REVIEW_REQUIRED'})
  }
  await assert.rejects(service.publish({...req,blogId:'wrong'}),{code:'ACCOUNT_CHANGED'})
  await assert.rejects(service.publish({...req,edits:{'fact-T':'대체'}}),{code:'INVALID_EDITS'})
  await assert.rejects(service.publish({...req,image:{mimeType:'image/jpeg',data:image.data}}),{code:'INVALID_PHOTO'})
  current.facts[0].status = 'pending'
  await assert.rejects(service.publish(req),{code:'EVIDENCE_CHANGED'})
  assert.equal(calls.length,0)
})

test('concurrent publication and restart use one operation, only canonical approved document is sent',async t=>{
  const {service,calls,req,fresh} = await fixture(t)
  const body={...req,edits:{title:'확인한 새 제목'},html:'<script>discard</script>'}
  const [first,second]=await Promise.all([service.publish(body),service.publish(body)])
  assert.deepEqual(first,second)
  assert.equal(first.status,'published')
  assert.equal(first.url,output.url)
  assert.equal(calls.length,1)
  assert.equal(calls[0].args.title,'확인한 새 제목')
  assert.ok(calls[0].args.html.includes(fact.text))
  assert.ok(!calls[0].args.html.includes('<script>'))
  assert.deepEqual(calls[0].args.image,image)
  await assert.rejects(service.publish({...body,edits:{title:'다른 제목'}}),{code:'ARTICLE_CHANGED'})
  const restarted=fresh()
  const token=restarted.remember(input,draft()).publish_token
  assert.equal((await restarted.publish({...body,publish_token:token})).status,'published')
  assert.equal(calls.length,1)
})

test('ambiguous publication cannot replay; optional read tool may confirm account-specific permalink',async t=>{
  const {service,calls,req}=await fixture(t,async name=>{
    if(name==='get_naver_publication') return output
    throw new Error('Connection lost after write')
  })
  assert.equal((await service.publish(req)).status,'uncertain')
  assert.equal((await service.publish(req)).status,'uncertain')
  assert.equal(calls.length,1)
  assert.equal((await service.publicationStatus(req)).status,'published')
  assert.deepEqual(calls.map(c=>c.name),['publish_naver_blog','get_naver_publication'])
})

test('a wrong-blog permalink or editing URL cannot mark a post as published',async t=>{
  for(const url of ['https://blog.naver.com/wrong/1023','https://example.com/'+account+'/1023',
    'https://blog.naver.com/'+account,'https://blog.naver.com/PostWriteForm.naver?blogId='+account]){
    const {service,req}=await fixture(t,async()=>({...output,url}))
    assert.equal((await service.publish(req)).status,'uncertain')
  }
})

test('known login failure before any editor write permits a safe explicit retry',async t=>{
  let signedIn=false
  const {service,calls,req}=await fixture(t,async()=>signedIn?output:{status:'failed',attempted:false,code:'LOGIN_REQUIRED'})
  await assert.rejects(service.publish(req),{code:'LOGIN_REQUIRED'})
  signedIn=true
  assert.equal((await service.publish(req)).status,'published')
  assert.equal(calls.length,2)
})

test('fixed rehearsal accepts no arbitrary photo/edits and never needs live product evidence or model access',async t=>{
  const {service,current,calls}=await fixture(t)
  current.facts=[]
  current.settings={}
  current.apiKey=''
  const prepared=await service.rehearsal()
  assert.equal(prepared.origin,'rehearsal')
  const body={publish_token:prepared.publish_token,blogId:account,confirmation}
  await assert.rejects(service.publish({...body,image}),{code:'REHEARSAL_CHANGED'})
  await assert.rejects(service.publish({...body,edits:{title:'new'}}),{code:'REHEARSAL_CHANGED'})
  assert.equal((await service.publish(body)).status,'published')
  assert.equal(calls[0].args.title,prepared.brief.headline)
  const bytes=await readFile(new URL('../public/samples/office-equipment.jpg',import.meta.url))
  assert.deepEqual(Buffer.from(calls[0].args.image.data,'base64'),bytes)
})

test('MCP HTTP negotiates, authenticates, reads paginated tools and consumes JSON and SSE',async()=>{
  const messages=[]
  const mock=async(url,options)=>{
    assert.equal(options.redirect,'error')
    assert.equal(options.headers.Authorization,'Bearer secret')
    assert.match(options.headers.Accept,/text\/event-stream/)
    const msg=JSON.parse(options.body)
    messages.push(msg)
    if(msg.method==='initialize') return Response.json({jsonrpc:'2.0',id:msg.id,result:{protocolVersion:'2025-11-25',capabilities:{tools:{}}}},{headers:{'mcp-session-id':'session'}})
    assert.equal(options.headers['Mcp-Session-Id'],'session')
    assert.equal(options.headers['MCP-Protocol-Version'],'2025-11-25')
    if(msg.method==='notifications/initialized') return new Response(null,{status:202})
    if(msg.method==='tools/list') return Response.json({jsonrpc:'2.0',id:msg.id,result:msg.params.cursor?{tools:[{name:'publish_naver_blog'}]}:{tools:[],nextCursor:'next'}})
    const result={jsonrpc:'2.0',id:msg.id,result:{structuredContent:output,content:[]}}
    return new Response(': ready\r\n\r\ndata: '+JSON.stringify(result)+'\r\n\r\n',{headers:{'content-type':'text/event-stream'}})
  }
  const cli=new McpClient(new HttpTransport('https://test.invalid/mcp','secret',mock))
  await cli.initialize()
  assert.ok((await cli.tools()).has('publish_naver_blog'))
  assert.deepEqual(await cli.call('publish_naver_blog',{}),output)
  assert.deepEqual(messages.map(v=>v.method),['initialize','notifications/initialized','tools/list','tools/list','tools/call'])
  assert.throws(()=>new HttpTransport('http://unsafe.invalid/mcp'))
})

test('MCP stdio uses one persistent child for sequential requests',async t=>{
  const source = [
    'import {createInterface} from "node:readline";',
    'let calls=0;for await (const line of createInterface({input:process.stdin})){',
    'const m=JSON.parse(line);if(m.id===undefined)continue;',
    'const result=m.method==="initialize"?{protocolVersion:"2025-11-25",capabilities:{tools:{}}}:',
    'm.method==="tools/list"?{tools:[{name:"status"}]}:{structuredContent:{calls:++calls}};',
    'console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result}));}'
  ].join('\n')
  const cli = new McpClient(new StdioTransport(process.execPath,['--input-type=module','-e',source]))
  t.after(()=>cli.close())
  await cli.initialize()
  assert.ok((await cli.tools()).has('status'))
  assert.equal((await cli.call('status',{})).calls,1)
  assert.equal((await cli.call('status',{})).calls,2)
})

test('local HTTP integration rejects cross-origin writes, never returns the API key, and permits fixed rehearsal',async t=>{
  const {service}=await fixture(t)
  const handler=makeHandler(async()=>draft(),service)
  async function req(path,method='GET',origin='http://127.0.0.1:3000'){
    const r=Readable.from([Buffer.from('{}')])
    Object.assign(r,{method,url:path,headers:{host:'127.0.0.1:3000',origin,'content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}})
    const res={setHeader(){},writeHead(s){this.status=s},end(data){this.payload=JSON.parse(data)}}
    await handler(r,res)
    return res
  }
  assert.equal((await req('/api/publish/rehearsal','POST','https://elsewhere.invalid')).status,403)
  const status=await req('/api/integrations')
  assert.equal(status.payload.naver.connected,true)
  assert.ok(!JSON.stringify(status.payload).includes('test-secret'))
  assert.equal((await req('/api/publish/rehearsal','POST')).payload.origin,'rehearsal')
  assert.equal((await req('/api/publish','GET')).status,405)
})
