import type { KeepNoteItem } from '../domain';

const MAX_INDENT = 8;

function subtreeEnd(items: readonly KeepNoteItem[], index: number): number {
  const indent = items[index].indent;
  let end = index + 1;
  while (end < items.length && items[end].indent > indent) end += 1;
  return end;
}

export function deleteChecklistSubtree(
  items: readonly KeepNoteItem[],
  itemId: string,
): KeepNoteItem[] {
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) return [...items];
  const end = subtreeEnd(items, index);
  return [...items.slice(0, index), ...items.slice(end)];
}

export function insertChecklistItemAfterSubtree(
  items: readonly KeepNoteItem[],
  itemId: string,
  newItem: KeepNoteItem,
): KeepNoteItem[] {
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) return [...items, newItem];
  const insertAt = subtreeEnd(items, index);
  return [...items.slice(0, insertAt), newItem, ...items.slice(insertAt)];
}

export function indentChecklistSubtree(
  items: readonly KeepNoteItem[],
  itemId: string,
  direction: -1 | 1,
): KeepNoteItem[] {
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) return [...items];
  const item = items[index];
  if (direction < 0 && item.indent === 0) return [...items];
  if (direction > 0) {
    if (index === 0) return [...items];
    const allowedIndent = Math.min(MAX_INDENT, items[index - 1].indent + 1);
    if (item.indent >= allowedIndent) return [...items];
  }
  const end = subtreeEnd(items, index);
  return items.map((current, currentIndex) =>
    currentIndex >= index && currentIndex < end
      ? { ...current, indent: current.indent + direction }
      : { ...current },
  );
}

function hasCheckedAncestor(
  items: readonly KeepNoteItem[],
  index: number,
): boolean {
  let expectedIndent = items[index].indent - 1;
  for (
    let current = index - 1;
    current >= 0 && expectedIndent >= 0;
    current -= 1
  ) {
    if (items[current].indent === expectedIndent) {
      if (items[current].checked) return true;
      expectedIndent -= 1;
    }
  }
  return false;
}

export function indentCheckedSubtrees(
  items: readonly KeepNoteItem[],
  direction: -1 | 1,
): KeepNoteItem[] {
  const roots = items
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item, index }) => item.checked && !hasCheckedAncestor(items, index),
    )
    .map(({ item }) => item.id);
  return roots.reduce(
    (current, itemId) => indentChecklistSubtree(current, itemId, direction),
    [...items],
  );
}
