import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getNaverBrowserContext as browserContext, disconnectNaverBrowser } from './naver-chrome.mjs'
import { blogLocation, confirmPost, fillEditor, findEditor } from './naver-editor.mjs'

const tools = [
  {name:'open_naver_login',description:'Open the dedicated local Chrome profile for the operator to log in to Naver.',inputSchema:{type:'object',properties:{blogId:{type:'string'}},required:['blogId']}},
  {name:'publish_naver_blog',description:'Transfer one approved article and its photo into the target SmartEditor. The operator selects visibility and confirms publishing in Naver.',inputSchema:{type:'object',properties:{blogId:{type:'string'},idempotencyKey:{type:'string'},title:{type:'string'},blocks:{type:'array'},tags:{type:'array'},html:{type:'string'},markdown:{type:'string'},image:{type:'object'}},required:['blogId','idempotencyKey','title','blocks','tags','image']}},
  {name:'get_naver_publication',description:'Verify the post permalink for a previously opened editor.',inputSchema:{type:'object',properties:{blogId:{type:'string'},idempotencyKey:{type:'string'},title:{type:'string'},url:{type:'string'}},required:['blogId','idempotencyKey']}}
]
const work = new Map()
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const opened = result => ({structuredContent:result,content:[{type:'text',text:JSON.stringify(result)}]})
const failed = (blogId, message, code='EDITOR_UNAVAILABLE') => ({status:'failed',attempted:false,blogId,code,message})
async function verifyOwner(page,blogId) {
  await page.goto('https://blog.naver.com/MyBlog.naver',{waitUntil:'domcontentloaded',timeout:16000})
  const until = Date.now()+8000
  while(Date.now()<until) {
    if (new URL(page.url()).hostname === 'nid.naver.com') return false
    const ids = page.frames().map(frame=>blogLocation(frame.url())?.blogId).filter(Boolean)
    if (ids.length) return ids.includes(blogId)
    await pause(230)
  }
  return false
}

async function trackedStatus(op) {
  const openedPages = [op.page,...op.popups]
  for (const page of openedPages) {
    const permalink = await confirmPost(page,op.blogId,op.title)
    if (permalink) return op.result = {status:'published',blogId:op.blogId,url:permalink,message:'네이버 게시물 주소와 제목을 확인했습니다.'}
  }
  return op.result
}
async function callTool(name,args) {
  const id = args.blogId
  if (!/^[\w-]{2,60}$/.test(id || '')) return failed('', '발행할 블로그 ID를 확인해 주세요.')
  if(name === 'get_naver_publication') {
    const op = work.get(args.idempotencyKey)
    if (op && op.blogId!==id) return failed(id,'대상 블로그가 일치하지 않습니다.','ACCOUNT_MISMATCH')
    if (args.url && (op?.title || args.title)) {
      const {confirmPostCandidate}=await import('./naver-editor.mjs')
      const ctx=await browserContext()
      const found=await confirmPostCandidate(ctx,args.url,id,op?.title || args.title)
      if (found) return {status:'published',blogId:id,url:found,message:'입력한 게시 주소에서 원고 제목을 확인했습니다.'}
    }
    if (!op) return {status:'uncertain',blogId:id,message:'발행한 게시물 주소를 입력해 계정과 제목을 대조해 주세요.'}
    return trackedStatus(op)
  }
  let ctx
  try { ctx = await browserContext() } catch { return failed(id,'로컬 Chrome을 열지 못했습니다. Chrome 설치와 전용 프로필 사용 상태를 확인해 주세요.') }
  if(name === 'open_naver_login') {
    const page = await ctx.newPage()
    await page.goto('https://nid.naver.com/nidlogin.login?url='+encodeURIComponent('https://blog.naver.com/MyBlog.naver'),{waitUntil:'domcontentloaded',timeout:20000})
    await page.bringToFront()
    return {status:'opened',blogId:id,message:'열린 네이버 창에서 로그인한 뒤 스튜디오로 돌아오세요.'}
  }
  if(name !== 'publish_naver_blog') throw Error('Unknown tool')
  if (!args.idempotencyKey || !args.title || !Array.isArray(args.blocks) || !args.image?.data) return failed(id,'발행 원고 형식이 올바르지 않습니다.')
  const prior = work.get(args.idempotencyKey)
  if(prior) return trackedStatus(prior)
  const page = await ctx.newPage()
  let partial = false
  let stage='계정 확인'
  const op = {page,blogId:id,title:args.title,popups:[],result:{status:'uncertain',blogId:id,message:'네이버 편집기 상태를 확인하고 있습니다.'}}
  page.on('popup',popup=>op.popups.push(popup))
  try {
    if (!await verifyOwner(page,id)) return failed(id,'로그인한 내 블로그와 대상 ID를 일치시킬 수 없습니다. 연결 설정에서 대상 계정으로 로그인해 주세요.','LOGIN_REQUIRED')
    stage='글쓰기 창 열기'
    await page.goto('https://blog.naver.com/PostWriteForm.naver?blogId='+encodeURIComponent(id),{waitUntil:'domcontentloaded',timeout:18000})
    await page.bringToFront()
    stage='빈 편집기 확인'
    const frame = await findEditor(page)
    const transfer = await fillEditor(frame,args,()=>{partial=true;stage='본문·사진 입력';work.set(args.idempotencyKey,op)})
    op.result = {status:'draft',blogId:id,layout:transfer.layout,message:transfer.layout === 'review'
      ? '배치 대조 필요 · ' + transfer.detail
      : '제목·본문·사진을 네이버 편집기에 전달했습니다. 네이버 창에서 공개 범위를 고르고 발행한 뒤 게시 상태를 확인해 주세요.'}
    // Return control to the studio immediately; "게시 상태 확인" observes the actual permalink.
    return await trackedStatus(op)
  } catch (err) {
    const hint = /^네이버|^편집기|^글쓰기|^빈 |^사진과/.test(err.message) ? err.message : '네이버 편집기의 입력 위치 또는 응답을 확인하지 못했습니다.'
    let counts=''
    if (partial) {
      for (const frame of page.frames()) {
        if (!/^https:\/\/blog\.naver\.com\//.test(frame.url())) continue
        const state=await frame.evaluate(() => {
          const root=document.querySelector('.se-components-wrap,.se-main-container')
          return root ? {paragraphs:root.querySelectorAll('.se-component.se-text .se-text-paragraph').length,photos:root.querySelectorAll('.se-component.se-image img').length} : null
        }).catch(()=>null)
        if (state) {counts=' (본문 문단 '+state.paragraphs+'개, 사진 '+state.photos+'장)';break}
      }
      return op.result = {status:'uncertain',blogId:id,message:stage+' 단계 · '+hint+counts+' 네이버 창의 원고를 직접 확인해 주세요.'}
    }
    return failed(id,stage+' 단계 · '+hint)
  }
}

async function serve() {
  const input=createInterface({input:process.stdin,crlfDelay:Infinity})
  const send = value => process.stdout.write(JSON.stringify(value)+'\n')
  for await(const line of input) {
    let req
    try {
      req=JSON.parse(line)
      if(req.id===undefined) continue
      let result
      if(req.method==='initialize') result={protocolVersion:['2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(req.params?.protocolVersion)?req.params.protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'tlink-naver-smarteditor',version:'1.0.0'}}
      else if(req.method==='tools/list') result={tools}
      else if(req.method==='tools/call') result=opened(await callTool(req.params.name,req.params.arguments || {}))
      else if(req.method==='ping') result={}
      else {send({jsonrpc:'2.0',id:req.id,error:{code:-32601,message:'Method not found'}});continue}
      send({jsonrpc:'2.0',id:req.id,result})
    } catch {send({jsonrpc:'2.0',id:req?.id ?? null,error:{code:-32603,message:'브라우저 연결 작업을 마치지 못했습니다.'}})}
  }
  await disconnectNaverBrowser()
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) await serve()
