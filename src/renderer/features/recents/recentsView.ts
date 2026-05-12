import type { AppState } from '../../../core/state/types'
import { groupsForPresentation, isFolderExpanded } from '../../../core/state/fileListPresentation'

export function triggerWorkspaceMotion(workspaceEl: HTMLElement): void {
  const msRaw = getComputedStyle(workspaceEl).getPropertyValue('--motion-file-switch-ms').trim()
  const ms = parseFloat(msRaw) || 180
  workspaceEl.classList.remove('workspace--transition')
  requestAnimationFrame(() => {
    workspaceEl.classList.add('workspace--transition')
    window.setTimeout(() => workspaceEl.classList.remove('workspace--transition'), ms)
  })
}

export function renderRecents(listRoot: HTMLElement, state: AppState): void {
  listRoot.innerHTML = ''

  if (!state.recentDocumentIds.length) {
    const empty = document.createElement('div')
    empty.className = 'recents-empty'
    empty.textContent = 'No documents yet'
    listRoot.appendChild(empty)
    return
  }

  const groups = groupsForPresentation(state)

  if (state.fileListGrouping === 'none') {
    const flat = groups[0]
    const ul = document.createElement('ul')
    ul.className = 'recent-items'
    ul.setAttribute('role', 'list')
    for (const id of flat.ids) appendRecentRow(ul, id, state)
    listRoot.appendChild(ul)
    return
  }

  const wrap = document.createElement('div')
  wrap.className = 'recent-groups'
  for (const g of groups) {
    const section = document.createElement('section')
    section.className = 'recent-group'
    section.dataset.folderKey = g.key

    const headerBtn = document.createElement('button')
    headerBtn.type = 'button'
    headerBtn.className = 'recent-group-header'
    headerBtn.dataset.folderKey = g.key
    const expanded = isFolderExpanded(state, g.key)
    headerBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false')
    headerBtn.innerHTML = `<span class="recent-group-chevron">${expanded ? '▾' : '▸'}</span><span class="recent-group-label">${g.label}</span>`

    const ul = document.createElement('ul')
    ul.className = 'recent-items'
    ul.setAttribute('role', 'list')
    ul.hidden = !expanded
    for (const id of g.ids) appendRecentRow(ul, id, state)

    section.appendChild(headerBtn)
    section.appendChild(ul)
    wrap.appendChild(section)
  }
  listRoot.appendChild(wrap)
}

function appendRecentRow(ul: HTMLElement, id: string, state: AppState): void {
  const doc = state.documentsById.get(id)
  const label = doc?.title?.trim() || id

  const li = document.createElement('li')
  li.dataset.recentDocId = id

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'recent-item'
  btn.dataset.recentDocId = id
  btn.textContent = label

  if (state.currentDocumentId === id) {
    btn.setAttribute('aria-current', 'true')
    btn.classList.add('recent-item--selected')
  }

  li.appendChild(btn)
  ul.appendChild(li)
}
