-- LMS-102: give audit records an explicit position in the hash chain.
-- Linking and verification used created_at (millisecond precision) with a random
-- UUID tie-break, so records written in the same millisecond were chained in one
-- order and verified in another.
--
-- Equivalent to `ADD COLUMN "sequence" BIGSERIAL`, but existing rows are numbered
-- in the order they were previously verified (created_at, id) instead of an
-- arbitrary physical order.

CREATE SEQUENCE "audit_logs_sequence_seq" AS BIGINT;

ALTER TABLE "audit_logs" ADD COLUMN "sequence" BIGINT;

UPDATE "audit_logs" AS a
SET "sequence" = numbered.position
FROM (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "created_at", "id") AS position
  FROM "audit_logs"
) AS numbered
WHERE a."id" = numbered."id";

SELECT setval(
  '"audit_logs_sequence_seq"',
  COALESCE((SELECT MAX("sequence") FROM "audit_logs"), 0) + 1,
  false
);

ALTER TABLE "audit_logs"
  ALTER COLUMN "sequence" SET DEFAULT nextval('"audit_logs_sequence_seq"'),
  ALTER COLUMN "sequence" SET NOT NULL;

ALTER SEQUENCE "audit_logs_sequence_seq" OWNED BY "audit_logs"."sequence";

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_sequence_key" ON "audit_logs"("sequence");
