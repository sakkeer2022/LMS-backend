import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import swaggerJSDoc from 'swagger-jsdoc';

/**
 * Two OpenAPI documents are served, and must not be confused:
 *
 * - Implemented API: generated from `@openapi` JSDoc in `src/modules/**\/*.routes.ts`.
 *   This is the only spec that describes routes the server actually exposes.
 * - Draft contract: `docs/openapi.yaml`, the proposed Sprint 1 API under review.
 *   Its paths are NOT implemented until a module lands and documents them in JSDoc.
 */

// Resolve paths relative to the project root (works from both src/ and dist/)
const projectRoot = path.resolve(__dirname, '../../');
const draftContractPath = path.join(projectRoot, 'docs/openapi.yaml');

type OpenApiDocument = Record<string, unknown>;

let implementedApiSpec: OpenApiDocument | undefined;
let draftContractSpec: OpenApiDocument | null | undefined;

export function getImplementedApiSpec(): OpenApiDocument {
  implementedApiSpec ??= swaggerJSDoc({
    definition: {
      openapi: '3.0.3',
      info: {
        title: 'Amentorz Learning Platform API (implemented)',
        version: '1.0.0',
        description:
          'Routes currently implemented by this server. The proposed Sprint 1 contract is served separately at /api/docs/contract.',
      },
      servers: [
        {
          url: '{apiPrefix}',
          description: 'Current environment API',
          variables: {
            apiPrefix: {
              default: '/api/v1',
              description: 'The base path for the API',
            },
          },
        },
      ],
    },
    // Glob patterns need forward slashes; path.join gives backslashes on Windows
    apis: [
      path.posix.join(projectRoot.replaceAll('\\', '/'), 'swagger/components.yaml'),
      path.posix.join(projectRoot.replaceAll('\\', '/'), 'src/modules/**/*.routes.ts'),
    ],
  }) as OpenApiDocument;
  return implementedApiSpec;
}

/** Returns the draft Sprint 1 contract, or null when the file is absent or invalid. */
export function getDraftContractSpec(): OpenApiDocument | null {
  if (draftContractSpec !== undefined) return draftContractSpec;

  draftContractSpec = null;
  try {
    if (fs.existsSync(draftContractPath)) {
      const parsed: unknown = YAML.parse(fs.readFileSync(draftContractPath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        draftContractSpec = parsed as OpenApiDocument;
      }
    }
  } catch (err) {
    console.warn('⚠️ Warning: Failed to parse draft contract docs/openapi.yaml:', err);
  }
  return draftContractSpec;
}
