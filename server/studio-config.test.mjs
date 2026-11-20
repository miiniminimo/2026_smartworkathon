import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { handleStudioConfig } from './studio-config.mjs'

async function send(body, origin='http://127.0.0.1:3000') {
  const req=Readable.from(body ? [JSON.stringify(body)] : [])
  Object.assign(req,{method:body?'POST':'GET',socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:3000',origin,'content-type':'application/json'}})
  const res={writeHead(code){this.code=code},end(data){this.data=JSON.parse(data)}}
  await handleStudioConfig(req,res)
  return res
}
test('model access is checked on the server before accepting the key, target and approved source atomically',async t=>{
  const marker='test-secret-for-isolated-check'
  const baseline=await send()
  let available=false
  let calls=0
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    calls++
    assert.equal(url,'https://api.openai.com/v1/models/test-editor')
    assert.equal(options.headers.Authorization,'Bearer '+marker)
    return new Response(null,{status:available?200:401})
  })
  const payload={apiKey:marker,model:'test-editor',blogId:'test-blog',review:{text:'시험용 제품 원문',source:'내부 시험 자료',reviewer:'시험 담당자',cta:'시험 상담 안내',confirmed:true}}
  assert.equal((await send(payload,'https://elsewhere.invalid')).code,403)
  assert.equal((await send({...payload,review:{...payload.review,confirmed:false}})).code,400)
  assert.equal(calls,0)
  assert.equal((await send(payload)).code,400)
  assert.equal((await send()).data.blogId,baseline.data.blogId)
  available=true
  const saved=await send(payload)
  assert.equal(saved.code,200)
  assert.equal(saved.data.keyVerified,true)
  assert.equal(saved.data.factText,payload.review.text)
  assert.equal(saved.data.blogId,payload.blogId)
  assert.equal(JSON.stringify(saved.data).includes(marker),false)
  assert.equal((await send({model:'test-editor',blogId:'test-blog'})).code,200)
  assert.equal(calls,2)
})
