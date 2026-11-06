import { Router } from 'express';
import { listActiveCountries } from './regions.controller.js';

export const regionsRouter = Router();

/**
 * @openapi
 * /regions/countries:
 *   get:
 *     summary: List the countries the platform serves
 *     description: Public. Active countries in display order with their dialling code and default time zone, for the mobile number country picker and to pick the policies for a country.
 *     tags: [Regions]
 *     responses:
 *       200:
 *         description: The active countries
 */
regionsRouter.get('/countries', listActiveCountries);
