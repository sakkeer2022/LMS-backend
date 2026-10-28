/* eslint-disable no-console, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-non-null-assertion */
import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

// Helpers for name styling
function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

function toCamelCase(str: string): string {
  const kebab = toKebabCase(str);
  return kebab.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function getSingular(name: string): string {
  if (name.endsWith('ies')) return name.slice(0, -3) + 'y';
  if (name.endsWith('s') && !name.endsWith('us') && !name.endsWith('is') && !name.endsWith('as')) {
    return name.slice(0, -1);
  }
  return name;
}

// Simple flag parser
function parseArgs(): { name?: string; actions?: string } {
  const args = process.argv.slice(2);
  const result: { name?: string; actions?: string } = {};
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--name' || args[i] === '-n') && args[i + 1]) {
      result.name = args[i + 1];
      i++;
    } else if ((args[i] === '--actions' || args[i] === '-a') && args[i + 1]) {
      result.actions = args[i + 1];
      i++;
    }
  }
  return result;
}

async function main() {
  const rl = readline.createInterface({ input, output });
  const parsed = parseArgs();

  let name = parsed.name || '';
  let actionsInput = parsed.actions || '';

  console.log('🤖 RBAC Module Scaffold Generator');
  console.log('=================================');

  // Name Prompt
  while (!name.trim()) {
    name = await rl.question('Enter module name (plural, e.g. notifications): ');
    if (!name.trim()) {
      console.log('❌ Module name is required.');
    }
  }

  const kebabName = toKebabCase(name);
  const camelName = toCamelCase(name);
  const pascalName = toPascalCase(name);
  const singularPascal = toPascalCase(getSingular(name));
  const singularCamel = toCamelCase(getSingular(name));

  // Actions Prompt
  if (!actionsInput.trim()) {
    actionsInput = await rl.question(
      'Enter actions (comma-separated, default: create,read,update,delete): '
    );
  }
  rl.close();

  const actions = actionsInput.trim()
    ? actionsInput.split(',').map((s) => s.trim().toLowerCase())
    : ['create', 'read', 'update', 'delete'];

  const moduleDir = path.join(process.cwd(), 'src/modules', kebabName);

  if (fs.existsSync(moduleDir)) {
    console.log(`❌ Module directory already exists at: src/modules/${kebabName}`);
    process.exit(1);
  }

  console.log(`\n🏗️  Generating module '${kebabName}'...`);
  fs.mkdirSync(moduleDir, { recursive: true });

  // 1. Generate DTO
  const dtoContent = `import { z } from 'zod';
import { PaginationQueryDto } from '@modules/roles/roles.dto.js';

export const Create${singularPascal}Dto = z.object({
  name: z.string().min(2).max(100).trim(),
  description: z.string().max(500).optional(),
});

export const Update${singularPascal}Dto = Create${singularPascal}Dto.partial();

export { PaginationQueryDto };
export type Create${singularPascal}Input = z.infer<typeof Create${singularPascal}Dto>;
export type Update${singularPascal}Input = z.infer<typeof Update${singularPascal}Dto>;
`;
  fs.writeFileSync(path.join(moduleDir, `${kebabName}.dto.ts`), dtoContent);
  console.log(`   + Created: src/modules/${kebabName}/${kebabName}.dto.ts`);

  // 2. Generate Service
  const serviceContent = `import { prisma } from '@infrastructure/database/index';
import { NotFoundError } from '@core/errors/index';
import { buildPaginationMeta, type PaginatedResult } from '@shared/types/pagination';
import type { Create${singularPascal}Input, Update${singularPascal}Input } from './${kebabName}.dto.js';
import type { PaginationQueryInput } from '@modules/roles/roles.dto.js';
import type { Prisma } from '@prisma/client';

export interface ${singularPascal}Detail {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function list${pascalName}(
  query: PaginationQueryInput
): Promise<PaginatedResult<${singularPascal}Detail>> {
  const { page, limit, search } = query;
  const offset = (page - 1) * limit;
  const where: Prisma.${singularPascal}WhereInput = {};

  if (search) {
    where.name = { contains: search, mode: 'insensitive' };
  }

  const [count, rows] = await prisma.$transaction([
    prisma.${singularCamel}.count({ where }),
    prisma.${singularCamel}.findMany({
      where,
      skip: offset,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const items = rows.map(_to${singularPascal}Detail);
  return { items, meta: buildPaginationMeta(count, page, limit) };
}

export async function get${singularPascal}ById(id: string): Promise<${singularPascal}Detail> {
  const item = await prisma.${singularCamel}.findUnique({ where: { id } });
  if (!item) throw new NotFoundError('${singularPascal}');
  return _to${singularPascal}Detail(item);
}

export async function create${singularPascal}(dto: Create${singularPascal}Input): Promise<${singularPascal}Detail> {
  const item = await prisma.${singularCamel}.create({
    data: {
      name: dto.name,
      description: dto.description ?? null,
    },
  });
  return _to${singularPascal}Detail(item);
}

export async function update${singularPascal}(
  id: string,
  dto: Update${singularPascal}Input
): Promise<${singularPascal}Detail> {
  const item = await prisma.${singularCamel}.findUnique({ where: { id } });
  if (!item) throw new NotFoundError('${singularPascal}');

  const updated = await prisma.${singularCamel}.update({
    where: { id },
    data: {
      name: dto.name ?? undefined,
      description: dto.description !== undefined ? dto.description : undefined,
    },
  });
  return _to${singularPascal}Detail(updated);
}

export async function delete${singularPascal}(id: string): Promise<void> {
  const item = await prisma.${singularCamel}.findUnique({ where: { id } });
  if (!item) throw new NotFoundError('${singularPascal}');

  await prisma.${singularCamel}.delete({ where: { id } });
}

function _to${singularPascal}Detail(item: {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ${singularPascal}Detail {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
`;
  fs.writeFileSync(path.join(moduleDir, `${kebabName}.service.ts`), serviceContent);
  console.log(`   + Created: src/modules/${kebabName}/${kebabName}.service.ts`);

  // 3. Generate Controller
  const controllerContent = `import { Request, Response, NextFunction } from 'express';
import { Create${singularPascal}Dto, Update${singularPascal}Dto, PaginationQueryDto } from './${kebabName}.dto.js';
import * as ${pascalName}Service from './${kebabName}.service.js';
import { successResponse } from '@core/response/index';

export async function list${pascalName}(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = PaginationQueryDto.parse(req.query);
    const result = await ${pascalName}Service.list${pascalName}(query);
    res.json(successResponse(result.items, '${pascalName} retrieved', result.meta));
  } catch (err) {
    next(err);
  }
}

export async function get${singularPascal}ById(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const item = await ${pascalName}Service.get${singularPascal}ById(req.params['id'] as string);
    res.json(successResponse(item));
  } catch (err) {
    next(err);
  }
}

export async function create${singularPascal}(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dto = Create${singularPascal}Dto.parse(req.body);
    const item = await ${pascalName}Service.create${singularPascal}(dto);
    res.status(201).json(successResponse(item, '${singularPascal} created'));
  } catch (err) {
    next(err);
  }
}

export async function update${singularPascal}(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dto = Update${singularPascal}Dto.parse(req.body);
    const item = await ${pascalName}Service.update${singularPascal}(req.params['id'] as string, dto);
    res.json(successResponse(item, '${singularPascal} updated'));
  } catch (err) {
    next(err);
  }
}

export async function delete${singularPascal}(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await ${pascalName}Service.delete${singularPascal}(req.params['id'] as string);
    res.json(successResponse(null, '${singularPascal} deleted'));
  } catch (err) {
    next(err);
  }
}
`;
  fs.writeFileSync(path.join(moduleDir, `${kebabName}.controller.ts`), controllerContent);
  console.log(`   + Created: src/modules/${kebabName}/${kebabName}.controller.ts`);

  // 4. Generate Routes
  let routeHandlers = '';
  if (actions.includes('read')) {
    routeHandlers += `
notificationsRouter.get(
  '/',
  requirePermission('${kebabName}.read'),
  ${pascalName}Controller.list${pascalName}
);

notificationsRouter.get(
  '/:id',
  requirePermission('${kebabName}.read'),
  ${pascalName}Controller.get${singularPascal}ById
);`;
  }
  if (actions.includes('create')) {
    routeHandlers += `
notificationsRouter.post(
  '/',
  requirePermission('${kebabName}.create'),
  ${pascalName}Controller.create${singularPascal}
);`;
  }
  if (actions.includes('update')) {
    routeHandlers += `
notificationsRouter.patch(
  '/:id',
  requirePermission('${kebabName}.update'),
  ${pascalName}Controller.update${singularPascal}
);`;
  }
  if (actions.includes('delete')) {
    routeHandlers += `
notificationsRouter.delete(
  '/:id',
  requirePermission('${kebabName}.delete'),
  ${pascalName}Controller.delete${singularPascal}
);`;
  }

  // Replace default placeholder route handler names
  routeHandlers = routeHandlers.replace(/notificationsRouter/g, `${camelName}Router`);

  const routesContent = `import { Router } from 'express';
import { authenticate, requirePermission } from '@middleware/authenticate';
import * as ${pascalName}Controller from './${kebabName}.controller.js';

export const ${camelName}Router = Router();

// All routes require authentication
${camelName}Router.use(authenticate);
${routeHandlers}
`;
  fs.writeFileSync(path.join(moduleDir, `${kebabName}.routes.ts`), routesContent);
  console.log(`   + Created: src/modules/${kebabName}/${kebabName}.routes.ts`);

  // 5. Generate Test
  const testContent = `import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../helpers/app.js';
import { getCsrfData } from '../helpers/csrf.js';
import { prisma } from '@infrastructure/database/index.js';

describe('${pascalName} API', () => {
  let superAdminToken: string;

  beforeEach(async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();

    const adminRole = await prisma.role.create({
      data: {
        name: 'super_admin',
        description: 'Super Admin',
        isSystem: true,
      },
    });

    const wildCardPerm = await prisma.permission.create({
      data: {
        name: '*',
        resource: 'all',
        action: 'manage',
        description: 'Global access',
      },
    });

    await prisma.rolePermission.create({
      data: {
        roleId: adminRole.id,
        permissionId: wildCardPerm.id,
      },
    });

    await request(app)
      .post('/api/v1/auth/register')
      .set('Cookie', csrfCookie ?? '')
      .set('x-csrf-token', csrfToken ?? '')
      .send({
        email: 'super@example.com',
        password: 'Password123!',
        fullName: 'Super Admin',
      });

    const user = await prisma.user.findFirst({ where: { email: 'super@example.com' } });

    await prisma.userRole.create({
      data: {
        userId: user!.id,
        roleId: adminRole.id,
      },
    });

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('Cookie', csrfCookie ?? '')
      .set('x-csrf-token', csrfToken ?? '')
      .send({
        email: 'super@example.com',
        password: 'Password123!',
      });

    const accessTokenCookie = (loginRes.headers['set-cookie'] as string[])?.find(
      (c) => c.startsWith('accessToken=')
    );
    superAdminToken = accessTokenCookie ? accessTokenCookie.split(';')[0].split('=')[1] : '';
  });

  it('should list items', async () => {
    const { csrfToken, csrfCookie } = await getCsrfData();
    const res = await request(app)
      .get('/api/v1/${kebabName}')
      .set('Cookie', csrfCookie ?? '')
      .set('x-csrf-token', csrfToken ?? '')
      .set('Authorization', \`Bearer \${superAdminToken}\`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
`;
  const testDir = path.join(process.cwd(), 'tests/modules');
  fs.writeFileSync(path.join(testDir, `${kebabName}.test.ts`), testContent);
  console.log(`   + Created: tests/modules/${kebabName}.test.ts`);

  // 6. Update routes/index.ts
  const routesIndexFile = path.join(process.cwd(), 'src/routes/index.ts');
  if (fs.existsSync(routesIndexFile)) {
    let routesIndex = fs.readFileSync(routesIndexFile, 'utf-8');

    // Find the place to add import
    const importRegex = /import\s+{[^}]+}\s+from\s+'@modules\/[^']+\.routes(?:\.js)?';/g;
    const imports = [...routesIndex.matchAll(importRegex)];
    if (imports.length > 0) {
      const lastImport = imports[imports.length - 1];
      const insertPos = lastImport.index! + lastImport[0].length;
      const newImport = `\nimport { ${camelName}Router } from '@modules/${kebabName}/${kebabName}.routes.js';`;
      routesIndex = routesIndex.slice(0, insertPos) + newImport + routesIndex.slice(insertPos);
    }

    // Find the place to mount route
    const useRegex = /router\.use\('[^']+',\s+\w+Router\);/g;
    const uses = [...routesIndex.matchAll(useRegex)];
    if (uses.length > 0) {
      const lastUse = uses[uses.length - 1];
      const insertPos = lastUse.index! + lastUse[0].length;
      const newUse = `\nrouter.use('/${kebabName}', ${camelName}Router);`;
      routesIndex = routesIndex.slice(0, insertPos) + newUse + routesIndex.slice(insertPos);
    }

    fs.writeFileSync(routesIndexFile, routesIndex);
    console.log(`   + Registered in src/routes/index.ts`);
  }

  // 7. Append model stub to prisma/schema.prisma
  const prismaSchemaFile = path.join(process.cwd(), 'prisma/schema.prisma');
  if (fs.existsSync(prismaSchemaFile)) {
    const prismaModel = `

model ${singularPascal} {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name        String   @unique @db.VarChar(100)
  description String?  @db.Text
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@map("${toKebabCase(name).replace(/-/g, '_')}")
}
`;
    fs.appendFileSync(prismaSchemaFile, prismaModel);
    console.log(`   + Appended model '${singularPascal}' to prisma/schema.prisma`);
  }

  console.log('\n=================================');
  console.log('🎉 Scaffold successfully generated!');
  console.log('=================================');
  console.log('👉 Next Steps:');
  console.log(`   1. Review model mapping in 'prisma/schema.prisma'`);
  console.log(
    `   2. Run 'npx prisma migrate dev --create-only', review the SQL, then 'npx prisma migrate dev'`
  );
  console.log(`   3. Add validation logic inside 'src/modules/${kebabName}/${kebabName}.dto.ts'`);
  console.log(`   4. Run your new tests: 'npx vitest run tests/modules/${kebabName}.test.ts'`);
  console.log('=================================');
}

main().catch((err) => {
  console.error('❌ Error scaffolding module:', err);
  process.exit(1);
});
