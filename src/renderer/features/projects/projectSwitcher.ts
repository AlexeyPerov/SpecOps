import type { SpecOpsPreloadApi } from '../../../preload/specOpsApi'
import type { AppStore } from '../../../core/state/store'
import { DEFAULT_PROJECT_ID } from '../../../core/state/transitions'
import { pathBasename } from '../../../core/util/paths'

export interface ProjectSwitcherContext {
  readonly root: HTMLElement
  readonly store: AppStore
  readonly specOps: SpecOpsPreloadApi
  readonly runAfterDirtyPrompt: (action: () => void | Promise<void>) => Promise<void>
}

function projectLabel(projectId: string, workspaceFolderPath: string | null): string {
  if (projectId === DEFAULT_PROJECT_ID) return 'Default'
  const folder = workspaceFolderPath?.trim()
  if (!folder) return 'Project'
  return pathBasename(folder) || 'Project'
}

/** Toolbar project dropdown + add-project (folder-scoped); respects dirty buffer via `runAfterDirtyPrompt`. */
export function wireProjectSwitcher(ctx: ProjectSwitcherContext): void {
  const select = ctx.root.querySelector<HTMLSelectElement>('#project-switcher')
  const addBtn = ctx.root.querySelector<HTMLButtonElement>('#btn-add-project')
  if (!select || !addBtn) return

  let syncingFromStore = false

  function renderOptions(): void {
    const st = ctx.store.getState()
    const ids = [...st.projectsById.keys()].sort((a, b) => {
      if (a === DEFAULT_PROJECT_ID) return -1
      if (b === DEFAULT_PROJECT_ID) return 1
      return a.localeCompare(b)
    })
    const nextValue = st.activeProjectId
    select.innerHTML = ''
    for (const id of ids) {
      const p = st.projectsById.get(id)!
      const opt = document.createElement('option')
      opt.value = id
      opt.textContent = projectLabel(id, p.workspaceFolderPath)
      select.appendChild(opt)
    }
    syncingFromStore = true
    select.value = ids.includes(nextValue) ? nextValue : ids[0] ?? ''
    syncingFromStore = false
  }

  select.addEventListener('change', () => {
    if (syncingFromStore) return
    const id = select.value
    if (!id) return
    void ctx.runAfterDirtyPrompt(() => {
      ctx.store.dispatch({ type: 'SET_ACTIVE_PROJECT', projectId: id })
    })
  })

  addBtn.addEventListener('click', () => {
    void ctx.runAfterDirtyPrompt(async () => {
      const folder = await ctx.specOps.pickWorkspaceFolder()
      if (!folder) return
      const projectId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
      ctx.store.dispatch({
        type: 'CREATE_PROJECT',
        projectId,
        workspaceFolderPath: folder
      })
      ctx.store.dispatch({ type: 'SET_ACTIVE_PROJECT', projectId })
    })
  })

  renderOptions()
  ctx.store.subscribe(renderOptions)
}
