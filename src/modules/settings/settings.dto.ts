import { z } from 'zod';
import { paginationQuerySchema } from '@shared/validation/index';

const MAX_INT32 = 2147483647;

export const SETTING_KEY_PATTERN = /^[a-z][a-zA-Z0-9.]*$/;

export const settingKeySchema = z.string().min(1).max(100).regex(SETTING_KEY_PATTERN);

export const SettingKeyParamsDto = z.object({ key: settingKeySchema });

export const ListSettingsQueryDto = paginationQuerySchema;

export const SettingValueDto = z.union([z.number(), z.boolean(), z.string().min(1).max(10000)]);

export const UpdateSettingDto = z.strictObject({
  value: SettingValueDto,
  expectedRevision: z.number().int().min(1).max(MAX_INT32),
  reason: z.string().trim().min(1).max(1000),
});

export type ListSettingsQuery = z.infer<typeof ListSettingsQueryDto>;
export type UpdateSettingInput = z.infer<typeof UpdateSettingDto>;
