import { describe, it, expect } from 'vitest';
import {
  CODE_PATTERN,
  ancestorPaths,
  checkLeafSettings,
  checkMoveLimits,
  checkSelection,
  childDepth,
  childPath,
  countLabel,
  descendantsLikePattern,
  insertAt,
  isSelfOrDescendantPath,
  rebasePath,
  subtreeCurriculaCounts,
  wouldCreateCycle,
  type LeafState,
} from '@modules/category-tree/category-tree.rules';
import { toTreeError } from '@modules/category-tree/category-tree.errors';

describe('category tree rules (ADR-0005)', () => {
  describe('path and depth (invariant 1)', () => {
    it('makes a root path its code and a child path parent/code', () => {
      expect(childPath(null, 'academic')).toBe('academic');
      expect(childPath('academic/school', 'k-12')).toBe('academic/school/k-12');
      expect(childDepth(null)).toBe(0);
      expect(childDepth(2)).toBe(3);
    });

    it('lists ancestor paths for the breadcrumb', () => {
      expect(ancestorPaths('academic')).toEqual([]);
      expect(ancestorPaths('academic/school/k-12')).toEqual(['academic', 'academic/school']);
    });

    it('rebases every path of a moved subtree', () => {
      expect(rebasePath('academic/school', 'academic/school', 'non-academic/school')).toBe(
        'non-academic/school'
      );
      expect(rebasePath('academic/school/k-12/x', 'academic/school', 'school')).toBe(
        'school/k-12/x'
      );
      expect(() => rebasePath('academic/schools', 'academic/school', 'x')).toThrow();
    });

    it('inserts a node at a clamped position among its siblings', () => {
      expect(insertAt(['a', 'b', 'c'], 'x', 1)).toEqual(['a', 'x', 'b', 'c']);
      expect(insertAt(['a', 'x', 'b'], 'x', 0)).toEqual(['x', 'a', 'b']);
      expect(insertAt(['a', 'b'], 'x', 99)).toEqual(['a', 'b', 'x']);
    });

    it('escapes LIKE wildcards in codes, so "a_b" never matches "axb"', () => {
      expect(descendantsLikePattern('a_b')).toBe('a\\_b/%');
      expect(descendantsLikePattern('a%b')).toBe('a\\%b/%');
    });

    it('checks path length and depth after a move', () => {
      const subtree = [
        { path: 'a', depth: 0 },
        { path: 'a/b', depth: 1 },
      ];
      expect(checkMoveLimits(subtree, 'a', 'x/a', 1)).toBeNull();
      expect(checkMoveLimits(subtree, 'a', `${'x'.repeat(499)}/a`, 1)).toBe('PATH_TOO_LONG');
      expect(checkMoveLimits(subtree, 'a', 'x/a', 20)).toBe('TOO_DEEP');
    });

    it('accepts only lowercase codes that start with a letter', () => {
      expect(CODE_PATTERN.test('k-12')).toBe(true);
      expect(CODE_PATTERN.test('btech_cse')).toBe(true);
      for (const bad of ['K-12', '12th', 'a b', 'a/b', ''])
        expect(CODE_PATTERN.test(bad)).toBe(false);
    });
  });

  describe('cycles (invariant 2)', () => {
    it('blocks moving a node under itself or a descendant', () => {
      expect(wouldCreateCycle('academic/school', 'academic/school')).toBe(true);
      expect(wouldCreateCycle('academic/school', 'academic/school/k-12')).toBe(true);
      expect(wouldCreateCycle('academic/school', 'academic')).toBe(false);
      expect(wouldCreateCycle('academic/school', null)).toBe(false);
    });

    it('does not treat a sibling with a longer code as a descendant', () => {
      expect(isSelfOrDescendantPath('academic/school', 'academic/schools/x')).toBe(false);
      expect(wouldCreateCycle('academic/school', 'academic/schools')).toBe(false);
    });
  });

  describe('leaf settings (invariants 3, 4 and 5)', () => {
    const empty: LeafState = {
      childCount: 0,
      referenceCount: 0,
      levelsInUse: new Set(),
      curriculaWithoutLevel: 0,
      referencesWithoutBoard: 0,
    };
    const input = { isBookable: true, requiresBoard: false, requiresLevel: true, levelIds: ['l1'] };

    it('accepts valid settings', () => {
      expect(checkLeafSettings(input, empty)).toBeNull();
      expect(checkLeafSettings({ ...input, requiresLevel: false, levelIds: [] }, empty)).toBeNull();
    });

    it('refuses settings on a node with children', () => {
      expect(checkLeafSettings(input, { ...empty, childCount: 2 })).toBe('HAS_CHILDREN');
    });

    it('refuses to make a referenced node non-bookable', () => {
      expect(
        checkLeafSettings({ ...input, isBookable: false }, { ...empty, referenceCount: 1 })
      ).toBe('CATEGORY_REFERENCED');
    });

    it('requires a level list when levels are required', () => {
      expect(checkLeafSettings({ ...input, levelIds: [] }, empty)).toBe('LEVELS_REQUIRED');
    });

    it('keeps levels that curricula use, and refuses flags existing rows break', () => {
      expect(
        checkLeafSettings(
          { ...input, levelIds: ['l2'] },
          { ...empty, levelsInUse: new Set(['l1']) }
        )
      ).toBe('LEVEL_IN_USE');
      expect(checkLeafSettings(input, { ...empty, curriculaWithoutLevel: 1 })).toBe(
        'LEVEL_REQUIRED_BY_CURRICULA'
      );
      expect(
        checkLeafSettings(
          { ...input, requiresBoard: true },
          { ...empty, referencesWithoutBoard: 1 }
        )
      ).toBe('BOARD_REQUIRED_BY_CURRICULA');
    });
  });

  describe('selection on a leaf (invariants 3 and 5)', () => {
    const leaf = {
      isBookable: true,
      requiresBoard: true,
      requiresLevel: true,
      allowedLevelIds: new Set(['l1']),
    };

    it('requires a bookable leaf, a board and an allowed level', () => {
      expect(checkSelection(leaf, { boardId: 'b', levelId: 'l1' })).toBeNull();
      expect(checkSelection({ ...leaf, isBookable: false }, { boardId: 'b', levelId: 'l1' })).toBe(
        'NOT_BOOKABLE'
      );
      expect(checkSelection(leaf, { levelId: 'l1' })).toBe('BOARD_REQUIRED');
      expect(checkSelection(leaf, { boardId: 'b' })).toBe('LEVEL_REQUIRED');
      expect(checkSelection(leaf, { boardId: 'b', levelId: 'l2' })).toBe('LEVEL_NOT_ALLOWED');
    });

    it('needs neither board nor level on a leaf that requires neither', () => {
      expect(
        checkSelection({ ...leaf, requiresBoard: false, requiresLevel: false }, {})
      ).toBeNull();
    });
  });

  describe('counts and labels', () => {
    it('sums curricula over each subtree', () => {
      const n = (id: string, parentId: string | null, curriculaCount: number) => ({
        id,
        parentId,
        name: id,
        displayOrder: 0,
        childrenCount: 0,
        curriculaCount,
      });
      const totals = subtreeCurriculaCounts([
        n('a', null, 0),
        n('b', 'a', 0),
        n('c', 'b', 3),
        n('d', 'b', 2),
        n('e', 'a', 1),
      ]);
      expect(Object.fromEntries(totals)).toEqual({ a: 6, b: 5, c: 3, d: 2, e: 1 });
    });

    it('never shows a bare number', () => {
      expect(countLabel(1, 'sub-category', 'sub-categories')).toBe('1 sub-category');
      expect(countLabel(12, 'curriculum', 'curricula')).toBe('12 curricula');
      expect(countLabel(1284, 'resource', 'resources')).toBe('1,284 resources');
    });
  });

  describe('database error mapping', () => {
    it('maps trigger errors to typed codes and leaves unknown errors alone', () => {
      const mapped = toTreeError(
        new Error('Raw query failed. Code: `23514`. Message: `category_tree:PARENT_IS_BOOKABLE`')
      );
      expect(mapped).toMatchObject({ code: 'PARENT_IS_BOOKABLE', statusCode: 409 });
      expect(toTreeError(new Error('deadlock detected'))).toMatchObject({
        code: 'CONCURRENT_CHANGE',
        retryable: true,
      });
      const other = new Error('boom');
      expect(toTreeError(other)).toBe(other);
    });
  });
});
