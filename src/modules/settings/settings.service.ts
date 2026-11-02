import type { Prisma } from '@prisma/client';
import { prisma } from '@infrastructure/database/index';
import { ConflictError, NotFoundError, ValidationError } from '@core/errors/index';
import { logger } from '@core/logger/index';
import { buildPaginationMeta, type PaginatedResult } from '@shared/types/pagination';
import { logAction, type AuditContext } from '@modules/audit/audit.service.js';
import {
  SETTING_DEFINITIONS,
  type SettingDefinition,
  type SettingValue,
} from './settings.registry.js';
import {
  SETTING_KEY_PATTERN,
  type ListSettingsQuery,
  type UpdateSettingInput,
} from './settings.dto.js';

/** A setting as returned by the API: its definition plus the current value. */
export interface SettingView {
  key: string;
  type: SettingDefinition['type'];
  value: SettingValue;
  description: string;
  minimum?: number;
  maximum?: number;
  allowedValues?: SettingValue[];
  revision: number;
  updatedAt: Date;
}

interface StoredSetting {
  key: string;
  value: Prisma.JsonValue;
  revision: number;
  updatedAt: Date;
}

// ── Validation ───────────────────────────────────────────────────

/** Why `value` is not acceptable for `def`, or null when it is. */
export function valueIssue(def: SettingDefinition, value: unknown): string | null {
  switch (def.type) {
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'must be an integer';
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number';
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return 'must be true or false';
      break;
    case 'string':
      if (typeof value !== 'string' || value.length === 0) return 'must be a non-empty string';
      break;
  }
  if (typeof value === 'number') {
    if (def.minimum !== undefined && value < def.minimum) return `must be at least ${def.minimum}`;
    if (def.maximum !== undefined && value > def.maximum) return `must be at most ${def.maximum}`;
  }
  if (def.allowedValues && !def.allowedValues.includes(value as SettingValue)) {
    return `must be one of: ${def.allowedValues.join(', ')}`;
  }
  return null;
}

/** Problems with the registry itself; checked by tests whenever a key is added. */
export function definitionIssues(defs: readonly SettingDefinition[]): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const def of defs) {
    if (!SETTING_KEY_PATTERN.test(def.key) || def.key.length > 100) {
      issues.push(`${def.key}: invalid key`);
    }
    if (seen.has(def.key)) issues.push(`${def.key}: duplicate key`);
    seen.add(def.key);
    if (def.minimum !== undefined && def.maximum !== undefined && def.minimum > def.maximum) {
      issues.push(`${def.key}: minimum is greater than maximum`);
    }
    const defaultIssue = valueIssue(def, def.defaultValue);
    if (defaultIssue) issues.push(`${def.key}: default ${defaultIssue}`);
  }
  return issues;
}

// ── Helpers ──────────────────────────────────────────────────────

function definitionFor(key: string): SettingDefinition {
  const def = SETTING_DEFINITIONS.find((d) => d.key === key);
  if (!def) throw new NotFoundError('Setting');
  return def;
}

/** Stored value when it is still valid for the definition, otherwise the default. */
function effectiveValue(def: SettingDefinition, stored: Prisma.JsonValue): SettingValue {
  if (valueIssue(def, stored) === null) return stored as SettingValue;
  logger.warn(
    { key: def.key },
    'Stored setting value no longer matches its definition; using default'
  );
  return def.defaultValue;
}

function toView(def: SettingDefinition, row: StoredSetting): SettingView {
  return {
    key: def.key,
    type: def.type,
    value: effectiveValue(def, row.value),
    description: def.description,
    ...(def.minimum !== undefined && { minimum: def.minimum }),
    ...(def.maximum !== undefined && { maximum: def.maximum }),
    ...(def.allowedValues && { allowedValues: [...def.allowedValues] }),
    revision: row.revision,
    updatedAt: row.updatedAt,
  };
}

/** Creates rows holding the default value for registered keys that have none yet. */
async function ensureStored(defs: readonly SettingDefinition[]): Promise<void> {
  if (defs.length === 0) return;
  await prisma.systemSetting.createMany({
    data: defs.map((def) => ({
      key: def.key,
      value: def.defaultValue,
      description: def.description,
    })),
    skipDuplicates: true,
  });
}

async function loadRows(defs: readonly SettingDefinition[]): Promise<Map<string, StoredSetting>> {
  await ensureStored(defs);
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: defs.map((d) => d.key) } },
    select: { key: true, value: true, revision: true, updatedAt: true },
  });
  return new Map(rows.map((row) => [row.key, row]));
}

// ── Queries ──────────────────────────────────────────────────────

export async function listSettings(
  query: ListSettingsQuery
): Promise<PaginatedResult<SettingView>> {
  const defs = [...SETTING_DEFINITIONS].sort((a, b) => a.key.localeCompare(b.key));
  const page = defs.slice((query.page - 1) * query.limit, query.page * query.limit);
  const rows = await loadRows(page);
  return {
    items: page.map((def) => toView(def, rows.get(def.key) as StoredSetting)),
    meta: buildPaginationMeta(defs.length, query.page, query.limit),
  };
}

export async function getSettingDetail(key: string): Promise<SettingView> {
  const def = definitionFor(key);
  const rows = await loadRows([def]);
  return toView(def, rows.get(key) as StoredSetting);
}

/**
 * Current value of a registered setting, for use by other modules. Reads the
 * database every time, so changes apply without a restart.
 */
export async function getSetting<T extends SettingValue>(key: string): Promise<T> {
  return (await getSettingDetail(key)).value as T;
}

// ── Update ───────────────────────────────────────────────────────

export async function updateSetting(
  key: string,
  dto: UpdateSettingInput,
  audit: AuditContext
): Promise<SettingView> {
  const def = definitionFor(key);
  const issue = valueIssue(def, dto.value);
  if (issue) throw new ValidationError(`Setting ${key} ${issue}`);

  await ensureStored([def]);

  const { previous, updated } = await prisma.$transaction(async (tx) => {
    const current = await tx.systemSetting.findUniqueOrThrow({ where: { key } });
    // Conditional update: only the caller who saw the latest revision can change it
    const { count } = await tx.systemSetting.updateMany({
      where: { key, revision: dto.expectedRevision },
      data: {
        value: dto.value,
        revision: { increment: 1 },
        updatedBy: audit.actorId ?? null,
      },
    });
    if (count !== 1) {
      throw new ConflictError(
        `Setting ${key} was changed by someone else (current revision ${current.revision}); reload and retry`
      );
    }
    return {
      previous: current,
      updated: await tx.systemSetting.findUniqueOrThrow({ where: { key } }),
    };
  });

  try {
    await logAction({
      ...audit,
      severity: 'SECURITY',
      entity: 'system_setting',
      action: 'setting.updated',
      resourceId: key,
      previousValue: { value: previous.value, revision: previous.revision },
      newValue: { value: updated.value, revision: updated.revision, reason: dto.reason },
    });
  } catch (err) {
    logger.error({ err, key }, 'Failed to write setting change audit log');
  }

  return toView(def, updated);
}
