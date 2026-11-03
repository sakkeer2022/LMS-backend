import type { NextFunction, Request, Response } from 'express';
import { successResponse } from '@core/response/index';
import { listCountries } from './regions.service.js';

export async function listActiveCountries(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const countries = await listCountries();
    res.set('Cache-Control', 'public, max-age=300');
    res.json(
      successResponse(
        countries.map(({ code, name, dialCode, defaultTimezone, guardianConsentAge }) => ({
          code,
          name,
          dialCode,
          defaultTimezone,
          guardianConsentAge,
        })),
        'Countries retrieved'
      )
    );
  } catch (err) {
    next(err);
  }
}
