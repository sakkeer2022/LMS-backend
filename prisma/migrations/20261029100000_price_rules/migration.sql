-- Hand-edited guard: price_rules replaces session_prices (ADR 0004). The old table
-- was never populated; abort rather than drop real prices.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "session_prices") THEN
    RAISE EXCEPTION 'session_prices has rows; migrate them to price_rules before applying this migration';
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "session_prices" DROP CONSTRAINT "session_prices_assignment_id_fkey";

-- DropTable
DROP TABLE "session_prices";

-- CreateTable
CREATE TABLE "price_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "curriculum_id" UUID NOT NULL,
    "faculty_id" UUID,
    "session_price_paise" INTEGER NOT NULL,
    "gst_rate_bps" INTEGER NOT NULL DEFAULT 1800,
    "gst_paise" INTEGER NOT NULL,
    "student_pays_paise" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_rules_curriculum_id_faculty_id_is_active_idx" ON "price_rules"("curriculum_id", "faculty_id", "is_active");

-- CreateIndex
CREATE INDEX "price_rules_faculty_id_idx" ON "price_rules"("faculty_id");

-- AddForeignKey
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_curriculum_id_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "curricula"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculty_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written CHECK constraints (ADR 0004). Prisma does not model CHECK
-- constraints and ignores them when diffing, so they cause no drift.
-- Session price: more than 0 and at most INR 10,00,000 (100,000,000 paise).
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_session_price_check"
  CHECK ("session_price_paise" > 0 AND "session_price_paise" <= 100000000);

ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_gst_rate_check"
  CHECK ("gst_rate_bps" BETWEEN 0 AND 10000);

-- GST is round-half-up of price x rate / 10000; the student pays price + GST.
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_amounts_check"
  CHECK (
    "gst_paise" = (("session_price_paise"::BIGINT * "gst_rate_bps" + 5000) / 10000)
    AND "student_pays_paise" = "session_price_paise" + "gst_paise"
  );

ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_window_check"
  CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from");

ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_revision_check"
  CHECK ("revision" >= 1);
