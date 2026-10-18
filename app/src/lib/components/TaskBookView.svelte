<script lang="ts">
  import { changeTaskBook, parseTaskBook, serializeTaskBook, taskBookMarkdown, type TaskBookAction } from '../services/workspaceTasks';
  let { content, onchange, notify }: { content: string; onchange: (content: string) => void; notify: (message: string) => void } = $props();
  let selectedId = $state<string | null>(null);
  let groupName = $state('');
  let listName = $state('');
  let newListGroup = $state('');
  let taskText = $state('');
  let search = $state('');
  let filter = $state('all');
  let removed = $state<{ before: string; after: string } | null>(null);
  const parsed = $derived.by(() => {
    try { return { book: parseTaskBook(content), error: '' }; }
    catch (error) { return { book: null, error: String(error) }; }
  });
  const book = $derived(parsed.book);
  const selected = $derived(book?.lists.find(list => list.id === selectedId) ?? book?.lists[0]);
  const tasks = $derived(book?.tasks.filter(task => task.listId === selected?.id) ?? []);
  const visibleTasks = $derived(tasks.filter(task => (filter === 'all' || task.completed === (filter === 'completed')) && task.text.toLocaleLowerCase().includes(search.toLocaleLowerCase())));
  function change(action: TaskBookAction): boolean {
    if (!book) return false;
    try {
      const next = serializeTaskBook(changeTaskBook(book, action));
      removed = action.type.startsWith('delete') ? { before: content, after: next } : null;
      onchange(next);
      if (action.type === 'addList') selectedId = parseTaskBook(next).lists.at(-1)?.id ?? null;
      if (action.type === 'deleteGroup' && action.id === newListGroup) newListGroup = '';
      return true;
    } catch (error) { notify(String(error)); return false; }
  }
  function undo(): void {
    if (removed && content === removed.after) { onchange(removed.before); removed = null; }
  }
  async function copyMarkdown(): Promise<void> {
    if (!book) return;
    try { await navigator.clipboard.writeText(taskBookMarkdown(book)); notify('Tasks copied as Markdown.'); }
    catch (error) { notify(`Could not copy tasks: ${String(error)}`); }
  }
</script>

{#if parsed.error}
  <div class="invalid" role="alert">{parsed.error}<p>The file has been kept unchanged. Correct the JSON file on disk, then reload the document.</p></div>
{:else if book}
  <div class="taskbook">
    <aside aria-label="Task lists">
      <div class="sidebar-heading"><strong>Lists</strong><button class="btn btn-sm btn-ghost" type="button" onclick={() => { void copyMarkdown(); }}>Copy Markdown</button></div>
      {#each [null, ...book.groups] as group (group?.id ?? 'ungrouped')}
        {@const lists = book.lists.filter(list => list.groupId === (group?.id ?? null))}
        <section class="group" aria-label={group?.title ?? 'Ungrouped'}>
          <div class="group-heading">
            {#if group}
              <input class="group-title" aria-label="Group name" value={group.title} onchange={(event) => change({ type: 'renameGroup', id: group.id, title: event.currentTarget.value })} />
              <button class="icon" type="button" aria-label={`Move group ${group.title} up`} disabled={book.groups[0]?.id === group.id} onclick={() => change({ type: 'reorderGroup', id: group.id, direction: -1 })}>↑</button>
              <button class="icon" type="button" aria-label={`Move group ${group.title} down`} disabled={book.groups.at(-1)?.id === group.id} onclick={() => change({ type: 'reorderGroup', id: group.id, direction: 1 })}>↓</button>
              <button class="icon" type="button" aria-label={`Delete group ${group.title}`} title="Remove group and keep its lists" onclick={() => change({ type: 'deleteGroup', id: group.id })}>×</button>
            {:else}<span>Ungrouped</span>{/if}
          </div>
          {#each lists as list (list.id)}
            <button type="button" class="list-link" class:active={selected?.id === list.id} aria-pressed={selected?.id === list.id} onclick={() => { selectedId = list.id; taskText = ''; }}>
              <span>{list.title}</span><small>{book.tasks.filter(task => task.listId === list.id && !task.completed).length}</small>
            </button>
          {/each}
        </section>
      {/each}
      <form onsubmit={(event) => { event.preventDefault(); if (groupName.trim()) { if (change({ type: 'addGroup', title: groupName })) groupName = ''; } }}>
        <input aria-label="New group" placeholder="New group…" bind:value={groupName} />
        <button class="btn btn-sm" type="submit" disabled={!groupName.trim()}>Add group</button>
      </form>
      <form onsubmit={(event) => { event.preventDefault(); if (listName.trim()) { if (change({ type: 'addList', title: listName, groupId: newListGroup || null })) listName = ''; } }}>
        <input aria-label="New list" placeholder="New list…" bind:value={listName} />
        <select aria-label="Group for new list" bind:value={newListGroup}>
          <option value="">Ungrouped</option>{#each book.groups as group (group.id)}<option value={group.id}>{group.title}</option>{/each}
        </select>
        <button class="btn btn-sm" type="submit" disabled={!listName.trim()}>Add list</button>
      </form>
    </aside>
    <main>
      {#if removed && content === removed.after}
        <div class="undo" role="status">Removed. <button class="btn btn-sm" type="button" onclick={undo}>Undo deletion</button></div>
      {/if}
      {#if selected}
        {@const siblings = book.lists.filter(list => list.groupId === selected.groupId)}
        <div class="list-heading">
          <input class="list-title" aria-label="List name" value={selected.title} onchange={(event) => { if (selected) change({ type: 'renameList', id: selected.id, title: event.currentTarget.value }); }} />
          <select aria-label="List group" value={selected.groupId ?? ''} onchange={(event) => { if (selected) change({ type: 'moveList', id: selected.id, groupId: event.currentTarget.value || null }); }}>
            <option value="">Ungrouped</option>{#each book.groups as group (group.id)}<option value={group.id}>{group.title}</option>{/each}
          </select>
          <button class="icon" type="button" aria-label="Move list up" disabled={siblings[0]?.id === selected.id} onclick={() => { if (selected) change({ type: 'reorderList', id: selected.id, direction: -1 }); }}>↑</button>
          <button class="icon" type="button" aria-label="Move list down" disabled={siblings.at(-1)?.id === selected.id} onclick={() => { if (selected) change({ type: 'reorderList', id: selected.id, direction: 1 }); }}>↓</button>
          <button class="btn btn-sm btn-ghost" type="button" onclick={() => { if (selected) change({ type: 'deleteList', id: selected.id }); }}>Delete list</button>
        </div>
        <div class="filters">
          <input type="search" aria-label="Search tasks" placeholder="Search this list…" bind:value={search} />
          <select aria-label="Task status" bind:value={filter}><option value="all">All tasks</option><option value="open">Open</option><option value="completed">Completed</option></select>
          <small>{tasks.filter(task => task.completed).length}/{tasks.length} completed</small>
        </div>
        <div class="tasks">
          {#each visibleTasks as task (task.id)}
            <div class="task">
              <input type="checkbox" aria-label={`Complete ${task.text}`} checked={task.completed} onchange={(event) => change({ type: 'editTask', id: task.id, completed: event.currentTarget.checked })} />
              <input class="task-text" class:completed={task.completed} aria-label="Task text" value={task.text} onchange={(event) => change({ type: 'editTask', id: task.id, text: event.currentTarget.value })} />
              <select aria-label={`List for ${task.text}`} value={task.listId} onchange={(event) => change({ type: 'moveTask', id: task.id, listId: event.currentTarget.value })}>
                {#each book.lists as list (list.id)}<option value={list.id}>{list.title}</option>{/each}
              </select>
              <button class="icon" type="button" aria-label="Move task up" disabled={tasks[0]?.id === task.id || !!search || filter !== 'all'} onclick={() => change({ type: 'reorderTask', id: task.id, direction: -1 })}>↑</button>
              <button class="icon" type="button" aria-label="Move task down" disabled={tasks.at(-1)?.id === task.id || !!search || filter !== 'all'} onclick={() => change({ type: 'reorderTask', id: task.id, direction: 1 })}>↓</button>
              <button class="icon" type="button" aria-label={`Delete task ${task.text}`} onclick={() => change({ type: 'deleteTask', id: task.id })}>×</button>
            </div>
          {:else}<p class="empty">{tasks.length ? 'No matching tasks.' : 'This list is empty. Add your first task below.'}</p>{/each}
        </div>
        <form class="add-task" onsubmit={(event) => { event.preventDefault(); if (taskText.trim() && selected) { if (change({ type: 'addTask', listId: selected.id, text: taskText })) taskText = ''; } }}>
          <input aria-label="New task" placeholder="Add a task…" bind:value={taskText} />
          <button class="btn btn-sm" type="submit" disabled={!taskText.trim()}>Add task</button>
        </form>
      {:else}<div class="empty"><h2>Your tasks, organized</h2><p>Create a list to start. Use groups to keep related lists together.</p></div>{/if}
    </main>
  </div>
{/if}

<style>
  .taskbook { display: flex; flex: 1; min-height: 0; overflow: auto; color: var(--color-text-primary); }
  aside { flex: 0 0 230px; padding: 16px; border-right: 1px solid var(--color-border-subtle); overflow: auto; }
  main { flex: 1; min-width: 280px; overflow: auto; padding: 20px; }
  .sidebar-heading, .group-heading, .list-heading, .filters, .task, .add-task { display: flex; align-items: center; gap: 6px; }
  .sidebar-heading, .group { margin-bottom: 16px; }
  .group-heading { color: var(--color-text-secondary); font-size: .85rem; margin-bottom: 6px; }
  input:not([type=checkbox]), select { min-width: 0; color: var(--color-text-primary); background: var(--color-surface-1); border: 1px solid var(--color-border-subtle); border-radius: 5px; padding: 6px 8px; font: inherit; }
  .group-title { width: 100%; font-weight: 600; }
  .list-title { flex: 1; font-size: 1.2rem !important; font-weight: 600; }
  .list-heading, .filters { flex-wrap: wrap; margin-bottom: 16px; }
  .list-link { display: flex; justify-content: space-between; gap: 8px; width: 100%; padding: 8px; border: 0; border-radius: 5px; color: inherit; background: transparent; text-align: left; cursor: pointer; }
  .list-link span { overflow-wrap: anywhere; }
  .list-link.active, .list-link:hover { background: var(--color-hover); }
  .icon { flex: 0 0 auto; border: 0; border-radius: 4px; padding: 4px 6px; background: transparent; color: inherit; cursor: pointer; }
  .icon:hover { background: var(--color-hover); }
  .icon:disabled { opacity: .35; cursor: default; }
  form { display: flex; flex-wrap: wrap; gap: 6px; margin: 16px 0; }
  form input { flex: 1; width: 100%; }
  aside form input { flex-basis: 100%; }
  .task { padding: 8px 0; border-bottom: 1px solid var(--color-border-subtle); flex-wrap: wrap; }
  .task-text { flex: 1; min-width: 130px !important; }
  .task select { max-width: 130px; }
  .completed { text-decoration: line-through; color: var(--color-text-secondary) !important; }
  .empty, small { color: var(--color-text-secondary); }
  .empty { padding: 20px 0; }
  .undo { padding: 8px; margin-bottom: 16px; border: 1px solid var(--color-border-subtle); border-radius: 5px; }
  .invalid { padding: 20px; color: var(--color-danger); }
  @media (max-width: 700px) { .taskbook { flex-direction: column; } aside { flex-basis: auto; max-height: 240px; border-right: 0; border-bottom: 1px solid var(--color-border-subtle); } main { min-width: 0; overflow: visible; } }
</style>
