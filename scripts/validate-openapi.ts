/**
 * Node.js / TypeScript validator for OpenAPI 3.0.3 contract.
 * Validates structural integrity, component references, and required properties.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const specPath = path.resolve(__dirname, '../docs/openapi.yaml');

if (!fs.existsSync(specPath)) {
  console.error(`❌ Error: OpenAPI specification not found at ${specPath}`);
  process.exit(1);
}

try {
  const content = fs.readFileSync(specPath, 'utf8');
  const spec = YAML.parse(content);

  if (!spec || typeof spec !== 'object') {
    throw new Error('OpenAPI specification is not a valid object');
  }

  // 1. Core metadata
  if (!spec.openapi || !spec.openapi.startsWith('3.0')) {
    throw new Error(`Expected OpenAPI 3.0.x, found: ${spec.openapi}`);
  }
  if (!spec.info?.title || !spec.info?.version) {
    throw new Error('Missing info.title or info.version');
  }
  if (!Array.isArray(spec.servers) || spec.servers.length === 0) {
    throw new Error('Missing or empty servers array');
  }

  // 2. Reference Resolver
  function resolveRef(ref: string): unknown {
    if (!ref.startsWith('#/')) {
      throw new Error(`External references are not permitted: ${ref}`);
    }
    const parts = ref.slice(2).split('/');
    let current: unknown = spec;
    for (const part of parts) {
      const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~');
      if (current && typeof current === 'object' && decoded in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[decoded];
      } else {
        throw new Error(`Unresolvable reference: ${ref} (at ${decoded})`);
      }
    }
    return current;
  }

  // 3. Recursive walker
  function validateNode(node: unknown, pathStr: string): void {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      node.forEach((item, idx) => validateNode(item, `${pathStr}[${idx}]`));
      return;
    }

    const obj = node as Record<string, unknown>;

    if (typeof obj['$ref'] === 'string') {
      resolveRef(obj['$ref']);
    }

    if (obj['type'] === 'object' && Array.isArray(obj['required'])) {
      const required = obj['required'] as string[];
      if (required.length === 0) {
        throw new Error(`Empty required array at ${pathStr}`);
      }
      const properties = (obj['properties'] as Record<string, unknown>) || {};
      for (const reqProp of required) {
        if (!(reqProp in properties)) {
          throw new Error(`Required property '${reqProp}' not found in properties at ${pathStr}`);
        }
      }
    }

    for (const [key, val] of Object.entries(obj)) {
      validateNode(val, `${pathStr}.${key}`);
    }
  }

  validateNode(spec, 'root');

  // 4. Paths and Operations
  const paths = (spec.paths as Record<string, Record<string, unknown>>) || {};
  let totalOperations = 0;
  const operationIds = new Set<string>();

  for (const [pathKey, methods] of Object.entries(paths)) {
    for (const [method, opVal] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method.toLowerCase())) {
        continue;
      }
      const op = opVal as Record<string, unknown>;
      const opId = op['operationId'] as string;
      if (!opId) {
        throw new Error(`Missing operationId at ${method.toUpperCase()} ${pathKey}`);
      }
      if (operationIds.has(opId)) {
        throw new Error(`Duplicate operationId: ${opId}`);
      }
      operationIds.add(opId);
      totalOperations++;

      if (!op['summary'] || !op['description']) {
        throw new Error(`Missing summary or description at ${opId}`);
      }
      if (!op['responses'] || typeof op['responses'] !== 'object') {
        throw new Error(`Missing responses at ${opId}`);
      }
    }
  }

  const schemasCount = Object.keys(spec.components?.schemas || {}).length;

  console.log(`✅ PASS: OpenAPI 3.0.3 specification validated successfully.`);
  console.log(`   - Specification File: docs/openapi.yaml`);
  console.log(`   - Title: ${spec.info.title}`);
  console.log(`   - Version: ${spec.info.version}`);
  console.log(`   - Endpoints: ${Object.keys(paths).length} paths, ${totalOperations} operations`);
  console.log(`   - Schemas: ${schemasCount} component schemas`);
  console.log(`   - All internal $ref pointers resolved cleanly.`);
  process.exit(0);
} catch (err: unknown) {
  console.error(`❌ OpenAPI Validation Failed:`, (err as Error).message);
  process.exit(1);
}
