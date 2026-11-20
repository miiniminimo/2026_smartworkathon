import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createNaverChromeSession } from './naver-chrome.mjs'

const exec = promisify(execFile)
const marker = 'TLink isolated draft fixture'
const pause = ms => new Promise(resolve => setTimeout(resolve,ms))

async function worker(action, profileDir) {
  const manager = createNaverChromeSession({profileDir,headless:true})
  const [context, same] = await Promise.all([manager.getContext(),manager.getContext()])
  assert.equal(context,same)
  if (action === 'leave-draft') {
    const tab = await context.newPage()
    await tab.goto('data:text/html,<title>'+encodeURIComponent(marker)+'</title><input id="draft">')
    await tab.locator('#draft').fill('unsaved fixture input')
  }
  if (action.startsWith('check')) {
    const preserved = []
    for (const tab of context.pages()) if (await tab.title() === marker) preserved.push(tab)
    assert.equal(preserved.length,1)
    assert.equal(await preserved[0].locator('#draft').inputValue(),'unsaved fixture input')
  }
  const owner = JSON.parse(await readFile(join(profileDir,'.tlink-chrome-session.json'),'utf8'))
  assert.equal(owner.profile,await realpath(profileDir))
  console.log(owner.pid)
  if (action === 'leave-draft') process.exit(0) // Simulate an adapter disappearing without cleanup.
  if (action === 'check-and-quit') {
    const client = await context.browser().newBrowserCDPSession()
    await client.send('Browser.close').catch(()=>{})
  }
  await manager.disconnect()
}

if (process.argv[2] === 'fixture-worker') {
  await worker(process.argv[3],process.argv[4])
} else {
  test('Chrome manager refuses pre-existing custom data outside its project-owned profile',async t=>{
    const dir = await mkdtemp(join(tmpdir(),'tlink-foreign-profile-test-'))
    t.after(()=>rm(dir,{recursive:true,force:true}))
    await writeFile(join(dir,'unrelated.txt'),'unrelated data')
    await assert.rejects(createNaverChromeSession({profileDir:dir,headless:true}).getContext(),/다른 Chrome 프로필/)
    await assert.rejects(readFile(join(dir,'.tlink-profile-owner')),{code:'ENOENT'})
  })

  test('detached fixture Chrome preserves one window, current tab and unsaved input across concurrent and restarted adapters',
    {skip: process.env.TLINK_TEST_DETACHED_CHROME !== '1', timeout:90000},async t=>{
    const temp = await mkdtemp(join(tmpdir(),'tlink-detached-fixture-'))
    const dir = join(temp,'test-profile')
    await mkdir(dir,{mode:0o700})
    const canonical = await realpath(dir)
    const metadata = join(dir,'.tlink-chrome-session.json')
    t.after(async()=>{
      // Last-resort teardown addresses only this test's private, positively identified child.
      const owner=await readFile(metadata,'utf8').then(JSON.parse).catch(()=>null)
      if (owner?.profile === canonical && process.platform !== 'win32') {
        const cmd=await exec('ps',['-p',String(owner.pid),'-o','command=']).catch(()=>null)
        if (cmd?.stdout.includes('--user-data-dir='+canonical)) {
          try {process.kill(owner.pid,'SIGTERM')} catch {}
          await pause(400)
        }
      }
      await rm(temp,{recursive:true,force:true,maxRetries:3,retryDelay:200})
    })
    const run=async action=>{
      const args=[fileURLToPath(import.meta.url),'fixture-worker',action,dir]
      const {stdout}=await exec(process.execPath,args,{timeout:35000})
      return Number(stdout.trim())
    }
    const [first,parallel] = await Promise.all([run('attach'),run('attach')])
    assert.ok(Number.isSafeInteger(first) && first > 1)
    assert.equal(parallel,first)
    assert.equal(await run('leave-draft'),first)
    assert.equal(await run('check-and-disconnect'),first)
    assert.equal(await run('check-and-quit'),first)
  })
}
