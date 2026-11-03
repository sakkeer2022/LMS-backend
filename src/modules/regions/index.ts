// Public surface of the regions module. Other modules read country rules only through these functions.
export {
  clearRegionCache,
  countryFromMobile,
  defaultTimezone,
  getCountry,
  guardianConsentAge,
  isValidMobile,
  listCountries,
} from './regions.service.js';
