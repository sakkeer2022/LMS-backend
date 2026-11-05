-- CreateEnum
CREATE TYPE "CatalogueNodeType" AS ENUM ('CATEGORY', 'SUBSECTION', 'BOARD', 'SUBJECT', 'LEVEL');

-- CreateEnum
CREATE TYPE "CatalogueNodeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "boards" ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "subjects" ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "levels" ADD COLUMN     "category_id" UUID,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "curricula" ADD COLUMN     "node_id" UUID;

-- CreateTable
CREATE TABLE "catalogue_nodes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parent_id" UUID,
    "root_id" UUID NOT NULL,
    "type" "CatalogueNodeType" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "status" "CatalogueNodeStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "category_id" UUID,
    "board_id" UUID,
    "subject_id" UUID,
    "level_id" UUID,
    "booking_enabled" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalogue_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "catalogue_nodes_category_id_key" ON "catalogue_nodes"("category_id");

-- CreateIndex
CREATE INDEX "catalogue_nodes_root_id_parent_id_sort_order_idx" ON "catalogue_nodes"("root_id", "parent_id", "sort_order");

-- CreateIndex
CREATE INDEX "catalogue_nodes_board_id_idx" ON "catalogue_nodes"("board_id");

-- CreateIndex
CREATE INDEX "catalogue_nodes_subject_id_idx" ON "catalogue_nodes"("subject_id");

-- CreateIndex
CREATE INDEX "catalogue_nodes_level_id_idx" ON "catalogue_nodes"("level_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalogue_nodes_parent_id_slug_key" ON "catalogue_nodes"("parent_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "catalogue_nodes_parent_id_board_id_key" ON "catalogue_nodes"("parent_id", "board_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalogue_nodes_parent_id_subject_id_key" ON "catalogue_nodes"("parent_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalogue_nodes_parent_id_level_id_key" ON "catalogue_nodes"("parent_id", "level_id");

-- CreateIndex
CREATE INDEX "levels_category_id_sort_order_idx" ON "levels"("category_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "curricula_node_id_key" ON "curricula"("node_id");

-- AddForeignKey
ALTER TABLE "levels" ADD CONSTRAINT "levels_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "catalogue_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogue_nodes" ADD CONSTRAINT "catalogue_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "catalogue_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogue_nodes" ADD CONSTRAINT "catalogue_nodes_root_id_fkey" FOREIGN KEY ("root_id") REFERENCES "catalogue_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogue_nodes" ADD CONSTRAINT "catalogue_nodes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogue_nodes" ADD CONSTRAINT "catalogue_nodes_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogue_nodes" ADD CONSTRAINT "catalogue_nodes_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogue_nodes" ADD CONSTRAINT "catalogue_nodes_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written CHECK constraints (ADR 0003). Prisma does not model CHECK
-- constraints and ignores them when diffing, so they cause no drift.
-- Only CATEGORY nodes are roots.
ALTER TABLE "catalogue_nodes" ADD CONSTRAINT "catalogue_nodes_parent_check"
  CHECK (("type" = 'CATEGORY') = ("parent_id" IS NULL));

-- Each type carries exactly its own master reference; SUBSECTION carries none.
ALTER TABLE "catalogue_nodes" ADD CONSTRAINT "catalogue_nodes_master_ref_check"
  CHECK (
    (("type" = 'CATEGORY') = ("category_id" IS NOT NULL))
    AND (("type" = 'BOARD') = ("board_id" IS NOT NULL))
    AND (("type" = 'SUBJECT') = ("subject_id" IS NOT NULL))
    AND (("type" = 'LEVEL') = ("level_id" IS NOT NULL))
  );

-- A root is its own root.
ALTER TABLE "catalogue_nodes" ADD CONSTRAINT "catalogue_nodes_root_check"
  CHECK (("type" <> 'CATEGORY') OR ("root_id" = "id"));

ALTER TABLE "catalogue_nodes" ADD CONSTRAINT "catalogue_nodes_sort_order_check"
  CHECK ("sort_order" >= 0);
