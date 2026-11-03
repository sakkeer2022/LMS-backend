import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import YAML from 'yaml';
import { expect } from 'vitest';
import type { Response } from 'supertest';

/**
 * Validates API responses against the response schemas in docs/openapi.yaml
 * (LMS-93), so integration tests prove the implementation matches the contract.
 *
 *   const res = await request(app).get('/api/v1/admin/settings')...;
 *   expectContractResponse(res, 'get', '/admin/settings');
 */

const API_PREFIX = '/api/v1';
const CONTRACT_ID = 'contract';

interface Operation {
  responses?: Record<string, { $ref?: string; content?: Record<string, { schema?: unknown }> }>;
}

const contract = YAML.parse(
  fs.readFileSync(path.resolve(__dirname, '../../docs/openapi.yaml'), 'utf8')
) as { paths: Record<string, Record<string, Operation>> };

// OpenAPI 3.0 schemas use keywords such as `example` that are not JSON Schema,
// so strict mode is off. `nullable` is supported by Ajv.
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(contract, CONTRACT_ID);

function pointer(...segments: string[]): string {
  return segments.map((s) => s.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

/** Finds the contract path for a concrete or templated path, e.g. /users/123 → /users/{userId}. */
function contractPathFor(routePath: string): string | undefined {
  const target = routePath.split('?')[0]!.replace(/^\/api\/v1/, '');
  return Object.keys(contract.paths).find((candidate) => {
    const pattern = new RegExp(
      `^${candidate.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}/g, '[^/]+')}$`
    );
    return pattern.test(target) || candidate === target;
  });
}

/**
 * Errors from validating `body` against the contract's JSON schema for this
 * operation and status, or an explanation of why there is no schema to use.
 */
export function contractResponseErrors(
  method: string,
  routePath: string,
  status: number,
  body: unknown
): string[] {
  const contractPath = contractPathFor(routePath);
  if (!contractPath) return [`${routePath} is not in the contract`];
  const operation = contract.paths[contractPath]?.[method.toLowerCase()];
  if (!operation) return [`${method.toUpperCase()} ${contractPath} is not in the contract`];

  const response = operation.responses?.[String(status)];
  if (!response) return [`${method.toUpperCase()} ${contractPath} documents no ${status} response`];

  // Responses may be shared components: '#/components/responses/NotFound'
  const responsePointer = response.$ref
    ? response.$ref.replace(/^#/, '')
    : `/${pointer('paths', contractPath, method.toLowerCase(), 'responses', String(status))}`;
  const resolved = response.$ref
    ? (responsePointer
        .split('/')
        .slice(1)
        .reduce<unknown>(
          (node, key) =>
            (node as Record<string, unknown>)?.[key.replace(/~1/g, '/').replace(/~0/g, '~')],
          contract
        ) as { content?: Record<string, unknown> })
    : response;
  if (!resolved?.content?.['application/json']) {
    return [`${method.toUpperCase()} ${contractPath} ${status} has no application/json schema`];
  }

  const validate = ajv.getSchema(
    `${CONTRACT_ID}#${responsePointer}/${pointer('content', 'application/json', 'schema')}`
  );
  if (!validate) return [`could not compile the ${status} schema for ${contractPath}`];
  if (validate(body)) return [];
  return (validate.errors ?? []).map(
    (e) =>
      `${e.instancePath || '(body)'} ${e.message ?? 'is invalid'}${e.params ? ` ${JSON.stringify(e.params)}` : ''}`
  );
}

/** Asserts that a supertest response matches the contract for its operation and status. */
export function expectContractResponse(res: Response, method: string, routePath: string): void {
  const errors = contractResponseErrors(method, `${API_PREFIX}${routePath}`, res.status, res.body);
  expect(errors, `${method.toUpperCase()} ${routePath} → ${res.status}`).toEqual([]);
}
