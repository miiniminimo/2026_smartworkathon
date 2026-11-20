import { studioApi } from './connections.js'
import { flattenedPhoto } from './article-editor.js'
const $=id=>document.getElementById(id)

export function setupPublisher(get) {
  const dialog=$('publish-confirm')
  const records=new Map()
  let frozen=null
  let displayedToken
  const note=(text)=>{$('publish-detail').textContent=text}
  function draw() {
    const s=get()
    const token=s.draft?.publish_token
    if (token!==displayedToken) { $('post-url').value='';displayedToken=token }
    const record=records.get(token)
    const status=record?.status
    const labels={sending:'전송 중',published:'발행 확인',draft:'편집기 전달',uncertain:'결과 확인 필요',failed:'전송 전 중단'}
    $('publish-state').textContent=labels[status] || (s.draft?.origin==='example'?'예시 원고':s.approved?'승인 완료':'승인 대기')
    $('publish-to-naver').disabled=!(s.approved && s.draft?.publish_token && s.blogId && s.connected && !s.editing) || Boolean(record && status!=='failed')
    $('check-publication').hidden=!['draft','uncertain'].includes(status)
    $('post-url-panel').hidden=$('check-publication').hidden || s.mode === 'http'
    const link=$('published-link')
    link.hidden=true;link.removeAttribute('href')
    if(status==='published' && record.url) {link.href=record.url;link.hidden=false}
    if(record?.message) note(record.message)
    else if(s.draft?.origin==='example') note('일반 예시는 외부로 전송하지 않습니다. 개인 계정 전송은 연결 설정에서 테스트 원고를 여세요.')
    else if(!s.blogId || !s.connected) note('연결 설정에서 블로그 ID와 발행 도구를 확인해 주세요.')
    else if (s.mode === 'http') note('대상 ' + s.blogId + ' · 외부 MCP를 통해 원고를 발행합니다. 전송 전 제목과 계정을 확인하세요.')
    else note('대상 ' + s.blogId + ' · 승인한 원고를 네이버 편집기로 옮긴 뒤, 네이버에서 공개 범위를 정하고 발행합니다.')
  }
  $('publish-to-naver').addEventListener('click',()=>{
    const s=get()
    if($('publish-to-naver').disabled || !s.approved || !s.draft?.publish_token) return
    frozen={token:s.draft.publish_token,blogId:s.blogId,doc:s.document}
    $('confirm-target').textContent=s.blogId; $('confirm-title').textContent=s.document.title
    $('confirm-delivery-note').textContent = s.mode === 'http'
      ? '확인하면 제목·본문·사진을 외부 MCP로 전송합니다. 도구 설정에 따라 선택한 계정에 즉시 발행될 수 있습니다.'
      : '확인하면 제목·본문·사진을 위 계정의 네이버 편집기로 옮깁니다. 네이버 창에서 공개 범위를 정하고 최종 발행해 주세요.'
    dialog.showModal()
  })
  $('cancel-send').addEventListener('click',()=>dialog.close())
  $('confirm-send').addEventListener('click',async()=>{
    const s=get(), target=frozen
    dialog.close()
    if(!target || !s.approved || !s.connected || s.editing || s.draft?.publish_token!==target.token || s.blogId!==target.blogId || s.document!==target.doc || $('publish-to-naver').disabled) return
    const payload={publish_token:target.token,blogId:target.blogId,edits:s.edits,confirmation:{content:true,photo:true,publish:true}}
    try {
      if(s.draft.origin!=='rehearsal') payload.image={mimeType:'image/jpeg',data:flattenedPhoto(s.image).split(',')[1]}
    } catch {note('사진을 첨부용 JPEG로 준비할 수 없습니다. 사진을 다시 선택해 주세요.');return}
    records.set(target.token,{status:'sending',message:s.mode === 'http' ? '외부 MCP에 승인한 원고와 사진을 보내고 있습니다.' : '승인한 원고와 사진을 네이버 편집기로 보내고 있습니다. 열린 네이버 창을 확인해 주세요.'})
    draw()
    try {
      const result=await studioApi('/api/publish',payload,145000)
      records.set(target.token,result)
    } catch(error) {
      // Unknown transport outcome must be checked instead of silently sending the article again.
      const retryable=['LOGIN_REQUIRED','EDITOR_UNAVAILABLE','ACCOUNT_CHANGED','REVIEW_REQUIRED','INVALID_PHOTO','INVALID_EDITS','ACCOUNT_MISMATCH','EVIDENCE_CHANGED','MCP_UNAVAILABLE','NAVER_NOT_CONFIGURED','DRAFT_EXPIRED','INVALID_PUBLICATION'].includes(error.code)
      records.set(target.token,{status:retryable?'failed':'uncertain',message:error.message})
    }
    draw()
  })
  $('check-publication').addEventListener('click',async()=>{
    const token=get().draft?.publish_token
    if(!token) return
    const control=$('check-publication')
    control.disabled=true
    try {
      const receipt=await studioApi('/api/publish/status',{publish_token:token,...($('post-url').value.trim() ? {url:$('post-url').value.trim()} : {})},35000)
      records.set(token,receipt);draw()
    } catch(error){note(error.message)} finally {control.disabled=false}
  })
  return {draw,locked:token=>Boolean(token && records.has(token) && records.get(token).status!=='failed')}
}
