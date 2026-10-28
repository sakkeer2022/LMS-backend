import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { successResponse, errorResponse } from '@core/response/index';
import { validateRequest } from '@middleware/validate';
import { notFoundHandler, globalErrorHandler } from '@middleware/errorHandler';
import { NotFoundError } from '@core/errors/index';
import { getImplementedApiSpec, getDraftContractSpec } from '../../src/docs/swagger';

describe('API Foundation & Shared Conventions', () => {
  describe('Standard Response Envelopes', () => {
    it('should format successResponse correctly with data and message', () => {
      const payload = { userId: '123' };
      const response = successResponse(payload, 'User retrieved');

      expect(response).toEqual({
        success: true,
        message: 'User retrieved',
        data: payload,
      });
      expect(response.meta).toBeUndefined();
    });

    it('should include pagination meta in successResponse when provided', () => {
      const items = [{ id: 1 }, { id: 2 }];
      const meta = { page: 1, limit: 10, total: 2, totalPages: 1 };
      const response = successResponse(items, 'List retrieved', meta);

      expect(response).toEqual({
        success: true,
        message: 'List retrieved',
        data: items,
        meta,
      });
    });

    it('should format errorResponse with message, errors map, and traceId', () => {
      const errors = { email: ['Invalid email format'] };
      const response = errorResponse('Validation failed', errors, 'trace-abc-123');

      expect(response).toEqual({
        success: false,
        message: 'Validation failed',
        errors,
        traceId: 'trace-abc-123',
      });
    });

    it('should omit errors and traceId when not provided to errorResponse', () => {
      const response = errorResponse('Internal error');

      expect(response).toEqual({
        success: false,
        message: 'Internal error',
      });
      expect(response.errors).toBeUndefined();
      expect(response.traceId).toBeUndefined();
    });
  });

  describe('Declarative Request Validation Middleware', () => {
    const TestBodySchema = z.object({
      name: z.string().min(2),
      age: z.number().int().positive(),
    });

    const TestQuerySchema = z.object({
      page: z.coerce.number().int().positive().default(1),
    });

    it('should call next() and assign parsed fields when valid', async () => {
      const middleware = validateRequest({
        body: TestBodySchema,
        query: TestQuerySchema,
      });

      const req = {
        body: { name: 'Alice', age: 25 },
        query: { page: '2' },
        params: {},
      } as unknown as Request;
      const res = {} as Response;
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.body).toEqual({ name: 'Alice', age: 25 });
      expect(req.query).toEqual({ page: 2 });
    });

    it('should forward ZodError to next(err) when body is invalid', async () => {
      const middleware = validateRequest({
        body: TestBodySchema,
      });

      const req = {
        body: { name: 'A', age: -5 },
        query: {},
        params: {},
      } as unknown as Request;
      const res = {} as Response;
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(z.ZodError);
      expect(err.issues.length).toBeGreaterThanOrEqual(2);
    });

    // Mock requests cannot reproduce Express 5's getter-only `req.query`,
    // so these cases run through a real Express app.
    describe('inside a real Express 5 app', () => {
      const ParamsSchema = z.object({ id: z.uuid() });
      const QuerySchema = z.object({
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().positive().max(100).default(20),
      });

      function buildApp(): express.Express {
        const app = express();
        app.use(express.json());
        app.post(
          '/items/:id',
          validateRequest({ params: ParamsSchema, query: QuerySchema, body: TestBodySchema }),
          (req, res) => {
            res.json({ params: req.params, query: req.query, body: req.body });
          }
        );
        app.use(globalErrorHandler);
        return app;
      }

      const validId = '3f1c2a4e-8b7d-4c3a-9e2f-1a2b3c4d5e6f';

      it('replaces query, params and body with parsed values', async () => {
        const res = await request(buildApp())
          .post(`/items/${validId}?page=3`)
          .send({ name: 'Alice', age: 25 });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          params: { id: validId },
          query: { page: 3, limit: 20 },
          body: { name: 'Alice', age: 25 },
        });
      });

      it('returns 422 with field errors for an invalid query', async () => {
        const res = await request(buildApp())
          .post(`/items/${validId}?page=0&limit=500`)
          .send({ name: 'Alice', age: 25 });

        expect(res.status).toBe(422);
        expect(res.body.success).toBe(false);
        expect(Object.keys(res.body.errors)).toEqual(expect.arrayContaining(['page', 'limit']));
      });

      it('returns 422 for invalid route params', async () => {
        const res = await request(buildApp()).post('/items/not-a-uuid').send({ name: 'Alice', age: 25 });

        expect(res.status).toBe(422);
        expect(res.body.errors).toHaveProperty('id');
      });
    });
  });

  describe('Centralized 404 Route Handler', () => {
    it('should pass a NotFoundError to next() with method and path', () => {
      const req = { method: 'POST', path: '/api/v1/unknown-endpoint' } as Request;
      const res = {} as Response;
      const next = vi.fn();

      notFoundHandler(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(NotFoundError);
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Route POST /api/v1/unknown-endpoint not found');
    });
  });

  describe('OpenAPI Specification Integrity', () => {
    type Spec = {
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };

    it('generates the implemented API spec from route JSDoc', () => {
      const spec = getImplementedApiSpec() as unknown as Spec;
      expect(spec.openapi).toMatch(/^3\.0\./);
      expect(spec.info.title).toContain('Amentorz');
      expect(spec.info.title).toContain('implemented');
      // Routes that really exist must be documented here
      expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/auth/login', '/auth/csrf-token']));
      expect(spec.components.schemas).toBeDefined();
    });

    it('loads the draft Sprint 1 contract separately from the implemented spec', () => {
      const contract = getDraftContractSpec() as unknown as Spec;
      expect(contract).not.toBeNull();
      expect(contract.openapi).toMatch(/^3\.0\./);
      expect(contract.info.version).toContain('draft');
      // Draft-only paths must not leak into the implemented spec
      const implemented = getImplementedApiSpec() as unknown as Spec;
      expect(contract.paths).toHaveProperty('/auth/student/login');
      expect(implemented.paths).not.toHaveProperty('/auth/student/login');
    });
  });
});
