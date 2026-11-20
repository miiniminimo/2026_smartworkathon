import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, chmod, lstat, mkdir, readFile, readdir, readlink, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir, hostname } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const defaultProfile = fileURLToPath(new URL('../.studio-runtime/naver-profile', import.meta.url))
const ownerName = '.tlink-profile-owner'
const sessionName = '.tlink-chrome-session.json'
const lockName = '.tlink-chrome-start.lock'
const signature = 'tlink-dedicated-naver-profile-v1\n'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function optionalFile(path) {
  try {
    if (!(await lstat(path)).isFile()) throw Error('전용 Chrome 상태 파일 형식을 확인해 주세요.')
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

async function dedicatedDirectory(path) {
  const dir = resolve(path)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const stat = await lstat(dir)
  if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) throw Error('개인 전용 디렉터리가 필요합니다.')
  const canonical = await realpath(dir)
  const defaultCanonical = join(await realpath(fileURLToPath(new URL('../', import.meta.url))), '.studio-runtime', 'naver-profile')
  if (dir === resolve(defaultProfile) && canonical !== defaultCanonical) throw Error('프로젝트 전용 Chrome 디렉터리 경로를 확인해 주세요.')
  const marker = join(canonical, ownerName)
  const owner = await optionalFile(marker)
  if (!owner) {
    // Only the original project-owned Playwright profile can be migrated in place.
    // A custom path must be an empty directory or carry this manager's marker.
    if (canonical !== defaultCanonical && (await readdir(canonical)).some(name => name !== ownerName)) {
      if (await optionalFile(marker) !== signature) throw Error('다른 Chrome 프로필을 사용할 수 없습니다. 새로운 전용 디렉터리를 선택해 주세요.')
    }
    try { await writeFile(marker, signature, {flag:'wx',mode:0o600}) }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      // Another adapter can win exclusive creation just before its write completes.
      let written = await optionalFile(marker)
      for (let wait=0; !written && wait<5; wait++) { await pause(20); written = await optionalFile(marker) }
      if (written !== signature) throw error
    }
  } else if (owner !== signature) throw Error('티링크 전용 Chrome 프로필을 확인할 수 없습니다.')
  if (process.platform !== 'win32' && (stat.mode & 0o077)) await chmod(canonical, 0o700)
  return canonical
}

async function executable(override) {
  let candidates
  if (override) {
    if (!isAbsolute(override)) throw Error('Chrome 실행 파일의 절대 경로를 지정해 주세요.')
    candidates = [override]
  } else if (process.platform === 'darwin') {
    const app = 'Google Chrome.app/Contents/MacOS/Google Chrome'
    candidates = [join('/Applications', app), join(homedir(),'Applications', app)]
  } else if (process.platform === 'win32') {
    candidates = [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA]
      .filter(Boolean).map(root => join(root,'Google','Chrome','Application','chrome.exe'))
  } else {
    candidates = (process.env.PATH || '/usr/bin:/opt/google/chrome').split(delimiter)
      .flatMap(dir => ['google-chrome','google-chrome-stable','chromium','chromium-browser'].map(bin => join(dir,bin)))
  }
  for (const path of candidates) {
    try { await access(path, constants.X_OK); return path } catch { /* Try the next standard install. */ }
  }
  throw Error('기기에 설치된 Chrome을 찾을 수 없습니다.')
}

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

function parse(value) {
  try { return JSON.parse(value) } catch { return null }
}

async function endpoint(dir) {
  // Chrome chooses an ephemeral loopback port and a fresh opaque browser path.
  const value = (await optionalFile(join(dir,'DevToolsActivePort'))).trim().split(/\r?\n/u)
  const port = Number(value[0])
  if (!Number.isInteger(port) || port <= 0 || port > 65535 || !/^\/devtools\/browser\/[a-f0-9-]{36}$/i.test(value[1] || '')) return ''
  return 'ws://127.0.0.1:' + port + value[1]
}

async function remember(dir, data) {
  const name = join(dir, sessionName)
  const temp = name + '.' + randomUUID()
  await writeFile(temp, JSON.stringify(data), {mode:0o600})
  await rename(temp,name)
}

async function connected(dir, saved, headless) {
  if (!saved || !alive(saved.pid) || saved.profile !== dir) return null
  const url = await endpoint(dir)
  if (!url || (saved.url ? url !== saved.url : url === saved.previous)) return null
  // No discovery on other ports, no attachment to the user's everyday browser.
  const browser = await chromium.connectOverCDP(url, {timeout:1800, noDefaults:true})
  const context = browser.contexts()[0]
  if (!context) { await browser.close(); throw Error('전용 Chrome 기본 창을 사용할 수 없습니다.') }
  if (!headless) {
    try { await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'https://blog.naver.com'}) }
    catch (error) { await browser.close(); throw error }
  }
  return {browser,context,url}
}

async function legacyWindowOpen(dir) {
  // A running older, pipe-controlled instance must never be interrupted or adopted.
  if (process.platform === 'win32') return false
  try {
    const lock = await readlink(join(dir,'SingletonLock'))
    const split = lock.lastIndexOf('-')
    return lock.slice(0,split) === hostname() && alive(Number(lock.slice(split+1)))
  } catch (error) {
    if (['ENOENT','EINVAL'].includes(error.code)) return false
    throw error
  }
}

async function launchAndConnect(dir, options) {
  const savedPath = join(dir, sessionName)
  const lockPath = join(dir, lockName)
  const timeout = Date.now() + 25000
  const lockId = JSON.stringify({pid:process.pid, nonce:randomUUID()})
  while (Date.now() < timeout) {
    const saved = parse(await optionalFile(savedPath))
    const attached = await connected(dir, saved, options.headless)
    if (attached) return attached
    try { await writeFile(lockPath,lockId,{flag:'wx',mode:0o600}) }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      const content = await optionalFile(lockPath)
      const holder = parse(content)
      // An incomplete lock is young while another process is still writing it.
      const info = await lstat(lockPath).catch(() => null)
      if (info && (holder ? !alive(holder.pid) : Date.now()-info.mtimeMs > 10000) && await optionalFile(lockPath) === content) {
        await unlink(lockPath).catch(err => { if (err.code !== 'ENOENT') throw err })
      }
      await pause(100)
      continue
    }
    try {
      let current = parse(await optionalFile(savedPath))
      const existing = await connected(dir, current, options.headless)
      if (existing) return existing
      if (!current || !alive(current.pid) || current.profile !== dir) {
        if (await legacyWindowOpen(dir)) throw Error('기존 전용 창이 열려 있습니다. 창을 직접 닫은 후 새 연결 방식을 사용해 주세요.')
        const previous = await endpoint(dir)
        const env = {...process.env}
        delete env.OPENAI_API_KEY
        delete env.NAVER_MCP_TOKEN
        const args = ['--user-data-dir='+dir,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',
          '--no-first-run','--no-default-browser-check','--lang=ko-KR']
        if (options.headless) args.push('--headless=new','--disable-background-networking','--disable-sync','--no-proxy-server','--host-resolver-rules=MAP * ~NOTFOUND','--use-mock-keychain')
        const child = spawn(await executable(options.executablePath), [...args,'about:blank'], {
          detached:true,stdio:'ignore',env,windowsHide:false
        })
        await new Promise((resolve,reject) => {child.once('spawn',resolve);child.once('error',reject)})
        child.unref()
        current = { pid:child.pid, profile:dir, previous }
        await remember(dir,current)
      }
      while (Date.now() < timeout && alive(current.pid)) {
        const ready = await connected(dir, current, options.headless)
        if (ready) {
          await remember(dir,{pid:current.pid,profile:dir,url:ready.url})
          return ready
        }
        await pause(100)
      }
      throw Error('전용 Chrome에 연결하지 못했습니다. 전용 창의 상태를 확인해 주세요.')
    } finally {
      if (await optionalFile(lockPath) === lockId) await unlink(lockPath)
    }
  }
  throw Error('다른 스튜디오의 전용 Chrome 시작이 끝나지 않았습니다.')
}

// Closing a CDP-connected Playwright Browser disconnects only this client.
// The detached Chrome process and its existing tabs belong to the operator.
export function createNaverChromeSession({
  profileDir=process.env.NAVER_PROFILE_DIR || defaultProfile,
  executablePath=process.env.NAVER_CHROME_PATH, headless=false
}={}) {
  let active
  async function getContext() {
    if (active) return (await active).context
    const attempt = dedicatedDirectory(profileDir).then(dir => launchAndConnect(dir,{executablePath,headless}))
    active = attempt
    try {
      const {browser,context} = await attempt
      browser.once('disconnected',()=>{if(active === attempt) active = null})
      return context
    } catch (error) { if(active === attempt) active = null; throw error }
  }
  async function disconnect() {
    const attempt = active
    active = null
    const attached = await attempt?.catch(()=>null)
    if (attached) await attached.browser.close()
  }
  return {getContext,disconnect}
}

const session = createNaverChromeSession()
export const getNaverBrowserContext = session.getContext
export const disconnectNaverBrowser = session.disconnect
