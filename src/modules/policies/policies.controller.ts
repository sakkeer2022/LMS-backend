import type { NextFunction, Request, Response } from 'express';
import { successResponse } from '@core/response/index';
import { BadRequestError } from '@core/errors/index';
import { auditContextFrom } from '@middleware/audit.middleware';
import * as PoliciesService from './policies.service.js';
import type {
  AdminPoliciesQuery,
  CurrentPoliciesQuery,
  UploadPolicyInput,
} from './policies.dto.js';

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

export async function listAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = req.query as unknown as AdminPoliciesQuery;
    const policies = await PoliciesService.listAllPolicies({
      ...(query.country && { country: query.country }),
      ...(query.type && { type: query.type }),
    });
    res.json(successResponse(policies, 'Policies retrieved'));
  } catch (err) {
    next(err);
  }
}

export async function coverage(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(successResponse(await PoliciesService.getPolicyCoverage(), 'Coverage retrieved'));
  } catch (err) {
    next(err);
  }
}

export async function upload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new BadRequestError('Attach the policy PDF.');
    const body = req.body as UploadPolicyInput;
    const policy = await PoliciesService.uploadPolicy(
      { ...body, pdf: req.file.buffer },
      auditContextFrom(req)
    );
    res.status(201).json(successResponse(policy, 'Policy uploaded'));
  } catch (err) {
    next(err);
  }
}

export async function setCurrent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const policy = await PoliciesService.setPolicyCurrent(
      req.params['policyId'] as string,
      auditContextFrom(req)
    );
    res.json(successResponse(policy, 'Policy is now current'));
  } catch (err) {
    next(err);
  }
}
