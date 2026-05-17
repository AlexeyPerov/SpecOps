import type { TreeNode } from '../../../ipc/specOpsIpc'

export interface ExplorerContext {
  readonly treeRoot: HTMLElement
  readonly workspaceFolderPath: string | null
  readonly onFileClick: (absolutePath: string) => void
  readonly onFolderContextMenu: (absolutePath: string, clientX: number, clientY: number) => void
}

const EXPANDED_KEY = 'explorer-expanded'

function loadExpandedSet(): Set<string> {
  try {
    const raw = sessionStorage.getItem(EXPANDED_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

function saveExpandedSet(s: Set<string>): void {
  try {
    sessionStorage.setItem(EXPANDED_KEY, JSON.stringify([...s]))
  } catch {}
}

export function renderExplorer(
  ctx: ExplorerContext,
  nodes: readonly TreeNode[]
): void {
  const { treeRoot } = ctx
  treeRoot.innerHTML = ''

  if (!nodes.length) {
    const empty = document.createElement('div')
    empty.className = 'recents-empty'
    empty.textContent = ctx.workspaceFolderPath ? 'Empty folder' : 'No workspace folder set'
    treeRoot.appendChild(empty)
    return
  }

  const expanded = loadExpandedSet()
  const ul = document.createElement('ul')
  ul.className = 'explorer-tree'
  ul.setAttribute('role', 'tree')
  for (const node of nodes) {
    appendTreeNode(ul, node, expanded, ctx)
  }
  treeRoot.appendChild(ul)
}

function appendTreeNode(
  parent: HTMLElement,
  node: TreeNode,
  expanded: Set<string>,
  ctx: ExplorerContext
): void {
  const li = document.createElement('li')
  li.className = 'explorer-node'
  li.setAttribute('role', 'treeitem')
  li.dataset.path = node.absolutePath

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = node.isDirectory ? 'explorer-folder' : 'explorer-file'

  if (node.isDirectory) {
    const isExpanded = expanded.has(node.absolutePath)
    btn.innerHTML = `<span class="explorer-chevron">${isExpanded ? '▾' : '▸'}</span><span class="explorer-name">${escapeHtml(node.name)}</span>`
    btn.addEventListener('click', () => {
      if (expanded.has(node.absolutePath)) {
        expanded.delete(node.absolutePath)
      } else {
        expanded.add(node.absolutePath)
      }
      saveExpandedSet(expanded)
      const fresh = loadExpandedSet()
      renderExplorer(ctx, ((ctx.treeRoot as unknown as Record<string, unknown>).__explorerNodes as TreeNode[] | undefined) ?? [])
    })
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      ctx.onFolderContextMenu(node.absolutePath, e.clientX, e.clientY)
    })

    li.appendChild(btn)

    if (isExpanded && node.children.length > 0) {
      const childUl = document.createElement('ul')
      childUl.className = 'explorer-tree'
      childUl.setAttribute('role', 'group')
      for (const child of node.children) {
        appendTreeNode(childUl, child, expanded, ctx)
      }
      li.appendChild(childUl)
    }
  } else {
    btn.textContent = node.name
    btn.addEventListener('click', () => {
      ctx.onFileClick(node.absolutePath)
    })
    li.appendChild(btn)
  }

  parent.appendChild(li)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function storeExplorerNodes(root: HTMLElement, nodes: readonly TreeNode[]): void {
  ;(root as unknown as Record<string, unknown>).__explorerNodes = [...nodes]
}
