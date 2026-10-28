import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  paginationQuerySchema,
  toPrismaPagination,
  queryBoolean,
  uuidParams,
  createEnumCodec,
  lowercaseEnumMapping,
} from '@shared/validation/index';

describe('Shared validation conventions', () => {
  describe('paginationQuerySchema', () => {
    it('applies contract defaults (page 1, limit 20)', () => {
      expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    });

    it('coerces query strings', () => {
      expect(paginationQuerySchema.parse({ page: '3', limit: '50' })).toEqual({ page: 3, limit: 50 });
    });

    it.each([
      { page: '0' },
      { limit: '0' },
      { limit: '101' },
      { page: '1.5' },
      { page: 'abc' },
    ])('rejects %o', (query) => {
      expect(paginationQuerySchema.safeParse(query).success).toBe(false);
    });

    it('converts to Prisma skip/take', () => {
      expect(toPrismaPagination({ page: 3, limit: 20 })).toEqual({ skip: 40, take: 20 });
    });
  });

  describe('queryBoolean', () => {
    it('parses "true" and "false" strictly', () => {
      expect(queryBoolean.parse('true')).toBe(true);
      expect(queryBoolean.parse('false')).toBe(false);
    });

    it.each(['1', '0', 'yes', '', 'TRUE'])('rejects %j', (value) => {
      expect(queryBoolean.safeParse(value).success).toBe(false);
    });
  });

  describe('uuidParams', () => {
    const schema = uuidParams('facultyId');

    it('accepts a UUID', () => {
      const id = '8c121988-8afa-4fb7-b6eb-9b0dcb94f730';
      expect(schema.parse({ facultyId: id })).toEqual({ facultyId: id });
    });

    it('rejects a non-UUID', () => {
      expect(schema.safeParse({ facultyId: '123' }).success).toBe(false);
    });
  });

  describe('createEnumCodec', () => {
    const audience = createEnumCodec({ STUDENT: 'students', FACULTY: 'faculty', ALL: 'all' });

    it('maps API values to database values on input', () => {
      expect(audience.schema.parse('students')).toBe('STUDENT');
    });

    it('maps database values to API values on output', () => {
      expect(audience.toApi('STUDENT')).toBe('students');
    });

    it('rejects unknown API values and database casing', () => {
      expect(audience.schema.safeParse('STUDENT').success).toBe(false);
      expect(audience.schema.safeParse('teachers').success).toBe(false);
    });

    it('rejects mappings that are not one-to-one', () => {
      expect(() => createEnumCodec({ PENDING: 'pending', QUEUED: 'pending' })).toThrow(/more than one/);
    });

    it('builds lowercase mappings for simple enums', () => {
      const status = createEnumCodec(lowercaseEnumMapping(['PENDING', 'APPROVED'] as const));
      expect(status.schema.parse('approved')).toBe('APPROVED');
      expect(status.toApi('PENDING')).toBe('pending');
    });

    it('works inside an object schema', () => {
      const query = z.object({ audience: audience.schema.optional() });
      expect(query.parse({ audience: 'all' })).toEqual({ audience: 'ALL' });
    });
  });
});
