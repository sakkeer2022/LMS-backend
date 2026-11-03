import { z } from 'zod';

/**
 * Shared request conventions, matching docs/openapi.yaml:
 * - page: integer >= 1, default 1
 * - limit: integer 1..100, default 20
 */
export const MAX_PAGE_LIMIT = 100;
const MAX_INT32 = 2147483647;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(MAX_INT32).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Converts validated pagination into Prisma `skip`/`take` arguments. */
export function toPrismaPagination({ page, limit }: PaginationQuery): {
  skip: number;
  take: number;
} {
  return { skip: (page - 1) * limit, take: limit };
}

/**
 * Strict boolean for query strings. `z.coerce.boolean()` must not be used for
 * query params: it turns the string "false" into `true`.
 */
export const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Route params object with a single UUID field, e.g. `uuidParams('facultyId')`. */
export function uuidParams<K extends string>(name: K): z.ZodObject<Record<K, z.ZodUUID>> {
  return z.object({ [name]: z.uuid() } as Record<K, z.ZodUUID>);
}

export interface EnumCodec<Db extends string, Api extends string> {
  /** Zod schema accepting API values and producing database values. */
  schema: z.ZodType<Db, Api>;
  /** Converts a database value to its API representation. */
  toApi(value: Db): Api;
}

/**
 * Maps database enum values (Prisma, SCREAMING_SNAKE_CASE) to API values.
 * The mapping is explicit because some API values are not a case change of
 * the database value (e.g. STUDENT -> 'students').
 */
export function createEnumCodec<Db extends string, Api extends string>(
  mapping: Record<Db, Api>
): EnumCodec<Db, Api> {
  const dbToApi = new Map<Db, Api>(Object.entries(mapping) as [Db, Api][]);
  const apiToDb = new Map<Api, Db>();
  for (const [db, api] of dbToApi) {
    if (apiToDb.has(api)) {
      throw new Error(`Enum codec maps API value '${api}' to more than one database value`);
    }
    apiToDb.set(api, db);
  }
  const apiValues = [...apiToDb.keys()] as [Api, ...Api[]];

  return {
    schema: z.enum(apiValues).transform((value) => apiToDb.get(value) as Db),
    toApi(value: Db): Api {
      if (!dbToApi.has(value)) {
        throw new Error(`No API mapping for database enum value '${value}'`);
      }
      return dbToApi.get(value) as Api;
    },
  };
}

/** Mapping helper for enums whose API values are simply the lowercase database values. */
export function lowercaseEnumMapping<Db extends string>(
  values: readonly Db[]
): Record<Db, Lowercase<Db>> {
  return Object.fromEntries(values.map((value) => [value, value.toLowerCase()])) as Record<
    Db,
    Lowercase<Db>
  >;
}

export { MAX_PASSWORD_BYTES, passwordSchema } from './password.js';
