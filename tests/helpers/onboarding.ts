import { createHash, randomUUID } from 'crypto';
import { prisma } from '@infrastructure/database/index';
import { generateInviteToken } from '../../src/modules/faculty/faculty.tokens.js';
import { createLookups, createTreeNode, leafCurriculum } from './category-tree.js';

/** A PENDING invitation and its plaintext token (as in the email link). */
export async function createInvitationWithToken(email = `tutor-${randomUUID()}@example.com`, expired = false) {
  const { token, tokenHash } = generateInviteToken();
  const now = Date.now();
  const invitation = await prisma.facultyInvitation.create({
    data: {
      email,
      tokenHash,
      createdAt: new Date(expired ? now - 4 * 86400e3 : now),
      expiresAt: new Date(expired ? now - 86400e3 : now + 72 * 3600e3),
    },
  });
  return { invitation, token };
}

/** Academic › School › K-12 (bookable, board) with two offerings, and Non-academic › Skill. */
export async function createPickerCatalogue() {
  // Academic › School › K-12 › CBSE › Physics › Class 11, and › Chemistry › Class 11.
  // A tutor picks a subject of a leaf; each leaf here offers one default subject.
  const academic = await createTreeNode(null, { code: `academic-${randomUUID().slice(0, 6)}`, name: 'Academic' });
  const school = await createTreeNode(academic, { name: 'School' });
  const k12 = await createTreeNode(school, { name: 'K-12' });
  const cbse = await createTreeNode(k12, { name: 'CBSE' });
  const physicsNode = await createTreeNode(cbse, { name: 'Physics' });
  const chemistryNode = await createTreeNode(cbse, { name: 'Chemistry' });
  const physicsLeaf = await createTreeNode(physicsNode, { name: 'Class 11' });
  const chemistryLeaf = await createTreeNode(chemistryNode, { name: 'Class 11' });
  const closedLeaf = await createTreeNode(physicsNode, { name: 'Class 12' });
  const hidden = await createTreeNode(academic, { name: 'Hidden', isActive: false });
  const { board, subject, subject2, level } = await createLookups();
  const physics = await leafCurriculum(physicsLeaf.id);
  const chemistry = await leafCurriculum(chemistryLeaf.id);
  const inactive = await prisma.curriculum.update({
    where: { id: (await leafCurriculum(closedLeaf.id)).id },
    data: { isActive: false },
  });
  const hiddenOffering = await leafCurriculum(hidden.id);
  return {
    academic, school, k12, cbse, physicsLeaf, chemistryLeaf, hidden, board, subject, subject2, level,
    physics, chemistry, inactive, hiddenOffering,
  };
}

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
export const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ffbf1e00059c02a1d4b4a2f00000000049454e44ae426082',
  'hex'
);

export function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
