-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "isEliminated" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Team_isEliminated_idx" ON "Team"("isEliminated");
