import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { generate, requestModel } from './generate.mjs'
import { makeHandler } from '../server.mjs'

// Test-only records exercise live-mode rules without approving any production facts.
const fact = {
  id: 'T1', product: '녹취 제품', text: '테스트 기능 1개', source: '테스트 원문 1쪽',
  status: 'approved', approved_by: '테스트 담당자',
}
const facts = [
  fact, { ...fact, id: 'T2', text: '별도 테스트 기능' },
  { ...fact, id: 'pending', status: 'pending' }, { ...fact, id: 'other', product: '타 제품' },
  { ...fact, id: 'no-reviewer', approved_by: ' ' }, { ...fact, id: 'no-source', source: '' },
]
const settings = {
  cta: { text: '테스트 상담 CTA', confirmed: true },
  sms_ad: { text: '확인 전 테스트 문구', confirmed: false },
  sms_opt_out: { text: '', confirmed: true },
}
const brief = {
  headline: '교육 상담 내용을 돌아보는 방법',
  external_problem: '상담 내용을 다시 확인해야 할 때가 있나요?',
  internal_problem: '정확히 답하고 싶은 마음에 부담이 생길 수 있습니다.',
  fundamental_problem: '학교 담당자는 교육에 집중할 수 있어야 합니다.',
  success: '상담의 흐름을 차분히 살펴보는 것을 목표로 합니다.',
  identity_change: '체계적으로 소통하는 학교를 지향합니다.',
  fact_ids: ['T2', 'T1'], tags: ['교육', '설치사례'],
}
const input = { installation_type: 'addition', region: ' 서울 ', field_note: '상담 사례' }
const configuration = async () => ({ facts, settings })
const editorial = {
  scene_heading: '다시 전화가 왔을 때', practice_heading: '교대를 준비할 때', checklist_heading: '다음 담당자가 확인할 일',
  checklist: ['남아 있는 질문', '다음 회신 담당자'],
}

test('valid input invokes the model once using only eligible facts, with ordered verbatim output', async () => {
  let calls = 0
  const result = await generate(input, {
    loadConfig: configuration,
    callModel: async (fields, allowed) => {
      calls++
      assert.deepEqual(fields, { ...input, region: '서울' })
      assert.deepEqual(allowed.map(f => f.id), ['T1', 'T2'])
      return brief
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.origin, 'model')
  assert.deepEqual(result.brief, brief)
  assert.deepEqual(result.used_facts, brief.fact_ids.map(id => {
    const { text, source } = facts.find(item => item.id === id)
    return { id, text, source }
  }))
  assert.deepEqual([result.cta_text, result.sms_ad_text, result.sms_opt_out_text], [settings.cta.text, null, null])
})

test('unconfirmed CTA and each unconfirmed SMS value are independently null', async () => {
  for (const [missing, field] of [['cta', 'cta_text'], ['sms_ad', 'sms_ad_text'], ['sms_opt_out', 'sms_opt_out_text']]) {
    const checked = Object.fromEntries(Object.keys(settings).map(key => [key, { text: key, confirmed: key !== missing }]))
    const result = await generate(input, { loadConfig: async () => ({ facts, settings: checked }), callModel: async () => brief })
    assert.equal(result[field], null)
    assert.equal(Object.values(result).filter(value => value === null).length, 1)
  }
})

test('missing or ambiguous source records stop before any model call', async () => {
  const callModel = () => assert.fail('model must not run')
  await assert.rejects(generate(input, { loadConfig: async () => ({ facts: [], settings }), callModel }),
    { status: 409, code: 'NO_APPROVED_FACTS' })
  await assert.rejects(generate(input, {
    loadConfig: async () => ({ facts: [fact, { ...fact, text: '다른 원문' }], settings }), callModel,
  }), { status: 409, code: 'NO_APPROVED_FACTS' })
})

test('invalid briefs and reference IDs cannot reach approval', async () => {
  const invalid = [
    null, { ...brief, headline: '' }, { ...brief, success: false }, { ...brief, tags: [] },
    { ...brief, tags: [' '] }, { ...brief, fact_ids: [] }, { ...brief, fact_ids: 'T1' },
    ...['unknown', 'other', 'pending', 'no-reviewer', 'no-source'].map(id => ({ ...brief, fact_ids: [id] })),
    { ...brief, fact_ids: ['T1', 'T1'] }, { ...brief, tags: ['효율１００％'] },
    { ...brief, internal_problem: '상담 번호 010-1234-5678' }, { ...brief, success: '문의는 example.test' },
  ]
  for (const value of invalid) {
    await assert.rejects(generate(input, { loadConfig: configuration, callModel: async () => value }),
      { status: 422, code: 'INVALID_BRIEF' })
  }
})

test('rich editorial sections follow the same provenance and structure rules as narrative', async () => {
  const run = metadata => generate(input, { loadConfig: configuration, callModel: async () => ({ ...brief, editorial: metadata }) })
  assert.deepEqual((await run(editorial)).brief.editorial, editorial)
  for (const invalid of [null, { ...editorial, checklist: [] }, { ...editorial, checklist: ['같음', '같음'] },
    { ...editorial, extra: '추가' }, { ...editorial, scene_heading: '상담 24시간' },
    { ...editorial, checklist: ['문의 www.example.test', '다음 담당자'] }]) {
    await assert.rejects(run(invalid), { status: 422, code: 'INVALID_BRIEF' })
  }
})

test('provider receives only input and candidate ID/text, uses one request, and excludes server provenance', async () => {
  let calls = 0
  const result = await requestModel(input, [fact], {
    apiKey: 'test-only',
    fetchImpl: async (url, init) => {
      calls++
      assert.equal(url, 'https://api.openai.com/v1/chat/completions')
      assert.equal(init.headers.Authorization, 'Bearer test-only')
      const request = JSON.parse(init.body)
      assert.equal(request.store, false)
      assert.ok(request.max_completion_tokens >= 6000)
      assert.ok(request.response_format.json_schema.schema.required.includes('editorial'))
      assert.deepEqual(request.response_format.json_schema.schema.properties.editorial.required,
        ['scene_heading', 'practice_heading', 'checklist_heading', 'checklist'])
      assert.deepEqual(JSON.parse(request.messages[1].content), {
        product: '녹취 제품', industry: '교육', ...input, candidates: [{ id: fact.id, text: fact.text }],
      })
      return Response.json({ choices: [{ message: { content: JSON.stringify(brief) } }] })
    },
  })
  assert.equal(calls, 1)
  assert.deepEqual(result, brief)
})

test('missing key, transport failure, invalid brief, and model timeout have distinct errors', async () => {
  await assert.rejects(requestModel(input, [fact], { apiKey: '' }), { status: 503, code: 'MODEL_UNAVAILABLE' })
  for (const status of [401, 429, 500, 504]) {
    const expected = status === 504 ? { status: 504, code: 'MODEL_TIMEOUT' } : { status: 503, code: 'MODEL_UNAVAILABLE' }
    await assert.rejects(requestModel(input, [fact], { apiKey: 'test', fetchImpl: async () => new Response('', { status }) }), expected)
  }
  await assert.rejects(requestModel(input, [fact], { apiKey: 'test', fetchImpl: async () => Response.json({ choices: [] }) }),
    { status: 422, code: 'INVALID_BRIEF' })
  await assert.rejects(requestModel(input, [fact], { apiKey: 'test', fetchImpl: async () => { throw new Error('offline') } }),
    { status: 503, code: 'MODEL_UNAVAILABLE' })
  for (const response of [
    new Response('invalid JSON'),
    Response.json({ choices: [{ message: { content: 'broken JSON' } }] }),
    Response.json({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(brief) } }] }),
  ]) {
    await assert.rejects(requestModel(input, [fact], { apiKey: 'test', fetchImpl: async () => response }),
      { status: 422, code: 'INVALID_BRIEF' })
  }
  const waitForTimeout = (_, { signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 1500)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  })
  await assert.rejects(requestModel(input, [fact], { apiKey: 'test', timeoutMs: 10, fetchImpl: waitForTimeout }),
    { status: 504, code: 'MODEL_TIMEOUT' })
})

const withoutFacts = body => generate(body, {
  loadConfig: async () => ({ facts: [], settings }),
  callModel: () => assert.fail('No facts means no model calls'),
})

async function requestApi(body, { contentType = 'application/json', method = 'POST', generateContent = withoutFacts } = {}) {
  const request = Readable.from([Buffer.from(body)])
  Object.assign(request, { method, url: '/api/generate', headers: { 'content-type': contentType } })
  const response = {
    setHeader() {},
    writeHead(status) { this.status = status },
    end(bytes) { this.body = JSON.parse(bytes) },
  }
  await makeHandler(generateContent)(request, response)
  return response
}

test('HTTP contract rejects invalid inputs before checking facts and returns 409 for valid data', async () => {
  for (const invalid of [
    'bad JSON', '[]', '{}', '{"installation_type":"bad"}', '{"installation_type":"new","region":null}',
    '{"installation_type":"new","field_note":3}', '{"installation_type":"new","photo":"filename.jpg"}',
  ]) {
    const response = await requestApi(invalid)
    assert.equal(response.status, 400)
    assert.equal(response.body.code, 'INVALID_INPUT')
  }
  assert.equal((await requestApi('{}', { contentType: 'text/plain' })).status, 400)
  assert.equal((await requestApi('', { method: 'GET' })).status, 405)
  for (const installation_type of ['new', 'addition', 'replacement']) {
    const response = await requestApi(JSON.stringify({ installation_type }))
    assert.equal(response.status, 409)
    assert.equal(response.body.code, 'NO_APPROVED_FACTS')
  }
})

test('HTTP responses propagate the model validation and transport outcome without exposing upstream data', async () => {
  const scenarios = [
    { upstream: () => Response.json({ choices: [{ message: { content: JSON.stringify(brief) } }] }), status: 200 },
    { upstream: () => Response.json({ choices: [{ message: { content: '{}' } }] }), status: 422, code: 'INVALID_BRIEF' },
    { upstream: () => new Response('private diagnostic', { status: 502 }), status: 503, code: 'MODEL_UNAVAILABLE' },
    { upstream: () => new Response('', { status: 504 }), status: 504, code: 'MODEL_TIMEOUT' },
  ]
  for (const scenario of scenarios) {
    let calls = 0
    const response = await requestApi(JSON.stringify(input), {
      generateContent: data => generate(data, {
        loadConfig: configuration,
        callModel: (normalized, eligible) => requestModel(normalized, eligible, {
          apiKey: 'isolated-test', fetchImpl: async () => { calls++; return scenario.upstream() },
        }),
      }),
    })
    assert.equal(calls, 1)
    assert.equal(response.status, scenario.status)
    if (scenario.status === 200) {
      assert.equal(response.body.origin, 'model')
      assert.deepEqual(response.body.brief, brief)
      assert.deepEqual(response.body.used_facts.map(f => f.id), brief.fact_ids)
    } else {
      assert.deepEqual(Object.keys(response.body).sort(), ['code', 'message'])
      assert.equal(response.body.code, scenario.code)
      assert.doesNotMatch(response.body.message, /private diagnostic|isolated-test/)
    }
  }
})
