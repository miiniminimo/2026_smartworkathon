const $ = id => document.getElementById(id)

export async function studioApi(path, body, timeout = 20000) {
  let response
  try {
    response = await fetch(path, { method:body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { headers:{'Content-Type':'application/json'},body:JSON.stringify(body) }),
      signal:AbortSignal.timeout(timeout), cache:'no-store'
    })
  } catch {
    throw Error('서버 응답을 확인할 수 없습니다. 연결 상태를 확인해 주세요.')
  }
  const result = await response.json()
  if (!response.ok) throw Object.assign(Error(result.message || '요청에 실패했습니다.'), {code:result.code})
  return result
}

export function setupConnections(onChange,onRehearsal) {
  const dialog = $('connections')
  let config
  let state
  async function refresh(fill = false) {
    const [next, nextConfig] = await Promise.all([studioApi('/api/integrations'),studioApi('/api/integrations/config')])
    config = nextConfig
    state = next
    $('ai-state').textContent = config.keyVerified ? config.model + ' · 키 확인됨' : next.openai.configured ? config.model + ' · 키 설정됨' : '키 입력 필요'
    const remote = next.naver.mode === 'http'
    const transport = remote ? '외부 MCP' : '로컬 편집기 MCP'
    $('mcp-state').textContent = next.naver.connected ? transport + ' 연결됨' : transport + ' · ' + (next.naver.message || '연결 필요')
    $('login-naver').hidden = remote
    $('account-state').textContent = next.naver.blogId ? next.naver.blogId + ' · 발행 대상' : '블로그 ID 입력 필요'
    $('connection-status').textContent = next.naver.connected
      ? (next.openai.configured ? 'AI·MCP 연결' : 'MCP 연결')
      : '설정 확인'
    $('login-naver').disabled = !next.naver.configured || next.naver.mode === 'http'
    $('start-rehearsal').disabled = !next.naver.connected
    if (fill) {
      for (const [id,key] of Object.entries({'model-name':'model','blog-id':'blogId','fact-text':'factText','fact-source':'factSource','fact-reviewer':'reviewer','cta-text':'cta'})) $(id).value = config[key] || ''
      $('confirm-fact').checked = false
    }
    onChange(next)
    return next
  }
  const feedback = message => { $('connection-feedback').textContent = message }
  const open = async () => {
    if (!dialog.open) dialog.showModal()
    feedback('연결 상태 확인 중…')
    try { await refresh(true); feedback('키와 화면에서 입력한 설정은 현재 서버 세션에 보관됩니다.') }
    catch(error) { feedback(error.message) }
  }
  $('open-connections').addEventListener('click',open)
  $('open-publish-connections').addEventListener('click',open)
  $('close-connections').addEventListener('click',()=>dialog.close())
  dialog.addEventListener('close',()=>{ $('api-key').value='' })
  $('refresh-connections').addEventListener('click',async () => {
    try { await refresh(); feedback('서버와 발행 도구 상태를 확인했습니다.') } catch(error){feedback(error.message)}
  })
  $('settings-form').addEventListener('submit',async event => {
    event.preventDefault()
    const save = $('save-connections')
    if(save.disabled) return
    const payload = {model:$('model-name').value,blogId:$('blog-id').value.trim()}
    const key = $('api-key').value.trim()
    if(key) payload.apiKey = key
    const review = {text:$('fact-text').value,source:$('fact-source').value,reviewer:$('fact-reviewer').value,cta:$('cta-text').value,confirmed:$('confirm-fact').checked}
    const changed = review.text !== (config?.factText || '') || review.source !== (config?.factSource || '') || review.reviewer !== (config?.reviewer || '') || review.cta !== (config?.cta || '')
    if(changed || review.confirmed) payload.review=review
    save.disabled=true; feedback('설정과 모델 접근 권한을 확인하고 있습니다…')
    try {
      await studioApi('/api/integrations/config',payload)
      $('api-key').value=''
      await refresh(true)
      feedback(state?.naver.mode === 'http' ? '설정을 저장했습니다. 외부 MCP의 발행 대상 계정을 확인하세요.' : '설정을 저장했습니다. 네이버 로그인은 전용 창에서 진행하세요.')
    } catch(error){ feedback(error.message) } finally {save.disabled=false}
  })
  $('login-naver').addEventListener('click',async () => {
    const button=$('login-naver')
    button.disabled=true;feedback('전용 네이버 로그인 창을 열고 있습니다…')
    try {
      const result=await studioApi('/api/integrations/naver/login',{},55000)
      feedback(result.message || '네이버 창에서 로그인한 뒤 스튜디오로 돌아오세요.')
    } catch(error){ feedback(error.message) } finally { button.disabled=!state?.naver.configured || state?.naver.mode === 'http' }
  })
  $('start-rehearsal').addEventListener('click',async () => {
    const button=$('start-rehearsal')
    button.disabled=true
    try {
      const result=await studioApi('/api/publish/rehearsal',{})
      dialog.close()
      await onRehearsal(result)
    } catch(error){ if(!dialog.open) dialog.showModal(); feedback(error.message) } finally { button.disabled=!state?.naver.connected }
  })
  refresh().catch(error=>{ $('connection-status').textContent='연결 확인 필요';feedback(error.message) })
  return {refresh}
}
