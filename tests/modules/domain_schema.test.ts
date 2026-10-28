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
        firstName: 'Student',
        lastName: 'One',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    studentUserId = studentUser.id;

    const facultyUser = await prisma.user.create({
      data: {
        email: `faculty-${Date.now()}@test.com`,
        passwordHash,
        firstName: 'Faculty',
        lastName: 'Tutor',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    facultyUserId = facultyUser.id;

    const adminUser = await prisma.user.create({
      data: {
        email: `admin-${Date.now()}@test.com`,
        passwordHash,
        firstName: 'Admin',
        lastName: 'Manager',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    adminUserId = adminUser.id;
  });

  describe('Student Profile & Under-18 Digital Consent', () => {
    it('creates a student profile with under-18 guardian consent audit fields', async () => {
      const now = new Date();
      const profile = await prisma.studentProfile.create({
        data: {
          userId: studentUserId,
          dateOfBirth: new Date('2010-05-15'),
          isUnder18: true,
          guardianName: 'Parent Guardian',
          guardianEmail: 'guardian@test.com',
          guardianPhone: '+919876543210',
          guardianConsentSigned: true,
          guardianConsentDocument: 'doc_hash_sha256_mock_12345',
          guardianConsentSignedAt: now,
          gradeLevel: 'Grade 10',
          schoolName: 'Delhi Public School',
          city: 'Mumbai',
          state: 'Maharashtra',
          country: 'IN',
        },
      });

      expect(profile).toBeDefined();
      expect(profile.isUnder18).toBe(true);
      expect(profile.guardianConsentSigned).toBe(true);
      expect(profile.guardianConsentDocument).toBe('doc_hash_sha256_mock_12345');
      expect(profile.userId).toBe(studentUserId);
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
    it('creates Category, Board, Subject, Level, Curriculum and SessionPrice (INR paise, 60min)', async () => {
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
        data: {
          facultyId: faculty.id,
          curriculumId: curriculum.id,
          price: {
            create: {
              pricePaise: 75000, // ₹750.00
              currency: 'INR',
              durationMinutes: 60,
              isActive: true,
            },
          },
        },
        include: {
          price: true,
        },
      });

      expect(assignment.price).toBeDefined();
      expect(assignment.price?.pricePaise).toBe(75000);
      expect(assignment.price?.currency).toBe('INR');
      expect(assignment.price?.durationMinutes).toBe(60);
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
