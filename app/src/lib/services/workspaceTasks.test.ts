import { describe, expect, it } from 'vitest';
import { changeTaskBook, emptyTaskBook, parseTaskBook, serializeTaskBook, taskBookMarkdown, type TaskBook } from './workspaceTasks';
function sample(): TaskBook {
  return { version: 1, groups: [{ id: 'g', title: 'Release' }], lists: [{ id: 'a', title: 'Checks', groupId: 'g' }, { id: 'b', title: 'Ideas', groupId: null }], tasks: [
    { id: 'one', listId: 'a', text: 'First', completed: false }, { id: 'other', listId: 'b', text: 'Other list', completed: false }, { id: 'two', listId: 'a', text: 'Second', completed: true },
  ] };
}
describe('structured task books', () => {
  it('round trips empty and populated books', () => {
    for (const book of [emptyTaskBook(), sample()]) expect(parseTaskBook(serializeTaskBook(book))).toEqual(book);
  });
  it('creates groups, lists and tasks with stable IDs through editing and moves', () => {
    let book = changeTaskBook(emptyTaskBook(), { type: 'addGroup', title: ' Work ' });
    book = changeTaskBook(book, { type: 'addList', groupId: book.groups[0].id, title: 'Plan' });
    book = changeTaskBook(book, { type: 'addTask', listId: book.lists[0].id, text: 'Start' });
    const id = book.tasks[0].id;
    book = changeTaskBook(book, { type: 'editTask', id, text: 'Finish', completed: true });
    book = changeTaskBook(book, { type: 'moveList', id: book.lists[0].id, groupId: null });
    expect(book.groups[0].title).toBe('Work');
    expect(book.tasks[0]).toEqual({ id, listId: book.lists[0].id, text: 'Finish', completed: true });
    expect(new Set([book.groups[0].id, book.lists[0].id, id]).size).toBe(3);
  });
  it('reorders within a list without touching another list, and retains identities on transfer', () => {
    const original = sample();
    let book = changeTaskBook(original, { type: 'reorderTask', id: 'one', direction: 1 });
    expect(book.tasks.map(task => task.id)).toEqual(['two', 'other', 'one']);
    expect(original.tasks[0].id).toBe('one');
    book = changeTaskBook(book, { type: 'moveTask', id: 'one', listId: 'b' });
    expect(book.tasks.find(task => task.id === 'one')?.listId).toBe('b');
    expect(changeTaskBook(book, { type: 'reorderTask', id: 'two', direction: -1 })).toEqual(book);
  });
  it('removes groups without losing lists, and cascades list deletion only to its tasks', () => {
    const ungrouped = changeTaskBook(sample(), { type: 'deleteGroup', id: 'g' });
    expect(ungrouped.groups).toEqual([]); expect(ungrouped.lists[0].groupId).toBeNull(); expect(ungrouped.tasks).toHaveLength(3);
    const deleted = changeTaskBook(ungrouped, { type: 'deleteList', id: 'a' });
    expect(deleted.tasks.map(task => task.id)).toEqual(['other']); expect(deleted.lists[0].id).toBe('b');
  });
  it('rejects malformed JSON, unsupported versions, duplicate IDs and dangling references', () => {
    const invalid: unknown[] = ['not JSON', null, {}, { ...sample(), version: 2 }];
    const duplicate = sample(); duplicate.tasks[0].id = 'g'; invalid.push(duplicate);
    const badGroup = sample(); badGroup.lists[0].groupId = 'missing'; invalid.push(badGroup);
    const badList = sample(); badList.tasks[0].listId = 'missing'; invalid.push(badList);
    const blank = sample(); blank.tasks[0].text = '  '; invalid.push(blank);
    for (const value of invalid) expect(() => parseTaskBook(typeof value === 'string' ? value : JSON.stringify(value))).toThrow();
    expect(() => changeTaskBook(sample(), { type: 'moveTask', id: 'one', listId: 'missing' })).toThrow();
    expect(() => changeTaskBook(sample(), { type: 'editTask', id: 'missing', text: 'Lost' })).toThrow();
  });
  it('exports group/list headings and task completion as Markdown', () => {
    const markdown = taskBookMarkdown(sample());
    expect(markdown).toContain('## Release\n\n### Checks');
    expect(markdown).toContain('- [ ] First'); expect(markdown).toContain('- [x] Second');
    expect(markdown).toContain('## Ungrouped\n\n### Ideas');
  });
});
