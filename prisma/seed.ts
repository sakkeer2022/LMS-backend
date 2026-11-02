import { prisma } from '../src/infrastructure/database/connection.js';
import { seedRbac } from './seed-rbac.js';

async function main() {
  console.log('🌱 Start seeding...');

  console.log('Seeding permissions and system roles...');
  await seedRbac(prisma);

  console.log('🌱 Seeding finished.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
