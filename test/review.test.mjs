import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewPolicy } from '../public/review.js'

const model = { origin: 'model', cta_text: '시험 상담', sms_ad_text: '시험 광고 표기', sms_opt_out_text: '시험 수신거부 안내' }
const demo = { origin: 'example', cta_text: null, sms_ad_text: null, sms_opt_out_text: null }
const reviewed = { copyReviewed: true, photoReviewed: true, accepted: true }
const tabs = ['card', 'blog', 'sms']

test('each channel needs two independent reviews and a separate approval', () => {
  for (const tab of tabs) {
    for (const copyReviewed of [false, true]) {
      for (const photoReviewed of [false, true]) {
        for (const accepted of [false, true]) {
          const state = reviewPolicy({ result: model, tab, copyReviewed, photoReviewed, accepted })
          assert.equal(state.canApprove, copyReviewed && photoReviewed)
          assert.equal(state.canExport, copyReviewed && photoReviewed && accepted)
        }
      }
    }
  }
})

test('cleared, unrecognized or unconfirmed live results cannot be approved or exported', () => {
  const cases = [
    { result: null, reason: /검토/u },
    { result: { ...model, origin: 'unrecognized' }, reason: /검토/u },
    { result: { ...model, cta_text: null }, reason: /상담 문구/u },
    { result: { ...model, cta_text: '  ' }, reason: /상담 문구/u },
  ]
  for (const { result, reason } of cases) {
    for (const tab of tabs) {
      const state = reviewPolicy({ result, tab, ...reviewed })
      assert.equal(state.canApprove, false)
      assert.equal(state.canExport, false)
      assert.match(state.lockReason, reason)
    }
  }
})

test('either missing SMS setting blocks only SMS and identifies what needs confirmation', () => {
  for (const [key, reason] of [['sms_ad_text', /광고 표기/u], ['sms_opt_out_text', /수신거부 안내/u]]) {
    const result = { ...model, [key]: null }
    for (const tab of tabs) {
      const state = reviewPolicy({ result, tab, ...reviewed })
      assert.equal(state.canApprove, true)
      assert.equal(state.canExport, tab !== 'sms')
      if (tab === 'sms') assert.match(state.lockReason, reason)
    }
  }
})

test('explicit demo review unlocks card and blog only, even if the example contains SMS settings', () => {
  for (const result of [demo, { ...model, origin: 'example' }]) {
    for (const tab of tabs) {
      const pending = reviewPolicy({ result, tab, ...reviewed, accepted: false })
      assert.equal(pending.canApprove, true)
      assert.equal(pending.canExport, false)
      const accepted = reviewPolicy({ result, tab, ...reviewed })
      assert.equal(accepted.canExport, tab !== 'sms')
      assert.match(accepted.lockReason, tab === 'sms' ? /검토용 초안/u : /데모 표기/u)
    }
  }
})
