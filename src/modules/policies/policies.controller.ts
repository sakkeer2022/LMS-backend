import type { NextFunction, Request, Response } from 'express';
import { successResponse } from '@core/response/index';
import * as PoliciesService from './policies.service.js';
import type { CurrentPoliciesQuery } from './policies.dto.js';

// Query and params are validated by validateRequest in policies.routes.ts

export async function listCurrent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { country } = req.query as unknown as CurrentPoliciesQuery;
    const policies = await PoliciesService.listCurrentPolicies(country);
    res.json(successResponse(policies, 'Policies retrieved'));
  } catch (err) {
    next(err);
  }
}

export async function getFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = await PoliciesService.getPolicyFile(req.params['policyId'] as string);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${file.fileName}"`,
      // A policy version never changes, so it can be cached publicly
      'Cache-Control': 'public, max-age=86400, immutable',
      ETag: `"${file.sha256}"`,
    });
    res.send(file.bytes);
  } catch (err) {
    next(err);
  }
}
