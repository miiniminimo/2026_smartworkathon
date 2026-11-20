import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExample, formatChannels } from '../public/outputs.js'
import { buildBlogDocument, renderBlogHtml, renderBlogMarkdown, renderBlogText, DEMO_LABEL, REHEARSAL_LABEL } from '../public/blog-format.js'
import { sampleCases } from '../public/sample-cases.js'

const sample = sampleCases[0]
const draft = () => ({ ...buildExample(sample.brief), photo_note: '가상 사례 · 자료 사진' })

test('canonical reader, rich HTML, Markdown and plain text share one title, story, evidence and caption', () => {
  const result = draft()
  const doc = buildBlogDocument(result, sample.input)
  assert.equal(doc.blocks[0].text, DEMO_LABEL)
  assert.equal(doc.blocks.filter(block => block.type === 'image').length, 1)
  const html = renderBlogHtml(doc, { imageUrl: sample.photo })
  for (const tag of ['h1', 'h2', 'blockquote', 'ul', 'li', 'img', 'figcaption']) assert.ok(html.includes('<' + tag))
  assert.ok(html.includes('src="' + sample.photo + '"'))
  assert.ok(!renderBlogHtml(doc, { includeTitle: false }).includes('<h1'))
  assert.ok(!renderBlogHtml(doc, { inlineStyles: false }).includes(' style='))
  const md = renderBlogMarkdown(doc, { imageUrl: sample.photo })
  assert.ok(md.includes('## ' + sample.brief.editorial.scene_heading))
  assert.ok(md.includes('> ' + sample.brief.fundamental_problem))
  assert.ok(md.includes('](<' + sample.photo + '>)'))
  const plain = renderBlogText(doc)
  assert.equal(plain.split('\n')[0], DEMO_LABEL)
  assert.equal(plain, formatChannels(result, sample.input).blog)
  for (const output of [html, md, plain]) assert.ok(output.includes(result.used_facts[0].text))
})

test('edits affect every representation, protect locked records, and preserve original inputs', () => {
  const result = draft()
  const edits = { title: '교대 전에 남길 문의', 'heading-scene': '첫 통화가 끝난 뒤', external_problem: '남은 질문을 누구에게 전할까요?', checklist: ['담당자', '확인이 필요한 문의'] }
  const { document, blog, sms } = formatChannels(result, sample.input, edits)
  for (const output of [renderBlogHtml(document), renderBlogMarkdown(document), blog]) {
    assert.ok(output.includes(edits.title))
    assert.ok(output.includes(edits['heading-scene']))
    assert.ok(output.includes(edits.checklist[1]))
  }
  assert.ok(sms.includes(edits.external_problem))
  assert.deepEqual(result.brief, sample.brief)
  for (const bad of [{ 'fact-EXAMPLE': '변경' }, { cta: '변경' }, { tags: [] }, { title: '' },
    { success: '상담 100% 성공' }, { title: '연락처 mail@example.test' }, { checklist: [] },
    { checklist: [''] }, { checklist: '문자열' }]) {
    assert.throws(() => buildBlogDocument(result, sample.input, bad), TypeError)
  }
})

test('rich previews escape user content and refuse scriptable or remote-protocol-relative image sources', () => {
  const doc = buildBlogDocument(draft(), { ...sample.input, region: '<b>서울</b>' }, { title: '<img onerror=alert()>' })
  const html = renderBlogHtml(doc, { imageUrl: 'javascript:alert(1)' })
  assert.ok(html.includes('&lt;img onerror=alert()&gt;'))
  assert.ok(!html.includes('<img'))
  assert.ok(!html.includes('<b>서울'))
  assert.ok(!renderBlogHtml(doc, { imageUrl: '//unknown.test/a.png' }).includes('src='))
  assert.ok(!renderBlogHtml(doc, { imageUrl: 'data:image/svg+xml;base64,ab' }).includes('src='))
  assert.match(renderBlogHtml(doc, { imageUrl: 'data:image/png;base64,AA==' }), /<img src="data:image\/png;base64,AA=="/u)
  assert.ok(renderBlogMarkdown(doc).includes('&lt;img'))
})

test('legacy brief remains readable and test-account documents retain their fixed identity', () => {
  const result = draft()
  delete result.brief.editorial
  const legacy = buildBlogDocument(result, sample.input)
  assert.ok(legacy.blocks.some(block => block.type === 'heading'))
  assert.ok(!legacy.blocks.some(block => block.type === 'list'))
  assert.throws(() => buildBlogDocument(result, sample.input, { checklist: ['한 항목'] }))
  const rehearsal = { ...result, origin: 'rehearsal', photo_note: 'CC0 케이블 자료 사진' }
  const doc = buildBlogDocument(rehearsal, sample.input)
  assert.ok(doc.title.startsWith('[연동 테스트]'))
  assert.equal(doc.blocks[0].text, REHEARSAL_LABEL)
  assert.ok(doc.blocks.every(block => !block.editable))
  assert.equal(doc.blocks.find(block => block.type === 'meta').text, '개인 블로그 · 연동 테스트')
  assert.equal(doc.blocks.find(block => block.type === 'image').caption, rehearsal.photo_note)
  assert.throws(() => buildBlogDocument(rehearsal, sample.input, { title: '다른 글' }))
})
