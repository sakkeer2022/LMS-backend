/**
 * Server-owned registry of admin-configurable platform settings (LMS-90).
 *
 * Only keys listed here can be read or changed through the API; the database
 * stores just the current value and revision. Admins can change values, never
 * definitions, types or bounds. No secrets belong here.
 *
 * The initial keys (scoring parameters, thresholds) are a product decision
 * marked DECISION REQUIRED in docs/openapi.yaml, so the registry starts empty.
 * Add a key only once it is approved, in the PR of the feature that reads it:
 *
 *   {
 *     key: 'booking.cancellationWindowHours',
 *     type: 'integer',
 *     description: 'Hours before a session when students can still cancel',
 *     defaultValue: 24,
 *     minimum: 0,
 *     maximum: 168,
 *   }
 *
 * Session prices are price records (LMS-58), not settings.
 */

export type SettingType = 'integer' | 'number' | 'boolean' | 'string';
export type SettingValue = number | boolean | string;

export interface SettingDefinition {
  /** Matches ^[a-z][a-zA-Z0-9.]*$, for example `booking.cancellationWindowHours`. */
  key: string;
  type: SettingType;
  description: string;
  defaultValue: SettingValue;
  /** Inclusive bounds for `integer` and `number` settings. */
  minimum?: number;
  maximum?: number;
  /** When set, the value must be one of these. */
  allowedValues?: readonly SettingValue[];
}

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [];
