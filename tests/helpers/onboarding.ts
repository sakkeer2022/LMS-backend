import { createHash, randomUUID } from 'crypto';
import { prisma } from '@infrastructure/database/index';
import { generateInviteToken } from '../../src/modules/faculty/faculty.tokens.js';
import { allowLevels, createLookups, createOffering, createTreeNode } from './category-tree.js';

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
  const academic = await createTreeNode(null, { code: `academic-${randomUUID().slice(0, 6)}`, name: 'Academic' });
  const school = await createTreeNode(academic, { name: 'School' });
  const k12 = await createTreeNode(school, { name: 'K-12', isBookable: true, requiresBoard: true, requiresLevel: true });
  const hidden = await createTreeNode(academic, { name: 'Hidden', isBookable: true, isActive: false });
  const { board, subject, subject2, level, level2 } = await createLookups();
  await allowLevels(k12.id, [level.id, level2.id]);
  const physics = await createOffering({ categoryId: k12.id, subjectId: subject.id, boardId: board.id, levelId: level.id });
  const chemistry = await createOffering({ categoryId: k12.id, subjectId: subject2.id, boardId: board.id, levelId: level.id });
  const inactive = await createOffering({ categoryId: k12.id, subjectId: subject.id, boardId: board.id, levelId: level2.id, isActive: false });
  const hiddenOffering = await createOffering({ categoryId: hidden.id, subjectId: subject.id });
  return { academic, school, k12, hidden, board, subject, subject2, level, physics, chemistry, inactive, hiddenOffering };
}

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
export const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ffbf1e00059c02a1d4b4a2f00000000049454e44ae426082',
  'hex'
);

export function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
