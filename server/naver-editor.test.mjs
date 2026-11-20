import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { blogLocation, confirmPost, confirmPostCandidate } from './naver-editor.mjs'

const origin = 'https://blog.naver.com'
const account = 'studio-fixture'
const title = '편집기 연결 점검'
const permalink = origin + '/' + account + '/321'

test('recognizes Naver blog homes and post addresses on trusted hosts only', () => {
  assert.deepEqual(blogLocation(permalink), { blogId: account, postId:'321' })
  assert.deepEqual(blogLocation('https://m.blog.naver.com/PostView.naver?blogId='+account+'&logNo=321'), { blogId:account, postId:'321' })
  assert.deepEqual(blogLocation(origin+'/PostList.naver?blogId='+account), { blogId:account, postId:'' })
  for (const invalid of [
    'https://other.invalid/'+account+'/321', 'https://blog.naver.com.invalid/'+account+'/321',
    'https://user@blog.naver.com/'+account+'/321', 'https://blog.naver.com:123/'+account+'/321',
    'http://blog.naver.com/'+account+'/321', origin+'/PostWriteForm.naver?blogId='+account,
    origin+'/PostView.naver?blogId='+account+'&logNo=not-a-post'
  ]) assert.equal(blogLocation(invalid),null)
})

function observedPage(top, frameUrl, titleText, state = {}) {
  return {
    isClosed: () => false, url: () => top,
    frames: () => [{
      url: () => frameUrl,
      evaluate: async () => ({ titles: titleText ? [titleText] : [], ogTitle: '', metas: [], matches: [], ...state }),
    }],
  }
}

test('publication confirmation requires the correct account, exact title and a numbered post', async () => {
  assert.equal(await confirmPost(observedPage(permalink,permalink,title),account,title),permalink)
  assert.equal(await confirmPost(observedPage(origin+'/'+account,permalink,title),account,title),permalink)
  for (const [top,frame,actual] of [
    [permalink,permalink,'다른 글 '+title], [origin+'/'+account,origin+'/'+account,title],
    ['https://elsewhere.invalid',permalink,title], [origin+'/another-account',permalink,title],
    [origin+'/'+account,origin+'/another-account/321',title],
  ]) assert.equal(await confirmPost(observedPage(top,frame,actual),account,title),null)
})

test('binds the top permalink to the expected article title in a same-account PostList child', async () => {
  const frame = origin + '/PostList.naver?blogId=' + account
  assert.equal(await confirmPost(observedPage(permalink, frame, title), account, title), permalink)
  assert.equal(await confirmPost(observedPage(permalink, frame, title.replace('편집기 ', '편집기')), account, title), null)
  assert.equal(await confirmPost(observedPage(permalink, frame, title, { titles: [title, '다른 글'] }), account, title), null)
  assert.equal(await confirmPost(observedPage(permalink, frame, title, { metas: [origin + '/' + account + '/999'] }), account, title), null)
})

test('canonical and og URLs in an actual same-account reader yield a permalink; missing or contradictory metadata does not', async () => {
  const home = origin + '/' + account
  const frame = origin + '/PostList.naver?blogId=' + account
  const canonical = '/PostView.naver?blogId=' + account + '&logNo=321'
  for (const state of [
    { titles: [title], metas: [canonical] },
    { titles: [], ogTitle: title, metas: [home, canonical, permalink] },
  ]) assert.equal(await confirmPost(observedPage(home, frame, '', state), account, title), permalink)
  for (const state of [
    { titles: ['틀린 제목'], ogTitle: title, metas: [canonical] },
    { titles: [title], metas: [origin + '/wrong/321'] },
    { titles: [title], metas: [canonical, origin + '/wrong/321'] },
    { titles: [title], metas: ['https://naver.example/321'] },
  ]) assert.equal(await confirmPost(observedPage(home, frame, '', state), account, title), null)
  assert.equal(await confirmPost(observedPage(home, origin + '/PostWriteForm.naver?blogId=' + account, title,
    { metas:[canonical] }), account, title), null)
})

function readContext(top, frame, titleText) {
  const visited = []
  let closed = 0
  const ctx = {
    newPage: async () => ({
      ...observedPage(top, frame, titleText), goto: async url => visited.push(url),
      close: async () => { closed++ },
    }),
  }
  return { ctx, visited, closed: () => closed }
}

test('opens one exact account-specific list result in a temporary reader and verifies the destination', async () => {
  const home = origin + '/' + account
  const list = origin + '/PostList.naver?blogId=' + account
  const makeList = matches => observedPage(home, list, '', { matches })
  const valid = readContext(permalink, permalink, title)
  const page = makeList([permalink, '/PostView.naver?blogId=' + account + '&logNo=321', origin + '/elsewhere/123'])
  page.context = () => valid.ctx
  assert.equal(await confirmPost(page, account, title), permalink)
  assert.deepEqual(valid.visited, [permalink])
  assert.equal(valid.closed(), 1)
  for (const candidates of [[permalink, origin + '/' + account + '/999'], [origin + '/other/321'], []]) {
    const ambiguous = makeList(candidates)
    ambiguous.context = () => { throw Error('should not navigate') }
    assert.equal(await confirmPost(ambiguous, account, title), null)
  }
})

test('directly supplied candidates refuse foreign URLs and do not accept redirects to another same-title post', async () => {
  const unsafe = { newPage: async () => { throw Error('must not open') } }
  for (const url of ['https://example.invalid', origin + '/wrong/321', origin + '/' + account, origin + '/PostWriteForm.naver']) {
    assert.equal(await confirmPostCandidate(unsafe, url, account, title), null)
  }
  const redirected = origin + '/' + account + '/999'
  const ctx = readContext(redirected, redirected, title)
  assert.equal(await confirmPostCandidate(ctx.ctx, permalink, account, title), null)
  assert.equal(ctx.closed(), 1)
})

test('reads article identity from account wrapper canonical while exact title is in the child reader', async () => {
  const home = origin + '/' + account
  const list = origin + '/PostList.naver?blogId=' + account
  const wrapper = observedPage(home, home, '', { metas:[permalink] })
  const child = observedPage(home, list, title)
  const page = { isClosed:()=>false, url:()=>home, frames:()=>[...wrapper.frames(),...child.frames()] }
  assert.equal(await confirmPost(page,account,title),permalink)
  const conflicting = observedPage(home, list, title, { metas:[origin + '/' + account + '/999'] })
  assert.equal(await confirmPost({...page, frames:()=>[...wrapper.frames(),...conflicting.frames()]},account,title),null)
})

test('extracts exact nested title labels from a rendered list row without following substring or body links', async () => {
  const home = origin + '/' + account
  const nodes = [
    { href: permalink, innerText: title + ' 댓글', label:title },
    { href: home + '/999', innerText: title + ' 다음 이야기', label:title + ' 다음 이야기' },
    { href: home + '/777', innerText: title, label:title, body:true },
  ].map(node => ({
    href:node.href, innerText:node.innerText, closest:()=>node.body, getAttribute:()=>null,
    querySelectorAll:()=>[{textContent:node.label}],
  }))
  const fixture = {
    querySelectorAll: select => select === 'a[href]' ? nodes : [],
    querySelector:()=>null,
  }
  const reader = readContext(permalink,permalink,title)
  const page = {
    isClosed:()=>false, url:()=>home, context:()=>reader.ctx,
    frames:()=>[{url:()=>home, evaluate:async (extract, expected) =>
      runInNewContext('(' + extract.toString() + ')(expected)', { document:fixture, expected })}],
  }
  assert.equal(await confirmPost(page,account,title),permalink)
  assert.deepEqual(reader.visited,[permalink])
})
