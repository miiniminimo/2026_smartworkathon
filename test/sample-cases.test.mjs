import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { sampleCases } from '../public/sample-cases.js'
import { buildExample, formatChannels } from '../public/outputs.js'
import { reviewPolicy } from '../public/review.js'

test('all built-in cases ship with a local JPEG and disclose illustrative photos on export', async () => {
  for (const sample of sampleCases) {
    assert.match(sample.photo, /^\/samples\/[\w-]+\.jpg$/u)
    const bytes = await readFile(new URL('../public' + sample.photo, import.meta.url))
    assert.equal(bytes.readUInt16BE(0), 0xffd8)
    assert.ok(sample.photoAlt.includes('자료 사진'))
    const result = { ...buildExample(sample.brief), photo_note: '가상 설치 사례 · 자료 사진' }
    const { blog } = formatChannels(result, sample.input)
    assert.equal(blog.split('\n')[0], '데모·제품 사실 미확인')
    assert.ok(blog.includes(result.photo_note))
  }
})

test('each installation preset produces its own reviewable demonstration content', () => {
  assert.deepEqual(new Set(sampleCases.map(sample => sample.input.installation_type)), new Set(['new', 'addition', 'replacement']))
  assert.equal(new Set(sampleCases.map(sample => sample.brief.headline)).size, sampleCases.length)
  for (const { input, brief } of sampleCases) {
    const result = buildExample(brief)
    const output = formatChannels(result, input)
    assert.equal(result.origin, 'example')
    assert.deepEqual(result.brief.fact_ids, result.used_facts.map(fact => fact.id))
    assert.deepEqual(result.brief.fact_ids, ['EXAMPLE'])
    assert.equal(result.cta_text, null)
    assert.equal(result.sms_ad_text, null)
    assert.equal(result.sms_opt_out_text, null)
    assert.equal(output.blog.split('\n')[0], '데모·제품 사실 미확인')
    assert.ok(output.blog.includes(input.region))
    assert.ok(!output.blog.includes(input.field_note))
    for (const key of ['headline', 'external_problem', 'internal_problem', 'fundamental_problem', 'success', 'identity_change']) {
      assert.ok(brief[key].trim() && output.blog.includes(brief[key]))
    }
    assert.ok(output.sms.includes(brief.external_problem))
    const policy = reviewPolicy({ result, tab: 'sms', copyReviewed: true, photoReviewed: true, accepted: true })
    assert.equal(policy.canExport, false)
  }
})

test('resetting a demo preserves the original preset and example-only evidence', () => {
  const { brief } = sampleCases[0]
  const result = buildExample(brief)
  result.brief.tags.push('임시')
  result.brief.fact_ids[0] = '수정'
  result.used_facts[0].text = '수정'
  const fresh = buildExample(brief)
  assert.deepEqual(fresh.brief, brief)
  assert.ok(!fresh.brief.tags.includes('임시'))
  assert.deepEqual(fresh.brief.fact_ids, ['EXAMPLE'])
  assert.notEqual(fresh.used_facts[0].text, '수정')
})
