import type { PolicyType } from '@prisma/client';
import { getPdfService } from '@infrastructure/pdf/index.js';

const TITLES: Record<PolicyType, string> = {
  TERMS_OF_USE: 'Terms of Use',
  PRIVACY_POLICY: 'Privacy Policy',
  CHILD_SAFETY_POLICY: 'Child Safety Policy',
  STUDENT_TERMS: 'Student Terms',
};

export const placeholderTitle = (type: PolicyType): string => `${TITLES[type]} (placeholder)`;

/**
 * A clearly marked stand-in for development. The real texts are supplied by the client per country
 * (docs/PENDING_DECISIONS.md C6, C7) and uploaded from the admin Legal documents screen. Never use these
 * in production: the loader refuses to create them there.
 */
export async function placeholderPolicyPdf(type: PolicyType, countryName: string): Promise<Buffer> {
  return getPdfService().renderTextDocument({
    title: `${TITLES[type]} - ${countryName}`,
    paragraphs: [
      'PLACEHOLDER FOR DEVELOPMENT ONLY. This is not legal text and has no legal effect.',
      'The final document for this country is supplied by the client and uploaded by an administrator.',
      'This page exists so the registration screens, the signing popup and the stamped consent can be built and tested.',
    ],
  });
}
