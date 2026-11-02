import { describe, it, expect } from 'vitest';
import { definitionIssues, valueIssue } from '../../src/modules/settings/settings.service.js';
import {
  SETTING_DEFINITIONS,
  type SettingDefinition,
} from '../../src/modules/settings/settings.registry.js';

const integerDef: SettingDefinition = {
  key: 'booking.maxPerDay',
  type: 'integer',
  description: 'Maximum bookings per day',
  defaultValue: 3,
  minimum: 1,
  maximum: 10,
};

const numberDef: SettingDefinition = {
  key: 'scoring.weight',
  type: 'number',
  description: 'Weight',
  defaultValue: 0.5,
  minimum: 0,
  maximum: 1,
};

const enumDef: SettingDefinition = {
  key: 'review.mode',
  type: 'string',
  description: 'Review mode',
  defaultValue: 'strict',
  allowedValues: ['strict', 'relaxed'],
};

const booleanDef: SettingDefinition = {
  key: 'library.publicBrowsing',
  type: 'boolean',
  description: 'Allow browsing without an account',
  defaultValue: false,
};

describe('valueIssue', () => {
  it.each([
    [integerDef, 5, null],
    [integerDef, 1, null],
    [integerDef, 10, null],
    [integerDef, 0, 'must be at least 1'],
    [integerDef, 11, 'must be at most 10'],
    [integerDef, 2.5, 'must be an integer'],
    [integerDef, '5', 'must be an integer'],
    [numberDef, 0.25, null],
    [numberDef, 1.5, 'must be at most 1'],
    [numberDef, true, 'must be a number'],
    [booleanDef, true, null],
    [booleanDef, 'true', 'must be true or false'],
    [enumDef, 'relaxed', null],
    [enumDef, 'loose', 'must be one of: strict, relaxed'],
    [enumDef, '', 'must be a non-empty string'],
  ] as const)('%#: %o', (def, value, expected) => {
    expect(valueIssue(def, value)).toBe(expected);
  });
});

describe('definitionIssues', () => {
  it('accepts valid definitions', () => {
    expect(definitionIssues([integerDef, numberDef, enumDef, booleanDef])).toEqual([]);
  });

  it('reports bad keys, duplicates, inverted bounds and invalid defaults', () => {
    const issues = definitionIssues([
      { ...integerDef, key: 'Bad-Key' },
      integerDef,
      integerDef,
      { ...numberDef, minimum: 2, maximum: 1 },
      { ...enumDef, defaultValue: 'other' },
    ]);
    expect(issues).toEqual([
      'Bad-Key: invalid key',
      'booking.maxPerDay: duplicate key',
      'scoring.weight: minimum is greater than maximum',
      'scoring.weight: default must be at least 2',
      'review.mode: default must be one of: strict, relaxed',
    ]);
  });

  it('finds no problems in the real registry', () => {
    expect(definitionIssues(SETTING_DEFINITIONS)).toEqual([]);
  });
});
