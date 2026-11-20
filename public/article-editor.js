import { renderBlogHtml, renderBlogMarkdown } from './blog-format.js'

const $ = id => document.getElementById(id)
const labels = { title: '제목', paragraph: '본문', heading: '소제목', quote: '인용문', list: '체크리스트' }

export function setupArticleEditor({ getDocument, getImage, applyEdits, revoke, refreshControls, canCopy, lockedReason, feedback }) {
  const mode = $('blog-view-mode')
  const fields = $('blog-editor-fields')
  const editError = document.createElement('p')
  editError.id = 'blog-editor-error'
  editError.className = 'error-text'
  editError.setAttribute('role', 'alert')
  editError.tabIndex = -1
  editError.hidden = true
  fields.before(editError)

  const modeHelp = document.createElement('span')
  modeHelp.id = 'blog-mode-help'
  modeHelp.className = 'helper'
  mode.setAttribute('aria-describedby', modeHelp.id)
  mode.after(modeHelp)

  let baseline = null
  let dirty = false
  let lastDocument
  let lastSrc

  function clearFields() {
    baseline = null
    dirty = false
    editError.hidden = true
    editError.textContent = ''
    fields.replaceChildren()
  }

  function draw(blog) {
    const doc = getDocument()
    const visible = Boolean(doc && blog)
    const locked = lockedReason()
    if (locked && mode.value === 'edit') {
      mode.value = 'preview'
      clearFields()
    }
    const edit = visible && mode.value === 'edit'
    const markdown = visible && mode.value === 'markdown'
    $('blog-toolbar').hidden = !visible
    $('blog-preview').hidden = !visible || edit || markdown
    $('blog-edit').hidden = !edit
    $('blog-markdown').hidden = !markdown
    $('copy-markdown').disabled = !visible || !canCopy() || dirty
    mode.querySelector('[value=edit]').disabled = Boolean(locked)
    modeHelp.textContent = locked || (dirty ? '저장 전 변경 있음' : '제목·본문 편집 가능')
    if (!visible) return
    const image = getImage()
    const source = image?.getAttribute('src') || image?.src
    if (lastDocument !== doc || lastSrc !== source) {
      $('blog-preview').innerHTML = renderBlogHtml(doc, { imageUrl: source, inlineStyles: false })
      $('blog-markdown').textContent = renderBlogMarkdown(doc, { imageUrl: '현장사진.jpg' })
      lastDocument = doc
      lastSrc = source
    }
  }

  function reset() {
    clearFields()
    mode.value = 'preview'
    lastDocument = lastSrc = null
    $('blog-preview').replaceChildren()
    $('blog-markdown').textContent = ''
    draw(false)
  }

  function start() {
    const doc = getDocument()
    if (!doc || lockedReason()) {
      mode.value = 'preview'
      return
    }
    clearFields()
    baseline = new Map()
    const entries = [{ id: 'title', type: 'title', text: doc.title }, ...doc.blocks.filter(block => block.editable)]
    for (const block of entries) {
      const value = block.type === 'list' ? block.items.join('\n') : block.text
      baseline.set(block.id, value)
      const label = document.createElement('label')
      const caption = document.createElement('span')
      caption.textContent = labels[block.type] || '본문'
      const field = document.createElement(['title', 'heading'].includes(block.type) ? 'input' : 'textarea')
      field.value = value
      field.dataset.field = block.id
      field.dataset.type = block.type
      if (field.tagName === 'TEXTAREA') field.rows = block.type === 'list' ? 4 : 3
      label.append(caption, field)
      fields.append(label)
    }
  }

  function changedValues() {
    const changes = {}
    if (baseline) {
      for (const field of fields.querySelectorAll('[data-field]')) {
        const id = field.dataset.field
        if (field.value !== baseline.get(id)) {
          changes[id] = field.dataset.type === 'list' ? field.value.split('\n').map(line => line.trim()).filter(Boolean) : field.value
        }
      }
    }
    return changes
  }

  function updateDirty(changes) {
    const pending = Object.keys(changes).length > 0
    if (dirty === pending) return
    dirty = pending
    if (dirty) revoke()
    else refreshControls()
  }

  fields.addEventListener('input', () => {
    editError.hidden = true
    updateDirty(changedValues())
  })

  // A view change commits valid edits. Invalid input remains in the active editor.
  function leave(next = 'preview') {
    if (!baseline) return true
    const changes = changedValues()
    updateDirty(changes)
    if (dirty) {
      try {
        applyEdits(changes)
      } catch (error) {
        mode.value = 'edit'
        editError.textContent = error.message
        editError.hidden = false
        refreshControls()
        editError.focus()
        return false
      }
      feedback('수정한 원고를 반영했습니다. 문구와 사진을 다시 검토해 주세요.')
    }
    clearFields()
    mode.value = next
    refreshControls()
    return true
  }

  mode.addEventListener('change', () => {
    if (mode.value === 'edit') start()
    else if (!leave(mode.value)) return
    refreshControls()
  })
  $('save-blog-edits').addEventListener('click', () => leave())
  $('cancel-blog-edits').addEventListener('click', () => {
    clearFields()
    mode.value = 'preview'
    refreshControls()
  })
  $('copy-markdown').addEventListener('click', async () => {
    if (dirty || !canCopy()) return
    try {
      await navigator.clipboard.writeText($('blog-markdown').textContent)
      feedback('Markdown을 복사했습니다. 사진 위치는 현장사진.jpg로 표시합니다.')
    } catch {
      feedback('Markdown 복사에 실패했습니다. 클립보드 권한을 확인해 주세요.')
    }
  })
  return { draw, reset, leave, hasUnsaved: () => dirty }
}

export function flattenedPhoto(image) {
  const canvas=document.createElement('canvas')
  const factor=Math.min(1,2200/Math.max(image.naturalWidth,image.naturalHeight))
  canvas.width=Math.max(1,Math.round(image.naturalWidth*factor));canvas.height=Math.max(1,Math.round(image.naturalHeight*factor))
  const context=canvas.getContext('2d')
  context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height)
  return canvas.toDataURL('image/jpeg',0.92)
}
