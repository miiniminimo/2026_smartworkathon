export const DEMO_LABEL = '데모·제품 사실 미확인'
export const REHEARSAL_LABEL = '개인 블로그 연동 테스트 · 공개 자료 사진'
export const DEMO_CTA = '상담을 준비하신다면 현재 사용하는 전화 환경과 가장 자주 받는 문의를 먼저 정리해 보세요.'
const INSTALLATIONS = { new: '신규 설치', addition: '추가 설치', replacement: '교체 설치' }
const MANUAL_IMAGE = '[설치 사진 삽입]'

// Provider prose and human edits share the same numerical and contact-claim boundary.
// Approved settings and product evidence are inserted verbatim outside this check.
export const UNSUPPORTED_CLAIM = /\p{N}|[%％]|(?:https?|ftp):\/\/|www\.|[a-z][a-z.-]*\.[a-z]{2,}\b|[\w.+-]+@[\w.-]+/iu

export function caseDetails(input) {
  return ['교육기관 · 익명', input.region?.trim(), INSTALLATIONS[input.installation_type]].filter(Boolean).join('  |  ')
}

function editableText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new TypeError(label + '에 비어 있지 않은 ' + max + '자 이내의 문구를 입력해 주세요.')
  }
  if (UNSUPPORTED_CLAIM.test(value.normalize('NFKC'))) {
    throw new TypeError(label + '에서 숫자·연락처·웹 주소를 확인해 주세요. 확인된 제품 수치와 연락처는 근거·상담 설정에서 관리합니다.')
  }
  return value.trim()
}

export function buildBlogDocument(result, input, edits = {}) {
  if (!edits || typeof edits !== 'object' || Array.isArray(edits)) throw new TypeError('편집 내용을 확인해 주세요.')
  const { brief } = result
  const extra = brief.editorial
  const demo = result.origin === 'example'
  const rehearsal = result.origin === 'rehearsal'
  const blocks = []
  const add = (type, id, text, editable = false) => blocks.push({ type, id, text, editable: editable && !rehearsal })
  if (demo) add('notice', 'demo', DEMO_LABEL)
  if (rehearsal) add('notice', 'rehearsal', REHEARSAL_LABEL)
  add('meta', 'case', rehearsal ? '개인 블로그 · 연동 테스트' : caseDetails(input))
  add('paragraph', 'external_problem', brief.external_problem, true)
  const photoNote = ((demo || rehearsal) && result.photo_note) || (rehearsal ? '연동 테스트용 공개 자료 사진' : '')
  blocks.push({
    type: 'image', id: 'field-photo', alt: photoNote || '공개 검토 대상 교육기관 현장 사진',
    caption: photoNote || [input.region, INSTALLATIONS[input.installation_type], '현장 사진'].filter(Boolean).join(' · '), editable: false,
  })
  add('heading', 'heading-scene', extra?.scene_heading || '상담 담당자가 마주하는 순간', true)
  add('paragraph', 'internal_problem', brief.internal_problem, true)
  add('quote', 'fundamental_problem', brief.fundamental_problem, true)
  add('heading', 'heading-practice', extra?.practice_heading || '현장에 맞춰 살펴볼 점', true)
  for (const fact of result.used_facts) {
    blocks.push({ type: 'fact', id: 'fact-' + fact.id, factId: fact.id, text: fact.text, editable: false })
  }
  add('paragraph', 'success', brief.success, true)
  add('paragraph', 'identity_change', brief.identity_change, true)
  if (extra) {
    add('heading', 'heading-check', extra.checklist_heading, true)
    blocks.push({ type: 'list', id: 'checklist', items: [...extra.checklist], editable: !rehearsal })
  }
  add('cta', 'cta', result.cta_text || (demo ? DEMO_CTA : '[상담 안내 확인 필요]'))
  const doc = {
    version: 1, title: brief.headline,
    tags: brief.tags.map(tag => tag.trim().replace(/^#+/u, '').replace(/\s+/gu, '')).filter(Boolean),
    blocks,
  }
  for (const [id, value] of Object.entries(edits)) {
    if (rehearsal) throw new TypeError('연동 테스트는 준비된 고정 원고로 발행합니다.')
    if (id === 'title') {
      doc.title = editableText(value, 120, '제목')
      continue
    }
    const block = blocks.find(item => item.id === id && item.editable)
    if (!block) throw new TypeError('이 항목은 본문에서 수정할 수 없습니다.')
    if (block.type === 'list') {
      if (!Array.isArray(value) || value.length < 1 || value.length > 6) throw new TypeError('목록에는 한 개에서 여섯 개의 항목을 입력해 주세요.')
      block.items = value.map(item => editableText(item, 220, '목록 항목'))
    } else {
      block.text = editableText(value, block.type === 'heading' ? 120 : 1600, block.type === 'heading' ? '소제목' : '본문')
    }
  }
  if (rehearsal && !doc.title.startsWith('[연동 테스트]')) doc.title = '[연동 테스트] ' + doc.title
  return doc
}

function safeImageUrl(value) {
  if (typeof value !== 'string' || !value || /[\x00-\x20<>"']/u.test(value)) return ''
  if (/^(?:https:\/\/|blob:|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$)/iu.test(value)) return value
  if (/^(?:\/(?!\/)|[\w\p{L}-]+(?:\.[\w-]+)?(?:\/|$))/u.test(value) && !value.includes('\\')) return value
  return ''
}

const escapeHtml = text => String(text).replace(/[&<>"']/gu, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char])

function escapeMd(value) {
  return String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
    .replace(/([\\`*_{}\[\]()#+!|~>-])/gu, '\\$1')
}

const tagsText = doc => doc.tags.map(tag => '#' + tag).join(' ')

export function renderBlogText(doc) {
  const parts = []
  const notice = doc.blocks.find(block => block.type === 'notice')
  if (notice) parts.push(notice.text)
  parts.push(doc.title)
  for (const block of doc.blocks) {
    if (block.type === 'notice') continue
    if (block.type === 'image') parts.push(MANUAL_IMAGE, block.caption)
    else if (block.type === 'list') parts.push(block.items.map(item => '• ' + item).join('\n'))
    else parts.push(block.text)
  }
  return [...parts, tagsText(doc)].filter(Boolean).join('\n\n')
}

export function renderBlogMarkdown(doc, { imageUrl } = {}) {
  const parts = []
  const notice = doc.blocks.find(block => block.type === 'notice')
  if (notice) parts.push('> ' + escapeMd(notice.text))
  parts.push('# ' + escapeMd(doc.title))
  for (const block of doc.blocks) {
    const text = escapeMd(block.text ?? '')
    switch (block.type) {
      case 'notice': break
      case 'heading': parts.push('## ' + text); break
      case 'quote': parts.push(text.split('\n').map(line => '> ' + line).join('\n')); break
      case 'fact': parts.push('**' + text + '**'); break
      case 'list': parts.push(block.items.map(item => '- ' + escapeMd(item).replace(/\n/gu, ' ')).join('\n')); break
      case 'image': {
        const src = safeImageUrl(imageUrl)
        const photo = src ? '![' + escapeMd(block.alt) + '](<' + src + '>)' : escapeMd(MANUAL_IMAGE)
        parts.push(photo, '*' + escapeMd(block.caption) + '*')
        break
      }
      default: parts.push(text)
    }
  }
  return [...parts, doc.tags.map(tag => '\\#' + escapeMd(tag)).join(' ')].filter(Boolean).join('\n\n')
}

const inline = {
  meta: 'font-size:13px;color:#617068;margin:0 0 22px;',
  paragraph: 'font-size:16px;line-height:1.9;margin:0 0 18px;',
  heading: 'font-size:22px;line-height:1.5;font-weight:700;margin:30px 0 12px;',
  quote: 'border-left:3px solid #19845c;padding:8px 18px;margin:24px 0;font-size:19px;font-weight:600;line-height:1.7;',
  fact: 'border-left:3px solid #c9d9d0;padding-left:14px;margin:14px 0;font-weight:600;line-height:1.8;',
  cta: 'margin:28px 0 12px;font-weight:600;line-height:1.8;',
  notice: 'font-size:13px;font-weight:600;color:#8c5112;margin:0 0 12px;',
}

export function renderBlogHtml(doc, { imageUrl, includeTitle = true, inlineStyles = true } = {}) {
  const lines = []
  const paragraph = (tag, block) => '<' + tag + ' class="blog-' + block.type + '" style="' + inline[block.type] + '">' +
    escapeHtml(block.text).replace(/\n/gu, '<br>') + '</' + tag + '>'
  const notice = doc.blocks.find(block => block.type === 'notice')
  if (notice) lines.push(paragraph('p', notice))
  if (includeTitle) lines.push('<h1 class="blog-title" style="font-size:30px;line-height:1.4;margin:0 0 12px;">' + escapeHtml(doc.title) + '</h1>')
  for (const block of doc.blocks) {
    switch (block.type) {
      case 'notice': break
      case 'heading': lines.push(paragraph('h2', block)); break
      case 'quote': lines.push(paragraph('blockquote', block)); break
      case 'list':
        lines.push('<ul class="blog-list" style="margin:12px 0 24px;padding-left:24px;line-height:1.9;">' +
          block.items.map(item => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul>')
        break
      case 'image': {
        const url = safeImageUrl(imageUrl)
        const image = url ? '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(block.alt) +
          '" style="display:block;max-width:100%;height:auto;margin:auto;">' : '<span>' + MANUAL_IMAGE + '</span>'
        lines.push('<figure class="blog-photo" style="margin:24px 0;">' + image +
          '<figcaption style="font-size:13px;color:#617068;text-align:center;margin-top:7px;">' + escapeHtml(block.caption) + '</figcaption></figure>')
        break
      }
      default: lines.push(paragraph('p', block))
    }
  }
  lines.push('<p class="blog-tags" style="font-size:14px;color:#41715b;margin-top:22px;">' + escapeHtml(tagsText(doc)) + '</p>')
  const html = '<article class="naver-article" lang="ko">' + lines.join('\n') + '</article>'
  return inlineStyles ? html : html.replace(/ style="[^"]*"/gu, '')
}
