import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@infrastructure/database/index';

describe('Amentorz Domain Schema Integration', () => {
  let studentUserId: string;
  let facultyUserId: string;
  let adminUserId: string;

  beforeEach(async () => {
    const passwordHash = 'hashedpassword123';

    const studentUser = await prisma.user.create({
      data: {
        email: `student-${Date.now()}@test.com`,
        passwordHash,
        fullName: 'Student One',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    studentUserId = studentUser.id;

    const facultyUser = await prisma.user.create({
      data: {
        email: `faculty-${Date.now()}@test.com`,
        passwordHash,
        fullName: 'Faculty Tutor',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    facultyUserId = facultyUser.id;

    const adminUser = await prisma.user.create({
      data: {
        email: `admin-${Date.now()}@test.com`,
        passwordHash,
        fullName: 'Admin Manager',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    adminUserId = adminUser.id;
  });

  describe('Student Onboarding Profile, Policies & Guardian Consent', () => {
    async function createLearningCatalogue() {
      const category = await prisma.category.create({
        data: { code: 'SCHOOL', name: 'School', requiresBoard: true },
      });
      const board = await prisma.board.create({ data: { code: 'CBSE', name: 'CBSE / NCERT' } });
      const level = await prisma.level.create({ data: { code: 'CLASS_10', name: 'Class 10' } });
      const subject = await prisma.subject.create({ data: { code: 'MATHS', name: 'Mathematics' } });
      const curriculum = await prisma.curriculum.create({
        data: { categoryId: category.id, boardId: board.id, subjectId: subject.id, levelId: level.id },
      });
      const language = await prisma.teachingLanguage.create({
        data: { code: 'en_hi', name: 'English & Hindi', languageCodes: ['en', 'hi'] },
      });
      const studentTerms = await prisma.policyDocument.create({
        data: {
          type: 'STUDENT_TERMS',
          version: '1.0',
          title: 'Student Terms',
          effectiveAt: new Date('2026-09-01T00:00:00Z'),
          storageKey: 'policies/student-terms-1.0.pdf',
          sha256: 'a'.repeat(64),
          isCurrent: true,
        },
      });
      return { category, board, level, curriculum, language, studentTerms };
    }

    it('creates a minor student profile with subjects, guardian contact and linked consent', async () => {
      const { category, board, level, curriculum, language, studentTerms } =
        await createLearningCatalogue();

      // Consent is signed in the date-of-birth popup before the account exists
      const consent = await prisma.guardianConsent.create({
        data: {
          policyId: studentTerms.id,
          tokenHash: 'b'.repeat(64),
          studentFullName: 'Student One',
          studentDateOfBirth: new Date('2012-05-15'),
          signatureMode: 'DRAW',
          signedPdfStorageKey: 'consents/consent-1.pdf',
          signedPdfSha256: 'c'.repeat(64),
          ipAddress: '203.0.113.10',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      expect(consent.studentId).toBeNull();

      const profile = await prisma.studentProfile.create({
        data: {
          userId: studentUserId,
          dateOfBirth: new Date('2012-05-15'),
          categoryId: category.id,
          boardId: board.id,
          levelId: level.id,
          teachingLanguageId: language.id,
          guardianName: 'Parent Guardian',
          guardianRelationship: 'FATHER',
          guardianMobileNumber: '+919876543210',
          guardianEmail: 'guardian@test.com',
          guardianReceivesReports: true,
          subjects: { create: [{ curriculumId: curriculum.id }] },
        },
        include: { subjects: true },
      });

      const linked = await prisma.guardianConsent.update({
        where: { id: consent.id },
        data: {
          studentId: profile.id,
          linkedAt: new Date(),
          guardianName: profile.guardianName,
          guardianRelationship: profile.guardianRelationship,
        },
      });

      expect(profile.subjects).toHaveLength(1);
      expect(profile.dateOfBirth.toISOString()).toBe('2012-05-15T00:00:00.000Z');
      expect(profile.country).toBe('IN');
      expect(linked.studentId).toBe(profile.id);
    });

    it('rejects a second consent for the same student and policy version', async () => {
      const { category, level, language, studentTerms } = await createLearningCatalogue();
      const profile = await prisma.studentProfile.create({
        data: {
          userId: studentUserId,
          dateOfBirth: new Date('2012-05-15'),
          categoryId: category.id,
          levelId: level.id,
          teachingLanguageId: language.id,
        },
      });
      const consent = (n: string) => ({
        studentId: profile.id,
        policyId: studentTerms.id,
        tokenHash: n.repeat(64),
        studentFullName: 'Student One',
        studentDateOfBirth: new Date('2012-05-15'),
        signatureMode: 'TYPE' as const,
        typedName: 'Parent Guardian',
        signedPdfStorageKey: `consents/${n}.pdf`,
        signedPdfSha256: 'c'.repeat(64),
        ipAddress: '203.0.113.10',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        linkedAt: new Date(),
      });

      await prisma.guardianConsent.create({ data: consent('d') });
      await expect(prisma.guardianConsent.create({ data: consent('e') })).rejects.toThrow();
    });

    it('records one acceptance per user and policy version', async () => {
      const { studentTerms } = await createLearningCatalogue();
      const terms = await prisma.policyDocument.create({
        data: {
          type: 'TERMS_OF_USE',
          version: '1.0',
          title: 'Terms of Use',
          effectiveAt: new Date('2026-09-01T00:00:00Z'),
          storageKey: 'policies/terms-of-use-1.0.pdf',
          sha256: 'f'.repeat(64),
          isCurrent: true,
        },
      });

      await prisma.policyAcceptance.create({ data: { userId: studentUserId, policyId: terms.id } });
      await expect(
        prisma.policyAcceptance.create({ data: { userId: studentUserId, policyId: terms.id } })
      ).rejects.toThrow();
      await expect(
        prisma.policyDocument.create({
          data: { ...studentTerms, id: undefined, storageKey: 'policies/duplicate.pdf' },
        })
      ).rejects.toThrow();
    });
  });

  describe('Faculty Profile, Tutor Incentive Ratings & Lifecycle', () => {
    it('creates faculty profile with ratings scale, qualifications, experiences and documents', async () => {
      const faculty = await prisma.facultyProfile.create({
        data: {
          userId: facultyUserId,
          headline: 'Senior Mathematics & Physics Tutor',
          bio: '10+ years tutoring CBSE & ICSE students.',
          experienceYears: 10.5,
          primarySubject: 'Mathematics',
          approvalStatus: 'PENDING',
          isPublished: false,
          isActive: true,
          ratingsAverage: 4.85,
          ratingsCount: 24,
          qualifications: {
            create: [
              {
                degree: 'B.Sc. Mathematics',
                fieldOfStudy: 'Pure Mathematics',
                institution: 'St. Xaviers College',
                yearOfPassing: 2014,
                isVerified: true,
              },
            ],
          },
          experiences: {
            create: [
              {
                organization: 'Apex Learning Academy',
                designation: 'Lead Tutor',
                startYear: 2015,
                endYear: 2023,
                isCurrent: false,
                description: 'Taught over 500 students.',
              },
            ],
          },
          documents: {
            create: [
              {
                documentType: 'DEGREE_CERTIFICATE',
                originalFileName: 'degree_certificate.pdf',
                fileSize: 1048576,
                mimeType: 'application/pdf',
                storageKey: `quarantine/fac_${Date.now()}_deg.pdf`,
                scanStatus: 'CLEAN',
                isVerified: false,
              },
            ],
          },
        },
        include: {
          qualifications: true,
          experiences: true,
          documents: true,
        },
      });

      expect(faculty.ratingsAverage.toString()).toBe('4.85');
      expect(faculty.ratingsCount).toBe(24);
      expect(faculty.qualifications).toHaveLength(1);
      expect(faculty.experiences).toHaveLength(1);
      expect(faculty.documents).toHaveLength(1);
      expect(faculty.documents[0].scanStatus).toBe('CLEAN');
    });

    it('records terms acceptance with version snapshot', async () => {
      const terms = await prisma.facultyTerms.create({
        data: {
          version: 'v1.0',
          title: 'Amentorz Faculty Terms of Service',
          content: 'Terms and conditions governing faculty onboarding and conduct.',
          effectiveAt: new Date(),
          isCurrent: true,
        },
      });

      const faculty = await prisma.facultyProfile.create({
        data: {
          userId: facultyUserId,
          headline: 'Chemistry Specialist',
          approvalStatus: 'APPROVED',
          isPublished: true,
          approvedBy: adminUserId,
          approvedAt: new Date(),
        },
      });

      const acceptance = await prisma.facultyTermsAcceptance.create({
        data: {
          facultyId: faculty.id,
          termsId: terms.id,
          termsVersion: terms.version,
          ipAddress: '127.0.0.1',
        },
      });

      expect(acceptance.termsVersion).toBe('v1.0');
      expect(acceptance.facultyId).toBe(faculty.id);
    });
  });

  describe('Catalogue, Pricing & Nullable Board Uniqueness', () => {
    it('creates Category, Board, Subject, Level, Curriculum and a tutor PriceRule (INR paise)', async () => {
      const category = await prisma.category.create({
        data: {
          code: 'SCHOOL',
          name: 'School Education',
          requiresBoard: true,
          displayOrder: 1,
        },
      });

      const board = await prisma.board.create({
        data: {
          code: 'CBSE',
          name: 'Central Board of Secondary Education',
          country: 'IN',
        },
      });

      const subject = await prisma.subject.create({
        data: {
          code: 'MATH_X',
          name: 'Mathematics Class 10',
        },
      });

      const level = await prisma.level.create({
        data: {
          code: 'GRADE_10',
          name: 'Grade 10',
        },
      });

      const curriculum = await prisma.curriculum.create({
        data: {
          categoryId: category.id,
          boardId: board.id,
          subjectId: subject.id,
          levelId: level.id,
          syllabus: 'Algebra, Geometry, Trigonometry, Statistics',
        },
      });

      const faculty = await prisma.facultyProfile.create({
        data: {
          userId: facultyUserId,
          headline: 'Certified CBSE Math Tutor',
          approvalStatus: 'APPROVED',
          isPublished: true,
        },
      });

      const assignment = await prisma.facultyAssignment.create({
        data: { facultyId: faculty.id, curriculumId: curriculum.id },
      });
      expect(assignment.isActive).toBe(true);

      // session_prices was replaced by price_rules (LMS-58); GST is stored with the rule
      const price = await prisma.priceRule.create({
        data: {
          curriculumId: curriculum.id,
          facultyId: faculty.id,
          sessionPricePaise: 75000, // ₹750.00
          gstRateBps: 1800,
          gstPaise: 13500,
          studentPaysPaise: 88500,
        },
      });
      expect(price.sessionPricePaise).toBe(75000);
      expect(price.studentPaysPaise).toBe(88500);
    });

    it('enforces non-School curriculum tuple uniqueness with NULL board', async () => {
      const category = await prisma.category.create({
        data: {
          code: 'RESEARCH_SKILL',
          name: 'Research & Skill Learning',
          requiresBoard: false,
        },
      });

      const subject = await prisma.subject.create({
        data: {
          code: 'PYTHON_DATA',
          name: 'Python for Data Analysis',
        },
      });

      const level = await prisma.level.create({
        data: {
          code: 'ADVANCED',
          name: 'Advanced Level',
        },
      });

      // First curriculum with boardId: null
      const first = await prisma.curriculum.create({
        data: {
          categoryId: category.id,
          boardId: null,
          subjectId: subject.id,
          levelId: level.id,
          syllabus: 'NumPy, Pandas, Matplotlib',
        },
      });
      expect(first.boardId).toBeNull();

      // Second curriculum with identical tuple (boardId: null) MUST be rejected by UNIQUE NULLS NOT DISTINCT
      await expect(
        prisma.curriculum.create({
          data: {
            categoryId: category.id,
            boardId: null,
            subjectId: subject.id,
            levelId: level.id,
            syllabus: 'Duplicate tuple syllabus',
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('Library Materials & Moderation Reviews', () => {
    it('creates library material and links moderation review with reviewer identity', async () => {
      const material = await prisma.libraryMaterial.create({
        data: {
          title: 'Class 10 Trigonometry Formula Sheet',
          description: 'Quick reference cheat-sheet for board exams.',
          kind: 'DOCUMENT',
          audience: 'STUDENT',
          status: 'PENDING',
          storageKey: `quarantine/lib_${Date.now()}_sheet.pdf`,
          fileSize: 245760,
          mimeType: 'application/pdf',
          scanStatus: 'CLEAN',
          uploadedBy: adminUserId,
        },
      });

      const review = await prisma.libraryReview.create({
        data: {
          materialId: material.id,
          reviewerId: adminUserId,
          decision: 'APPROVED',
          notes: 'High quality material. Approved for student library.',
        },
      });

      const updated = await prisma.libraryMaterial.update({
        where: { id: material.id },
        data: { status: 'APPROVED' },
        include: { reviews: true },
      });

      expect(updated.status).toBe('APPROVED');
      expect(updated.reviews).toHaveLength(1);
      expect(updated.reviews[0].decision).toBe('APPROVED');
      expect(review.reviewerId).toBe(adminUserId);
    });
  });
});
