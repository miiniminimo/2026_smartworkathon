import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExample, formatChannels, renderCard } from '../public/outputs.js'
import { DEMO_CTA } from '../public/blog-format.js'

const input = { installation_type: 'addition', region: '서울', field_note: '메모 원문을 게시하지 않습니다.' }

function modelResult() {
  const draft = buildExample()
  return {
    ...draft,
    origin: 'model',
    brief: { ...draft.brief, fact_ids: ['T1', 'T2'] },
    used_facts: [
      { id: 'T1', text: '테스트 근거 원문 1.', source: '시험 자료 p.1' },
      { id: 'T2', text: '테스트 근거 원문 2.', source: '시험 자료 p.2' },
    ],
    cta_text: '상담 테스트 문구',
    sms_ad_text: '(광고) 테스트',
    sms_opt_out_text: '수신거부 테스트 문구',
  }
}

function canvasSpy() {
  const textDraws = []
  const imageDraws = []
  const context = {
    font: '',
    measureText(text) {
      const size = Number(this.font.match(/(\d+)px/u)[1])
      return { width: [...text].reduce((width, ch) => width + (ch === ' ' ? 0.3 : 1) * size, 0) }
    },
    fillRect() {},
    fillText(text, x, y) {
      const width = this.measureText(text).width
      textDraws.push({ text, left: this.textAlign === 'right' ? x - width : x, y, width })
    },
    drawImage(...args) { imageDraws.push(args) },
  }
  return { canvas: { getContext: () => context }, textDraws, imageDraws }
}

test('blog preserves narrative order, exact evidence, photo insertion line, and optional metadata', () => {
  const result = modelResult()
  const { blog } = formatChannels(result, input)
  const parts = blog.split('\n\n')
  assert.deepEqual(parts, [
    result.brief.headline, '교육기관 · 익명  |  서울  |  추가 설치',
    result.brief.external_problem, '[설치 사진 삽입]', '서울 · 추가 설치 · 현장 사진',
    result.brief.editorial.scene_heading, result.brief.internal_problem, result.brief.fundamental_problem,
    result.brief.editorial.practice_heading,
    ...result.used_facts.map(fact => fact.text),
    result.brief.success, result.brief.identity_change,
    result.brief.editorial.checklist_heading, result.brief.editorial.checklist.map(item => '• ' + item).join('\n'),
    result.cta_text, '#학교상담 #교육기관 #설치사례',
  ])
  assert.ok(!blog.includes(input.field_note))
  const withoutRegion = formatChannels(result, { installation_type: 'new' })
  assert.match(withoutRegion.blog, /교육기관 · 익명  \|  신규 설치/u)
})

test('ready SMS uses only the first fact with configured ad, CTA and opt-out text', () => {
  const result = modelResult()
  const { sms } = formatChannels(result, input)
  assert.deepEqual(sms.split('\n'), [
    result.sms_ad_text, result.brief.external_problem, result.used_facts[0].text,
    result.cta_text, result.sms_opt_out_text,
  ])
  for (const key of ['sms_ad_text', 'sms_opt_out_text']) {
    assert.match(formatChannels({ ...result, [key]: null }, input).sms, /^검토용 초안\n/u)
  }
  assert.match(formatChannels({ ...result, cta_text: null }, input).blog, /\[상담 안내 확인 필요\]/u)
})

test('example never returns real CTA or SMS settings and labels both text outputs', () => {
  const example = buildExample()
  assert.equal(example.origin, 'example')
  assert.deepEqual(example.brief.fact_ids, example.used_facts.map(fact => fact.id))
  assert.equal(example.cta_text, null)
  assert.equal(example.sms_ad_text, null)
  assert.equal(example.sms_opt_out_text, null)
  const { blog, sms } = formatChannels(example, input)
  assert.equal(blog.split('\n')[0], '데모·제품 사실 미확인')
  assert.ok(blog.includes(DEMO_CTA))
  assert.match(sms, /^검토용 초안\n데모·제품 사실 미확인\n/u)
  example.used_facts[0].text = '수정'
  assert.notEqual(buildExample().used_facts[0].text, '수정')
})

test('square card draws the uploaded photo centrally and without stretching, and labels demonstration pixels', () => {
  const result = buildExample()
  for (const image of [{ naturalWidth: 500, naturalHeight: 1500 }, { width: 3200, height: 900 }]) {
    const { canvas, imageDraws, textDraws } = canvasSpy()
    renderCard(canvas, image, result, input)
    assert.equal(canvas.width, 1080)
    assert.equal(canvas.height, 1080)
    assert.equal(imageDraws.length, 1)
    const [original, sx, sy, sw, sh, , , dw, dh] = imageDraws[0]
    assert.equal(original, image)
    assert.ok(Math.abs(sw / sh - dw / dh) < 1e-8)
    assert.ok(Math.abs(sx * 2 + sw - (image.naturalWidth || image.width)) < 1e-8)
    assert.ok(Math.abs(sy * 2 + sh - (image.naturalHeight || image.height)) < 1e-8)
    assert.ok(dw * dh > 1080 ** 2 / 2)
    assert.ok(textDraws.some(draw => draw.text === '데모·제품 사실 미확인'))
    const drawn = textDraws.map(draw => draw.text).join('')
    for (const label of ['교육기관 · 익명', '추가 설치', '교육']) assert.ok(drawn.includes(label))
  }
})

test('card wraps long Korean title and evidence without dropping text or drawing outside the canvas', () => {
  const result = modelResult()
  result.brief.headline = '상담하는교육담당자의목표'.repeat(8)
  result.used_facts[0].text = '담당자가확인한제품문구'.repeat(10)
  const { canvas, textDraws } = canvasSpy()
  renderCard(canvas, { width: 1024, height: 768 }, result, input)
  const drawn = textDraws.map(draw => draw.text).join('')
  assert.ok(drawn.includes(result.brief.headline))
  assert.ok(drawn.includes(result.used_facts[0].text))
  assert.ok(!drawn.includes('데모·제품 사실 미확인'))
  assert.ok(textDraws.every(draw => draw.left >= 0 && draw.left + draw.width <= 1080 && draw.y < 1080))
  assert.throws(() => renderCard(canvas, { naturalWidth: 0, naturalHeight: 0 }, result, input), /사진/u)
})
