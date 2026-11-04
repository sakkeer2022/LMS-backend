import { Prisma } from '@prisma/client';
import { AppError, OperationalError } from '@core/errors/index';

/**
 * Typed errors for the category tree. Every error carries a stable `code` (returned in
 * the response envelope) and a message written for the admin or learner who sees it.
 * Raw database errors never reach the client: toTreeError maps the trigger and
 * constraint errors to the same codes.
 */
export type TreeErrorCode =
  | 'CATEGORY_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'DUPLICATE_CODE'
  | 'STALE_VERSION'
  | 'STALE_SIBLINGS'
  | 'PARENT_IS_BOOKABLE'
  | 'CYCLE'
  | 'PATH_TOO_LONG'
  | 'TOO_DEEP'
  | 'HAS_CHILDREN'
  | 'CATEGORY_REFERENCED'
  | 'LEVELS_REQUIRED'
  | 'LEVEL_IN_USE'
  | 'LEVEL_REQUIRED_BY_CURRICULA'
  | 'BOARD_REQUIRED_BY_CURRICULA'
  | 'DELETE_BLOCKED'
  | 'UNKNOWN_LEVEL'
  | 'INACTIVE_LEVEL'
  | 'UNKNOWN_BOARD'
  | 'UNKNOWN_SUBJECT'
  | 'NOT_BOOKABLE'
  | 'BOARD_REQUIRED'
  | 'LEVEL_REQUIRED'
  | 'LEVEL_NOT_ALLOWED'
  | 'NO_OFFERING'
  | 'CONCURRENT_CHANGE'
  | 'FEATURE_DISABLED';

const STATUS: Record<TreeErrorCode, 404 | 409 | 422> = {
  CATEGORY_NOT_FOUND: 404,
  PARENT_NOT_FOUND: 422,
  DUPLICATE_CODE: 409,
  STALE_VERSION: 409,
  STALE_SIBLINGS: 409,
  PARENT_IS_BOOKABLE: 409,
  CYCLE: 422,
  PATH_TOO_LONG: 422,
  TOO_DEEP: 422,
  HAS_CHILDREN: 409,
  CATEGORY_REFERENCED: 409,
  LEVELS_REQUIRED: 422,
  LEVEL_IN_USE: 409,
  LEVEL_REQUIRED_BY_CURRICULA: 409,
  BOARD_REQUIRED_BY_CURRICULA: 409,
  DELETE_BLOCKED: 409,
  UNKNOWN_LEVEL: 422,
  INACTIVE_LEVEL: 422,
  UNKNOWN_BOARD: 422,
  UNKNOWN_SUBJECT: 422,
  NOT_BOOKABLE: 422,
  BOARD_REQUIRED: 422,
  LEVEL_REQUIRED: 422,
  LEVEL_NOT_ALLOWED: 422,
  NO_OFFERING: 404,
  CONCURRENT_CHANGE: 409,
  FEATURE_DISABLED: 404,
};

const DEFAULT_MESSAGE: Record<TreeErrorCode, string> = {
  CATEGORY_NOT_FOUND: 'Category not found',
  PARENT_NOT_FOUND: 'The parent category no longer exists. Reload the tree.',
  DUPLICATE_CODE: 'Another category at this level already uses this code',
  STALE_VERSION:
    'Someone else changed this category. Reload to see the latest version, then try again.',
  STALE_SIBLINGS: 'The sub-categories changed while you were reordering. Reload and try again.',
  PARENT_IS_BOOKABLE:
    'A bookable category cannot have sub-categories. Turn off booking on it first.',
  CYCLE: 'A category cannot move inside itself or one of its own sub-categories',
  PATH_TOO_LONG: 'The category path would be longer than 500 characters. Use shorter codes.',
  TOO_DEEP: 'The tree would be deeper than 20 levels',
  HAS_CHILDREN: 'Only a category without sub-categories can be bookable or have levels',
  CATEGORY_REFERENCED: 'Curricula or students still use this category. Deactivate it instead.',
  LEVELS_REQUIRED: 'Choose at least one level, or turn off "Requires level"',
  LEVEL_IN_USE: 'A level you removed is used by curricula of this category',
  LEVEL_REQUIRED_BY_CURRICULA:
    'Some curricula of this category have no level, so "Requires level" cannot be on',
  BOARD_REQUIRED_BY_CURRICULA:
    'Some curricula or students of this category have no board, so "Requires board" cannot be on',
  DELETE_BLOCKED: 'This category cannot be deleted. Deactivate it instead.',
  UNKNOWN_LEVEL: 'Unknown level',
  INACTIVE_LEVEL: 'The level is not active',
  UNKNOWN_BOARD: 'Unknown or inactive board',
  UNKNOWN_SUBJECT: 'Unknown or inactive subject',
  NOT_BOOKABLE: 'This category is not bookable',
  BOARD_REQUIRED: 'Choose a board',
  LEVEL_REQUIRED: 'Choose a level',
  LEVEL_NOT_ALLOWED: 'That level is not offered in this category',
  NO_OFFERING: 'Nothing is offered for that combination',
  CONCURRENT_CHANGE: 'The tree changed while saving. Reload and try again.',
  FEATURE_DISABLED: 'Not found',
};

export function treeError(
  code: TreeErrorCode,
  message: string = DEFAULT_MESSAGE[code],
  context: Record<string, unknown> = {}
): AppError {
  return new OperationalError(message, STATUS[code], {
    code,
    context,
    severity: 'info',
    retryable: code === 'CONCURRENT_CHANGE',
  });
}

const TRIGGER_CODES: Record<string, TreeErrorCode> = {
  PATH_MISMATCH: 'CONCURRENT_CHANGE',
  PARENT_IS_BOOKABLE: 'PARENT_IS_BOOKABLE',
  BOOKABLE_HAS_CHILDREN: 'HAS_CHILDREN',
  CATEGORY_NOT_BOOKABLE: 'NOT_BOOKABLE',
  CATEGORY_REFERENCED: 'CATEGORY_REFERENCED',
  BOARD_REQUIRED: 'BOARD_REQUIRED',
  LEVEL_REQUIRED: 'LEVEL_REQUIRED',
};

function messageChain(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let i = 0; current && i < 5; i += 1) {
    if (current instanceof Error) parts.push(current.message);
    if (current && typeof current === 'object' && 'meta' in current)
      parts.push(JSON.stringify(current.meta));
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join(' | ');
}

/**
 * Maps a database error from a tree write to a typed error. Unknown errors are
 * rethrown unchanged; the global handler logs them and returns a generic 500.
 */
export function toTreeError(err: unknown): unknown {
  if (err instanceof AppError) return err;
  const text = messageChain(err);

  const trigger = /category_tree:([A-Z_]+)/.exec(text);
  if (trigger) {
    const code = TRIGGER_CODES[trigger[1]];
    if (code) return treeError(code, DEFAULT_MESSAGE[code], { rootCause: trigger[1] });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return treeError('DUPLICATE_CODE');
    if (err.code === 'P2034') return treeError('CONCURRENT_CHANGE');
    if (err.code === 'P2003') return treeError('DELETE_BLOCKED');
  }
  // Unique violation, deadlock or serialization failure surfaced as a raw driver error
  if (/23505|unique constraint/i.test(text)) return treeError('DUPLICATE_CODE');
  if (/40P01|40001|deadlock|could not serialize/i.test(text)) return treeError('CONCURRENT_CHANGE');
  return err;
}
