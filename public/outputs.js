import { buildBlogDocument, caseDetails, DEMO_CTA, DEMO_LABEL, REHEARSAL_LABEL, renderBlogText } from './blog-format.js'
const FONT = 'Inter, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif'

export function buildExample(presetBrief) {
  return {
    origin: 'example',
    brief: presetBrief ? { ...structuredClone(presetBrief), fact_ids: ['EXAMPLE'] } : {
      headline: '다시 걸려 온 상담 전화, 어디서 이어갈까요?',
      external_problem: '상담을 마친 뒤 답을 더 알아보겠다고 했는데, 그 전화가 내 자리 대신 옆자리로 걸려 온다면 어떨까요?',
      internal_problem: '이어받은 담당자에게는 보호자의 첫 질문과 전임자가 확인하기로 한 일이 서로 다른 정보입니다. 둘이 섞이면 보호자는 지난 통화를 처음부터 설명해야 합니다. 메모에는 이미 안내한 내용과 아직 답하지 못한 질문을 나눠 적는 편이 좋습니다.',
      fundamental_problem: '담당자가 바뀌어도 보호자가 질문을 처음부터 다시 시작할 필요가 없도록 합니다.',
      success: '상담을 마칠 때는 답을 기다리는 질문을 다시 읽고, 다음 안내를 맡을 사람을 정합니다. 이후 전화가 오면 그 질문부터 대화를 시작할 수 있습니다.',
      identity_change: '학생을 아는 교사와 전화를 먼저 받는 담당자가 늘 같을 수는 없습니다. 다음 사람에게 넘길 한 문장을 정해 두면, 누가 전화를 받든 학교가 같은 약속을 이어 갈 수 있습니다.',
      editorial: {
        scene_heading: '다음 담당자가 알아야 할 것은 무엇일까요?',
        practice_heading: '상담실 전화를 준비하며 확인할 일',
        checklist_heading: '다음 안내 전에 적어 둘 항목',
        checklist: ['상대가 다시 확인해 달라고 한 질문', '이미 안내한 내용과 답을 기다리는 내용', '다음 안내를 맡을 담당자와 연락할 시점'],
      },
      fact_ids: ['EXAMPLE'], tags: ['학교상담', '교육기관', '설치사례'],
    },
    used_facts: [{
      id: 'EXAMPLE',
      text: '상담 준비 항목 · 전화기를 놓을 위치와 현재 사용하는 회선의 종류를 함께 정리합니다.',
      source: '가상 사례용 상담 준비 문구 · 실제 제품 원문 미확인',
    }],
    cta_text: null,
    sms_ad_text: null,
    sms_opt_out_text: null,
  }
}

export function formatChannels(result, input, edits = {}) {
  const { used_facts: facts } = result
  const example = result.origin === 'example'
  const document = buildBlogDocument(result, input, edits)
  const blog = renderBlogText(document)
  const cta = result.cta_text || (example ? DEMO_CTA : '[상담 안내 확인 필요]')
  const opening = document.blocks.find(block => block.id === 'external_problem').text
  const sms = [
    (example || !result.sms_ad_text || !result.sms_opt_out_text) && '검토용 초안',
    example && DEMO_LABEL,
    result.origin === 'rehearsal' && REHEARSAL_LABEL,
    result.sms_ad_text || '[광고 표기 확인 필요]',
    opening,
    facts[0].text,
    cta,
    result.sms_opt_out_text || '[수신거부 안내 확인 필요]',
  ].filter(Boolean).join('\n')
  return { blog, sms, document }
}

// Keep ordinary Korean words together. Break very long words only when they would overflow.
function wrapText(context, text, width) {
  const lines = []
  let line = ''
  for (const word of text.trim().split(/\s+/u)) {
    const candidate = line ? line + ' ' + word : word
    if (context.measureText(candidate).width <= width) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    line = ''
    for (const character of word) {
      if (line && context.measureText(line + character).width > width) {
        lines.push(line)
        line = ''
      }
      line += character
    }
  }
  if (line) lines.push(line)
  return lines
}

function drawFittedText(context, text, box, size, weight, color, fontFamily) {
  context.fillStyle = color
  for (let fontSize = size; fontSize >= 1; fontSize--) {
    context.font = weight + ' ' + fontSize + 'px ' + fontFamily
    const lines = wrapText(context, text, box.width)
    const leading = Math.ceil(fontSize * 1.24)
    if (lines.length * leading > box.height) continue
    const top = box.y + Math.floor((box.height - lines.length * leading) / 2)
    lines.forEach((line, index) => context.fillText(line, box.x, top + index * leading))
    return
  }
  throw new Error('문구가 카드에 들어가지 않습니다. 더 짧은 문구로 다시 생성해 주세요.')
}

export function renderCard(canvas, image, result, input, edits = {}) {
  const width = image?.naturalWidth || image?.width
  const height = image?.naturalHeight || image?.height
  if (!(width > 0 && height > 0)) throw new Error('사진을 읽을 수 없습니다. 사진을 다시 선택해 주세요.')
  canvas.width = 1080
  canvas.height = 1080
  const context = canvas.getContext('2d')
  if (!context) throw new Error('카드를 그릴 수 없습니다. 브라우저에서 다시 시도해 주세요.')
  const style = canvas.ownerDocument?.defaultView?.getComputedStyle(canvas)
  const color = (name, fallback) => style?.getPropertyValue('--color-' + name).trim() || fallback
  const ink = color('editorial', '#153B33')
  const mint = color('editorial-accent', '#CDEAC8')
  const paper = color('editorial-ink', '#F8F5E9')
  const fontFamily = style?.fontFamily || FONT
  context.fillStyle = paper
  context.fillRect(0, 0, 1080, 1080)
  context.fillStyle = ink
  context.fillRect(0, 0, 1080, 82)
  context.textBaseline = 'top'
  context.textAlign = 'left'
  context.fillStyle = mint
  context.font = '750 32px ' + fontFamily
  context.fillText('T:LINK', 48, 23)
  context.fillStyle = paper
  context.font = '500 23px ' + fontFamily
  context.textAlign = 'right'
  const photoLabel = ['example', 'rehearsal'].includes(result.origin) && result.photo_note
  context.fillText(photoLabel || '교육기관 설치 사례', 1032, 28)
  context.textAlign = 'left'

  const photoHeight = 566
  const scale = Math.max(1080 / width, photoHeight / height)
  const sourceWidth = 1080 / scale
  const sourceHeight = photoHeight / scale
  context.drawImage(image, (width - sourceWidth) / 2, (height - sourceHeight) / 2,
    sourceWidth, sourceHeight, 0, 82, 1080, photoHeight)

  context.fillStyle = mint
  context.fillRect(48, 684, 78, 42)
  context.fillStyle = ink
  context.font = '700 23px ' + fontFamily
  const rehearsal = result.origin === 'rehearsal'
  context.fillText(rehearsal ? '연동' : '교육', 62, 693)
  const details = rehearsal ? '개인 블로그 · 게시 기능 점검' : caseDetails(input)
  drawFittedText(context, details, { x: 146, y: 682, width: 885, height: 47 }, 24, 500, color('muted', '#535D55'), fontFamily)
  const cardTitle = Object.hasOwn(edits, 'title') ? buildBlogDocument(result, input, edits).title : result.brief.headline
  drawFittedText(context, cardTitle, { x: 48, y: 740, width: 984, height: 139 }, 60, 750, ink, fontFamily)
  context.fillStyle = color('border', '#DADFD5')
  context.fillRect(48, 895, 984, 2)
  drawFittedText(context, result.used_facts[0].text, { x: 48, y: 908, width: 984, height: 89 }, 30, 500, ink, fontFamily)

  context.fillStyle = ink
  context.fillRect(0, 1012, 1080, 68)
  context.fillStyle = mint
  context.fillRect(48, 1042, 38, 5)
  context.fillStyle = paper
  context.font = '600 21px ' + fontFamily
  context.fillText('티링크 콘텐츠 스튜디오', 100, 1031)
  if (['example', 'rehearsal'].includes(result.origin)) {
    context.textAlign = 'right'
    context.fillStyle = mint
    context.fillText(result.origin === 'example' ? DEMO_LABEL : REHEARSAL_LABEL, 1032, 1031)
    context.textAlign = 'left'
  }
}
