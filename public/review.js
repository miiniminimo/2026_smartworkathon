const confirmed = value => typeof value === 'string' && value.trim().length > 0

// Callers supply only the result for the current inputs. A new request or edit clears it.
export function reviewPolicy({ result, tab, copyReviewed, photoReviewed, accepted }) {
  if (!result || !['model', 'example', 'rehearsal'].includes(result.origin)) {
    return { canApprove: false, canExport: false, lockReason: '검토 및 승인 후 내보낼 수 있습니다.' }
  }
  const demo = result.origin === 'example'
  if (!demo && !confirmed(result.cta_text)) {
    return { canApprove: false, canExport: false, lockReason: '승인 불가 · 확인된 상담 문구가 필요합니다.' }
  }

  const canApprove = copyReviewed === true && photoReviewed === true
  if (tab === 'sms') {
    const missing = []
    if (!confirmed(result.sms_ad_text)) missing.push('광고 표기')
    if (!confirmed(result.sms_opt_out_text)) missing.push('수신거부 안내')
    if (demo || missing.length) {
      const reason = demo ? '예시 문자는 발송용으로 복사할 수 없습니다.' : missing.join('·') + ' 확인이 필요합니다.'
      return { canApprove, canExport: false, lockReason: '검토용 초안 · ' + reason }
    }
  }

  const canExport = canApprove && accepted === true && ['card', 'blog', 'sms'].includes(tab)
  if (canExport) {
    return { canApprove, canExport, lockReason: demo ? '데모 표기가 포함된 결과를 내보낼 수 있습니다.' : '현재 결과를 내보낼 수 있습니다.' }
  }
  return {
    canApprove, canExport,
    lockReason: demo ? '두 항목을 확인하고 데모 검토를 완료해 주세요.' : '두 항목을 확인하고 검토 완료·승인을 눌러 주세요.',
  }
}
