// Public surface of the email-otp module. Registration, recovery and email verification use these.
export {
  consumeRegistrationToken,
  issueEmailOtp,
  normalizeEmail,
  verifyEmailOtp,
  type IssuedChallenge,
  type VerifiedOtp,
} from './email-otp.service.js';
