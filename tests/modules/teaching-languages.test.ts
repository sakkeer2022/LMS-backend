import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../helpers/app.js';
import { expectContractResponse } from '../helpers/contract.js';
import { prisma } from '@infrastructure/database/index.js';

describe('GET /catalogue/teaching-languages', () => {
  it('lists the active languages in display order, without signing in', async () => {
    await prisma.teachingLanguage.createMany({
      data: [
        { code: 'hi', name: 'Hindi', languageCodes: ['hi'], displayOrder: 2 },
        { code: 'en', name: 'English', languageCodes: ['en'], displayOrder: 1 },
        { code: 'old', name: 'Retired', languageCodes: ['xx'], displayOrder: 0, isActive: false },
      ],
    });
    const res = await request(app).get('/api/v1/catalogue/teaching-languages?limit=100');
    expect(res.status).toBe(200);
    expectContractResponse(res, 'get', '/catalogue/teaching-languages');
    expect(res.body.data.map((row: { code: string }) => row.code)).toEqual(['en', 'hi']);
    expect(res.body.meta.total).toBe(2);
  });

  it('rejects an unknown query parameter', async () => {
    const res = await request(app).get('/api/v1/catalogue/teaching-languages?foo=1');
    expect(res.status).toBe(422);
  });
});
