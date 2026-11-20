import { buildExample, formatChannels, renderCard } from './outputs.js'
import { mountIcons, showIcon } from './icons.js'
import { setupArticleEditor, flattenedPhoto } from './article-editor.js'
import { setupConnections } from './connections.js'
import { setupPublisher } from './publish-ui.js'
import { renderBlogHtml } from './blog-format.js'
import { reviewPolicy } from './review.js'
import { sampleCases } from './sample-cases.js'

const $ = id => document.getElementById(id)
const form = $('case-form')
const status = $('status')
const canvas = $('card-canvas')
const copyCheck = $('check-copy')
const photoCheck = $('check-photo')
const generate = $('generate')
const example = $('example')
const approve = $('approve')
const exportButton = $('export')
const tabs = [...document.querySelectorAll('[role=tab]')]
const steps = [...document.querySelectorAll('.steps li')]
const channels = {
  card: { title: '갤러리 카드', format: '1080 × 1080 px · PNG', action: 'PNG 저장', icon: 'download' },
  blog: { title: '블로그 본문', format: '네이버 블로그 · 서식 원고', action: '서식 복사', icon: 'copy' },
  sms: { title: '문자 초안', format: '티링크노트 · 텍스트', action: '발송용 복사', icon: 'copy' }
}

let tab = 'blog'
let articleEdits = {}
let connection = null
let editor
let publisher
let image = null
let imageUrl = null
let photoFile = null
let activeSample = null
let manualInputs = null
let photoRevision = 0
let revision = 0
let request = null
let draft = null
let texts = null
let accepted = false
let needsGeneration = false
let generationError = ''
let startTime = null
let endTime = null
let exportToken = 0
let exporting = false

function readInput() {
  return {
    installation_type: new FormData(form).get('install') || '',
    region: $('region').value.trim(),
    field_note: $('note').value.trim()
  }
}

function hasInput() {
  return Boolean(image && (activeSample?.rehearsal || form.elements.install.value))
}

function isExample() {
  return draft?.origin === 'example'
}

function currentReview() {
  return reviewPolicy({
    result: hasInput() ? draft : null,
    tab, copyReviewed: copyCheck.checked, photoReviewed: photoCheck.checked, accepted
  })
}

function message(element, value) {
  element.textContent = value
  element.hidden = !value
}

function updateControls() {
  const policy = currentReview()
  generate.disabled = example.disabled = !hasInput() || Boolean(request)
  example.hidden = Boolean(activeSample)
  $('exit-sample').hidden = !activeSample
  $('recovery-actions').hidden = !generationError || Boolean(request)
  generate.querySelector('span').textContent = request ? '초안 생성 중…' : generationError ? '다시 시도' : draft || needsGeneration ? '초안 3종 다시 만들기' : '초안 3종 만들기'
  if (activeSample) generate.querySelector('span').textContent = '예시 초안 다시 보기'
  const pendingEdits = Boolean(editor?.hasUnsaved())
  copyCheck.disabled = photoCheck.disabled = !draft || pendingEdits
  approve.disabled = accepted || !policy.canApprove || pendingEdits
  approve.textContent = isExample() ? '데모 검토 완료' : '검토 완료·승인'
  exportButton.disabled = exporting || !policy.canExport || pendingEdits
  $('lock-reason').textContent = pendingEdits ? '수정한 원고를 반영하거나 취소한 뒤 검토해 주세요.' : policy.lockReason
  const state = request ? ['생성 중', 'loading']
    : generationError ? ['생성 실패', 'error']
    : draft?.origin === 'rehearsal' ? ['개인 계정 테스트', 'demo']
    : isExample() ? ['예시 결과', 'demo']
    : accepted ? ['승인됨·외부 발행 전', 'approved']
    : draft ? ['초안', 'draft']
    : needsGeneration ? ['재생성 필요', 'idle']
    : hasInput() ? ['생성 준비', 'idle']
    : ['입력 대기', 'idle']
  if (status.textContent !== state[0]) status.textContent = state[0]
  status.dataset.state = state[1]
  const review = $('review-state')
  const reviewText = accepted ? (isExample() ? '데모 검토 완료' : '승인됨·외부 발행 전') : draft ? '검토 대기' : '승인 대기'
  review.replaceChildren(document.createElement('i'), document.createTextNode(reviewText))
  showIcon(review.firstChild, accepted ? 'check' : 'lock')
  review.dataset.state = accepted ? (isExample() ? 'demo' : 'approved') : 'idle'
  const stage = accepted || copyCheck.checked || photoCheck.checked ? 2 : draft || request ? 1 : 0
  steps.forEach((step, index) => {
    if (index === stage) step.setAttribute('aria-current', 'step')
    else step.removeAttribute('aria-current')
    step.classList.toggle('complete', index < stage || (accepted && index === stage))
  })
  form.inert = Boolean(activeSample?.rehearsal)
  publisher?.draw()
  editor?.draw(tab === 'blog')
}

function updateChannel() {
  const channel = channels[tab]
  tabs.forEach(button => {
    const active = button.dataset.tab === tab
    button.setAttribute('aria-selected', String(active))
    button.tabIndex = active ? 0 : -1
  })
  $('channel-panel').setAttribute('aria-labelledby', 'tab-' + tab)
  $('channel-panel').setAttribute('aria-busy', String(Boolean(request)))
  $('empty-preview').hidden = Boolean(draft)
  $('rendered-preview').hidden = !draft
  $('demo-notice').hidden = !isExample()
  $('sample-caption').textContent = activeSample && isExample() ? [activeSample.label, draft.photo_note || '가상 설치 사례'].join(' · ') : ''
  $('empty-title').textContent = request ? '초안을 만들고 있습니다' : channel.title + ' 미리보기'
  $('empty-detail').textContent = request ? '세 채널에 사용할 공통 문구를 준비하고 있습니다.' :
    needsGeneration ? '현장 정보가 변경되었습니다. 현재 입력으로 다시 생성해 주세요.' :
    '현장 사진과 설치 형태를 입력하면\n이곳에서 초안을 확인할 수 있습니다.'
  canvas.hidden = tab !== 'card'
  $('text-preview').hidden = tab !== 'sms'
  $('text-preview').textContent = draft && tab !== 'card' ? texts[tab] : ''
  $('format-info').lastElementChild.textContent = channel.format
  exportButton.querySelector('span').textContent = channel.action
  showIcon(exportButton.querySelector('i'), channel.icon)
  updateControls()
}

function updateEvidence() {
  $('evidence-empty').hidden = Boolean(draft)
  $('evidence').hidden = !draft
  $('facts').replaceChildren()
  if (!draft) return
  $('fact-count').textContent = draft.origin === 'rehearsal' ? '테스트 자료 출처 ' + draft.used_facts.length + '개' : isExample() ? '예시 제품 문구 ' + draft.used_facts.length + '개 · 원문 미확인' : '제품 근거 ' + draft.used_facts.length + '개 연결됨'
  for (const fact of draft.used_facts) {
    const item = document.createElement('li')
    const source = document.createElement('small')
    source.textContent = '출처 · ' + fact.source
    item.append(document.createTextNode(fact.text), source)
    $('facts').append(item)
  }
  const missing = [[draft.cta_text, '상담 문구'], [draft.sms_ad_text, '광고 표기'], [draft.sms_opt_out_text, '수신거부 안내']]
    .filter(([value]) => !value).map(([, label]) => label)
  message($('config-notes'), draft.origin === 'rehearsal' ? '개인 블로그 연결을 확인하는 고정 원고입니다.' : missing.length ? '확인 필요 · ' + missing.join(', ') : '')
}

function invalidate() {
  revision++
  exportToken++
  exporting = false
  if (request) request.abort()
  request = null
  needsGeneration ||= Boolean(draft)
  if (draft) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  draft = texts = null
  articleEdits = {}
  editor?.reset()
  accepted = copyCheck.checked = photoCheck.checked = false
  generationError = ''
  endTime = null
  message($('export-feedback'), '')
  message($('generation-message'), '')
  $('timing').textContent = ''
  updateEvidence()
  updateChannel()
}

function onInputChange() {
  if (endTime || !startTime) startTime = new Date()
  invalidate()
}

function resetPhoto() {
  image = null
  photoFile = null
  $('photo').setAttribute('aria-label', '현장 사진 선택')
  $('photo-thumb').hidden = true
  $('photo-thumb').removeAttribute('src')
  $('photo-actions').hidden = true
  $('photo-label').hidden = false
  if (imageUrl) URL.revokeObjectURL(imageUrl)
  imageUrl = null
}

async function selectPhoto(source, alt = '선택한 현장 사진') {
  const current = ++photoRevision
  resetPhoto()
  onInputChange()
  $('photo').value = ''
  message($('photo-error'), '')
  if (!source) return false
  const bundled = typeof source === 'string'
  if (!bundled && !['image/jpeg', 'image/png'].includes(source.type)) {
    message($('photo-error'), 'JPG 또는 PNG 사진 한 장을 선택해 주세요.')
    return false
  }
  if (!bundled) photoFile = source
  const url = bundled ? source : URL.createObjectURL(source)
  let retained = false
  try {
    const decoded = new Image()
    decoded.src = url
    await decoded.decode()
    if (current !== photoRevision) return false
    if (!decoded.naturalWidth || !decoded.naturalHeight) throw new Error()
    image = decoded
    imageUrl = bundled ? null : url
    retained = true
    $('photo').setAttribute('aria-label', '선택한 현장 사진 교체')
    $('photo-thumb').alt = alt
    $('photo-thumb').src = url
    $('photo-thumb').hidden = false
    $('photo-label').hidden = true
    $('photo-actions').hidden = false
    updateControls()
    return true
  } catch {
    if (current === photoRevision) {
      photoFile = null
      message($('photo-error'), bundled ? '예시 사진을 열지 못했습니다. 예시 열기를 다시 눌러 주세요.' : '사진을 읽지 못했습니다. 다른 JPG 또는 PNG를 선택해 주세요.')
    }
    return false
  } finally {
    if (!bundled && !retained) URL.revokeObjectURL(url)
  }
}

function fillInputs(input) {
  for (const radio of form.elements.install) radio.checked = radio.value === input.installation_type
  $('region').value = input.region
  $('note').value = input.field_note
}

function rememberManual() {
  if (!activeSample) {
    manualInputs = {
      input: { ...readInput(), region: $('region').value, field_note: $('note').value },
      photo: photoFile,
      started: endTime ? null : startTime
    }
  }
}
async function loadSample() {
  const sample = sampleCases.find(item => item.id === $('sample-picker').value)
  if (!sample) return
  rememberManual()
  activeSample = sample
  fillInputs(sample.input)
  tab = 'blog'
  const loading = selectPhoto(sample.photo, sample.photoAlt)
  const sampleRevision = revision
  if (await loading && sampleRevision === revision && activeSample === sample) buildDraft(true)
}

async function openRehearsal(result) {
  rememberManual()
  activeSample = {rehearsal:true,label:'개인 블로그 연동 테스트',input:result.input}
  fillInputs(result.input)
  tab = 'blog'
  const load = selectPhoto(result.photo, '개인 블로그 테스트용 CC0 케이블 사진')
  const version = revision
  if (!await load || version !== revision) return
  showResult(result, result.input)
  bringResultsIntoView()
}

async function exitSample() {
  if (!manualInputs) return
  const previous = manualInputs
  activeSample = manualInputs = null
  fillInputs(previous.input)
  tab = 'blog'
  const loading = selectPhoto(previous.photo)
  const restoreRevision = revision
  await loading
  if (restoreRevision !== revision) return
  const hadInput = previous.photo || Object.values(previous.input).some(Boolean)
  startTime = hadInput ? previous.started ?? new Date() : null
  needsGeneration = false
  updateChannel()
}

function showResult(result, input) {
  const formatted = formatChannels(result, input)
  renderCard(canvas, image, result, input)
  const demoLabel = result.origin === 'example' ? '데모·제품 사실 미확인' : ''
  canvas.setAttribute('aria-label', [demoLabel, result.brief.headline, result.used_facts[0].text].filter(Boolean).join(' · '))
  draft = result
  texts = formatted
  needsGeneration = false
  endTime = new Date()
  const clock = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const elapsed = Math.max(0, Math.round((endTime - startTime) / 1000))
  $('timing').textContent = result.origin === 'rehearsal' ? '개인 블로그 테스트 원고 · 모델 호출 없음' : isExample() ? '예시 데이터 · 실시간 생성 시간 미측정' :
    '실시간 생성 · ' + clock.format(startTime) + ' – ' + clock.format(endTime) + ' · ' + elapsed + '초'
  updateEvidence()
  updateChannel()
}

function showFailure(text) {
  generationError = text
  message($('generation-message'), text)
  updateChannel()
}

function bringResultsIntoView() {
  if (matchMedia('(max-width: 850px)').matches) $('output-title').scrollIntoView({ block: 'start' })
}

async function buildDraft(useExample) {
  if (!hasInput() || request || activeSample?.rehearsal) return
  const input = readInput()
  if (!startTime || endTime) startTime = new Date()
  invalidate()
  needsGeneration = false
  const current = revision
  bringResultsIntoView()
  if (useExample || activeSample) {
    const presetMatches = activeSample && activeSample.input.installation_type === input.installation_type &&
      activeSample.input.field_note === input.field_note
    try {
      const result = buildExample(presetMatches ? activeSample.brief : undefined)
      if (activeSample && !photoFile) result.photo_note = '가상 설치 사례 · 자료 사진'
      showResult(result, input)
    }
    catch { showFailure('예시 결과를 표시할 수 없습니다. 사진을 다시 선택하고 시도해 주세요.') }
    return
  }
  const controller = new AbortController()
  request = controller
  const timeout = setTimeout(() => controller.abort(), 120000)
  updateChannel()
  try {
    const response = await fetch('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal: controller.signal
    })
    const result = await response.json()
    if (current !== revision) return
    if (!response.ok) {
      const titles = { NO_APPROVED_FACTS: '근거 미확인', INVALID_BRIEF: '승인 불가', INVALID_INPUT: '입력 확인', MODEL_TIMEOUT: '시간 초과' }
      const title = titles[result.code] || '실시간 생성 실패'
      const reason = result.message || '다시 시도해 주세요.'
      showFailure(reason.startsWith(title) ? reason : title + ' · ' + reason)
      return
    }
    if (result.origin !== 'model') throw new Error('잘못된 응답')
    showResult(result, input)
  } catch {
    if (current === revision) showFailure(controller.signal.aborted ? '시간 초과 · 120초 안에 응답이 도착하지 않았습니다. 다시 시도해 주세요.' : '실시간 생성 실패 · 연결 또는 응답 형식을 확인하고 다시 시도해 주세요.')
  } finally {
    clearTimeout(timeout)
    if (current === revision) {
      request = null
      updateChannel()
    }
  }
}

async function exportCurrent() {
  if (!currentReview().canExport || exporting || editor?.hasUnsaved()) return
  const token = ++exportToken
  const channel = tab
  exporting = true
  message($('export-feedback'), '')
  updateControls()
  try {
    if (channel === 'card') {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      if (token !== exportToken || tab !== channel || !currentReview().canExport) return
      if (!blob) throw new Error()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = (isExample() ? '데모-' : '') + '티링크-교육기관-설치사례.png'
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } else if (channel === 'blog' && window.ClipboardItem && navigator.clipboard.write) {
      const html = renderBlogHtml(texts.document,{imageUrl:flattenedPhoto(image)})
      await navigator.clipboard.write([new ClipboardItem({
        'text/html':new Blob([html],{type:'text/html'}),
        'text/plain':new Blob([texts.blog],{type:'text/plain'})
      })])
    } else {
      await navigator.clipboard.writeText(texts[channel])
    }
    if (token === exportToken) {
      $('export-feedback').dataset.state = 'success'
      message($('export-feedback'), channel === 'card' ? 'PNG 다운로드를 시작했습니다.' : (channel === 'blog' && window.ClipboardItem && navigator.clipboard.write ? '사진과 서식을 담은 블로그 원고를 복사했습니다.' : '일반 텍스트를 복사했습니다.'))
    }
  } catch {
    if (token === exportToken) {
      $('export-feedback').dataset.state = 'error'
      message($('export-feedback'), channel === 'card' ? 'PNG 저장에 실패했습니다. 다시 시도해 주세요.' : '복사하지 못했습니다. 브라우저의 클립보드 권한을 확인하고 다시 시도해 주세요.')
    }
  } finally {
    if (token === exportToken) {
      exporting = false
      updateControls()
    }
  }
}

function selectTab(button) {
  if (button.dataset.tab === tab) return
  if (tab === 'blog' && !editor.leave()) return
  tab = button.dataset.tab
  exportToken++
  exporting = false
  message($('export-feedback'), '')
  updateChannel()
}

function revokeReview() {
  accepted = copyCheck.checked = photoCheck.checked = false
  exportToken++
  exporting = false
  updateControls()
}

mountIcons()
editor = setupArticleEditor({
  getDocument:()=>texts?.document, getImage:()=>image,
  canCopy:()=>Boolean(draft && currentReview().canExport && tab==='blog'),
  lockedReason: () => {
    if (draft?.origin === 'rehearsal') return '개인 연동 테스트 · 읽기 전용'
    if (publisher?.locked(draft?.publish_token)) return '전송한 원고 · 읽기 전용'
    return ''
  },
  refreshControls: updateControls,
  revoke:revokeReview,
  feedback:value=>message($('export-feedback'),value),
  applyEdits(updates) {
    if (!draft || draft.origin==='rehearsal' || publisher?.locked(draft.publish_token)) throw Error('현재 원고는 수정할 수 없습니다.')
    const next={...articleEdits,...updates}
    const nextTexts=formatChannels(draft,readInput(),next)
    renderCard(canvas,image,draft,readInput(),next)
    articleEdits=next; texts=nextTexts
    canvas.setAttribute('aria-label', nextTexts.document.title)
  }
})
publisher = setupPublisher(()=>({
  draft, document:texts?.document, image, edits:articleEdits,
  approved:accepted && currentReview().canApprove, editing:editor.hasUnsaved(),
  blogId:connection?.naver.blogId, connected:connection?.naver.connected, mode:connection?.naver.mode
}))
setupConnections(next=>{connection=next;updateControls()},openRehearsal)
$('quick-sample').addEventListener('click',()=>{ $('sample-picker').value=sampleCases[0].id;loadSample() })
form.reset()
for (const sample of sampleCases) {
  const installation = { new: '신규', addition: '추가', replacement: '교체' }[sample.input.installation_type]
  $('sample-picker').add(new Option(installation + ' · ' + sample.label, sample.id))
}
$('load-sample').addEventListener('click', loadSample)
$('exit-sample').addEventListener('click', exitSample)
form.addEventListener('submit', event => { event.preventDefault(); buildDraft(false) })
example.addEventListener('click', () => buildDraft(true))
$('error-example').addEventListener('click', () => buildDraft(true))
$('retry').addEventListener('click', () => buildDraft(false))
$('photo').addEventListener('change', event => { if (event.target.files[0]) selectPhoto(event.target.files[0]) })
$('remove-photo').addEventListener('click', () => selectPhoto(null))
for (const field of [form.elements.region, form.elements.note, ...form.elements.install]) {
  field.addEventListener('input', onInputChange)
}

const dropZone = $('drop-zone')
for (const type of ['dragenter', 'dragover']) {
  dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('dragging') })
}
for (const type of ['dragleave', 'drop']) {
  dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('dragging') })
}
dropZone.addEventListener('drop', event => {
  if (event.dataTransfer.files.length === 1) selectPhoto(event.dataTransfer.files[0])
  else {
    selectPhoto(null)
    message($('photo-error'), '현장 사진은 한 장씩 선택해 주세요.')
  }
})

for (const [index, button] of tabs.entries()) {
  button.addEventListener('click', () => selectTab(button))
  button.addEventListener('keydown', event => {
    const destination = { ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 }[event.key]
    if (destination === undefined) return
    event.preventDefault()
    tabs[destination].focus()
    selectTab(tabs[destination])
  })
}
for (const check of [copyCheck, photoCheck]) {
  check.addEventListener('change', () => {
    accepted = false
    exportToken++
    exporting = false
    message($('export-feedback'), '')
    updateControls()
  })
}
approve.addEventListener('click', () => {
  if (currentReview().canApprove && !editor?.hasUnsaved()) accepted = true
  updateControls()
})
exportButton.addEventListener('click', exportCurrent)
$('guide-button').addEventListener('click', () => $('guide').showModal())
$('close-guide').addEventListener('click', () => $('guide').close())
$('guide-done').addEventListener('click', () => $('guide').close())
updateChannel()
