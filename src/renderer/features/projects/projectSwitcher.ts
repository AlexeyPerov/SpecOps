import type { SpecOpsPreloadApi } from '../../../preload/specOpsApi'
import type { AppStore } from '../../../core/state/store'

export interface ProjectSwitcherContext {
  readonly root: HTMLElement
  readonly store: AppStore
  readonly specOps: SpecOpsPreloadApi
  readonly runAfterDirtyPrompt: (action: () => void | Promise<void>) => Promise<void>
  readonly onProjectActivated?: (projectId: string) => void | Promise<void>
}

/** Project add flow (folder-scoped); respects dirty buffer via `runAfterDirtyPrompt`. */
export function wireProjectSwitcher(ctx: ProjectSwitcherContext): void {
  const addBtn = ctx.root.querySelector<HTMLButtonElement>('#btn-add-project')
  if (!addBtn) return

  const PROJECT_ACCENTS = [
    '#f59e0b',
    '#ef4444',
    '#22c55e',
    '#3b82f6',
    '#a855f7',
    '#f97316',
    '#14b8a6',
    '#e11d48',
    '#84cc16',
    '#6366f1'
  ] as const

  function normalizeProjectPath(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
  }

  function randomAccent(): string {
    const idx = Math.floor(Math.random() * PROJECT_ACCENTS.length)
    return PROJECT_ACCENTS[idx] ?? '#6f7684'
  }

  async function activateProject(projectId: string): Promise<void> {
    ctx.store.dispatch({ type: 'SET_ACTIVE_PROJECT', projectId })
    await Promise.resolve(ctx.onProjectActivated?.(projectId))
  }

  addBtn.addEventListener('click', () => {
    void ctx.runAfterDirtyPrompt(async () => {
      const folder = await ctx.specOps.pickWorkspaceFolder()
      if (!folder) return
      const normalized = normalizeProjectPath(folder)
      const existing = [...ctx.store.getState().projectsById.entries()].find(([, p]) => {
        const raw = p.workspaceFolderPath?.trim()
        return raw ? normalizeProjectPath(raw) === normalized : false
      })
      if (existing) {
        await activateProject(existing[0])
        return
      }
      const projectId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
      ctx.store.dispatch({
        type: 'CREATE_PROJECT',
        projectId,
        workspaceFolderPath: folder,
        accentColor: randomAccent()
      })
      await activateProject(projectId)
    })
  })

}
