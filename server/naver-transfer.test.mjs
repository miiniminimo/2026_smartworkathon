import test from 'node:test'
import assert from 'node:assert/strict'
import { assessEditorTransfer } from './naver-editor.mjs'

const article = {
  title:'테스트 원고',tags:['편집기검토'],blocks:[
    {type:'paragraph',text:'첫 상담을 어떻게 준비할까요?'},
    {type:'image',caption:'현장 사진'},
    {type:'heading',text:'상담 창구'},
    {type:'fact',text:'확인된 수치는 12.3%입니다.'},
    {type:'paragraph',text:'다음 상담에서 “약속”을 이어 갑니다.'},
    {type:'cta',text:'상담 안내를 확인해 주세요.'}
  ]
}
const before = article.blocks[0].text
const after = article.blocks[1].caption + article.blocks.slice(2).map(b=>b.text).join('') + '#편집기검토'
const snapshot = {before,after,titleParts:[article.title],photoLoaded:true}

test('verified handoff requires all original blocks on their expected sides of the photo',()=>{
  assert.deepEqual(assessEditorTransfer(snapshot,article),{layout:'verified'})
  assert.equal(assessEditorTransfer({...snapshot,before:before+article.blocks[1].caption,after:after.replace(article.blocks[1].caption,'')},article).layout,'review')
  const swapped = after.replace('현장 사진상담 창구','상담 창구현장 사진')
  assert.match(assessEditorTransfer({...snapshot,after:swapped},article).detail,/순서/u)
  assert.equal(assessEditorTransfer({...snapshot,after:after.replace('상담 창구','')},article).layout,'review')
})

test('format-only quote conversion asks for a visual check; meaningful numeric changes remain uncertain',()=>{
  const converted = after.replace('“약속”','"약속"')
  assert.match(assessEditorTransfer({...snapshot,after:converted},article).detail,/문장부호/u)
  assert.throws(()=>assessEditorTransfer({...snapshot,after:after.replace('12.3%','123%')},article),/근거 문구 1/u)
})

test('missing title, decoded photo, first/last narrative, individual facts or CTA cannot return draft',()=>{
  for(const [change,problem] of [
    [{titleParts:['테스트 원고 수정']},/글 제목/u],
    [{photoLoaded:false},/현장 사진/u],
    [{before:''},/첫 본문 문단/u],
    [{after:after.replace(article.blocks.at(-2).text,'')},/마지막 본문 문단/u],
    [{after:after.replace(article.blocks.at(-1).text,'')},/마무리 안내/u]
  ]) assert.throws(()=>assessEditorTransfer({...snapshot,...change},article),problem)
})
