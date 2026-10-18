/** Array order is display order. IDs survive edits and moves. No legacy codecs. */
export interface TaskGroup { id: string; title: string }
export interface TaskList { id: string; title: string; groupId: string | null }
export interface WorkspaceTask { id: string; listId: string; text: string; completed: boolean }
export interface TaskBook { version: 1; groups: TaskGroup[]; lists: TaskList[]; tasks: WorkspaceTask[] }
export function emptyTaskBook(): TaskBook { return { version: 1, groups: [], lists: [], tasks: [] }; }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
export function parseTaskBook(content: string): TaskBook {
  const book: unknown = JSON.parse(content);
  const invalid = () => new Error('Invalid task document. Expected version 1 with unique IDs and valid group/list references.');
  if (!object(book) || book.version !== 1 || !Array.isArray(book.groups) || !Array.isArray(book.lists) || !Array.isArray(book.tasks)) throw invalid();
  const ids = new Set<string>();
  function id(value: unknown): boolean { if (!text(value) || ids.has(value)) return false; ids.add(value); return true; }
  for (const group of book.groups) if (!object(group) || !id(group.id) || !text(group.title)) throw invalid();
  const groups = new Set(book.groups.map(group => group.id));
  for (const list of book.lists) if (!object(list) || !id(list.id) || !text(list.title) || (list.groupId !== null && !groups.has(list.groupId))) throw invalid();
  const lists = new Set(book.lists.map(list => list.id));
  for (const task of book.tasks) if (!object(task) || !id(task.id) || !lists.has(task.listId) || !text(task.text) || typeof task.completed !== 'boolean') throw invalid();
  return book as unknown as TaskBook;
}
export function serializeTaskBook(book: TaskBook): string {
  const content = JSON.stringify(book, null, 2) + '\n';
  parseTaskBook(content);
  return content;
}
export type TaskBookAction =
  | { type: 'addGroup'; title: string } | { type: 'addList'; title: string; groupId: string | null }
  | { type: 'addTask'; text: string; listId: string }
  | { type: 'renameGroup' | 'renameList'; id: string; title: string }
  | { type: 'editTask'; id: string; text?: string; completed?: boolean }
  | { type: 'moveList'; id: string; groupId: string | null } | { type: 'moveTask'; id: string; listId: string }
  | { type: 'reorderGroup' | 'reorderList' | 'reorderTask'; id: string; direction: -1 | 1 }
  | { type: 'deleteGroup' | 'deleteList' | 'deleteTask'; id: string };
export function changeTaskBook(book: TaskBook, action: TaskBookAction): TaskBook {
  const next: TaskBook = structuredClone(book);
  const find = <T extends { id: string }>(items: T[], id: string): T => {
    const item = items.find(item => item.id === id);
    if (!item) throw new Error('This item no longer exists.');
    return item;
  };
  const title = (value: string) => { if (!value.trim()) throw new Error('A name or task text is required.'); return value.trim(); };
  switch (action.type) {
    case 'addGroup': next.groups.push({ id: crypto.randomUUID(), title: title(action.title) }); break;
    case 'addList': next.lists.push({ id: crypto.randomUUID(), title: title(action.title), groupId: action.groupId }); break;
    case 'addTask': next.tasks.push({ id: crypto.randomUUID(), text: title(action.text), listId: action.listId, completed: false }); break;
    case 'renameGroup': find(next.groups, action.id).title = title(action.title); break;
    case 'renameList': find(next.lists, action.id).title = title(action.title); break;
    case 'editTask': {
      const task = find(next.tasks, action.id);
      if (action.text !== undefined) task.text = title(action.text);
      if (action.completed !== undefined) task.completed = action.completed;
      break;
    }
    case 'moveList': {
      const list = find(next.lists, action.id);
      if (list.groupId !== action.groupId) { list.groupId = action.groupId; next.lists = [...next.lists.filter(item => item.id !== list.id), list]; }
      break;
    }
    case 'moveTask': {
      const task = find(next.tasks, action.id);
      if (task.listId !== action.listId) { task.listId = action.listId; next.tasks = [...next.tasks.filter(item => item.id !== task.id), task]; }
      break;
    }
    case 'deleteGroup':
      next.groups = next.groups.filter(group => group.id !== action.id);
      // Removing a group keeps its lists and tasks in the ungrouped section.
      next.lists.forEach(list => { if (list.groupId === action.id) list.groupId = null; });
      break;
    case 'deleteList': next.lists = next.lists.filter(list => list.id !== action.id); next.tasks = next.tasks.filter(task => task.listId !== action.id); break;
    case 'deleteTask': next.tasks = next.tasks.filter(task => task.id !== action.id); break;
    case 'reorderGroup': case 'reorderList': case 'reorderTask': {
      const { id, direction } = action;
      function reorder<T extends { id: string }>(items: T[], sameScope: (candidate: T, item: T) => boolean): void {
        const item = find(items, id);
        const siblings = items.filter(candidate => sameScope(candidate, item));
        const neighbor = siblings[siblings.indexOf(item) + direction];
        if (neighbor) {
          const from = items.indexOf(item); const to = items.indexOf(neighbor);
          [items[from], items[to]] = [items[to], items[from]];
        }
      }
      if (action.type === 'reorderGroup') reorder(next.groups, () => true);
      else if (action.type === 'reorderList') reorder(next.lists, (a, b) => a.groupId === b.groupId);
      else reorder(next.tasks, (a, b) => a.listId === b.listId);
      break;
    }
  }
  parseTaskBook(JSON.stringify(next));
  return next;
}
export function taskBookMarkdown(book: TaskBook): string {
  const line = (value: string) => value.replace(/[\r\n]+/g, ' ');
  const result = ['# Tasks', ''];
  for (const group of [null, ...book.groups]) {
    const lists = book.lists.filter(list => list.groupId === (group?.id ?? null));
    if (!lists.length) continue;
    result.push(`## ${group ? line(group.title) : 'Ungrouped'}`, '');
    for (const list of lists) {
      result.push(`### ${line(list.title)}`, '');
      result.push(...book.tasks.filter(task => task.listId === list.id).map(task => `- [${task.completed ? 'x' : ' '}] ${line(task.text)}`), '');
    }
  }
  return result.join('\n');
}
