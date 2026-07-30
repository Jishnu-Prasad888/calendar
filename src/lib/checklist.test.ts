import { describe, expect, it } from 'vitest';
import type { KeepNoteItem } from '../domain';
import {
  deleteChecklistSubtree,
  indentCheckedSubtrees,
  indentChecklistSubtree,
  insertChecklistItemAfterSubtree,
} from './checklist';

const items: KeepNoteItem[] = [
  { id: 'a', text: 'Parent', checked: true, indent: 0 },
  { id: 'b', text: 'Child', checked: true, indent: 1 },
  { id: 'c', text: 'Grandchild', checked: false, indent: 2 },
  { id: 'd', text: 'Sibling', checked: false, indent: 0 },
];

describe('checklist hierarchy', () => {
  it('moves a parent and all descendants together', () => {
    expect(
      indentChecklistSubtree(items, 'b', -1).map((item) => item.indent),
    ).toEqual([0, 0, 1, 0]);
    expect(indentChecklistSubtree(items, 'd', 1)[3].indent).toBe(1);
  });

  it('deletes a parent with all descendants', () => {
    expect(deleteChecklistSubtree(items, 'a').map((item) => item.id)).toEqual([
      'd',
    ]);
  });

  it('inserts after descendants while keeping the requested depth', () => {
    const inserted = insertChecklistItemAfterSubtree(items, 'a', {
      id: 'new',
      text: '',
      checked: false,
      indent: 0,
    });
    expect(inserted.map((item) => item.id)).toEqual([
      'a',
      'b',
      'c',
      'new',
      'd',
    ]);
    expect(inserted[3].indent).toBe(0);
  });

  it('does not apply a batch move twice to checked descendants', () => {
    expect(indentCheckedSubtrees(items, -1).map((item) => item.indent)).toEqual(
      [0, 1, 2, 0],
    );
  });
});
