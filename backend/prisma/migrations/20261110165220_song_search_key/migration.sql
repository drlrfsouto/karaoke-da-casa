-- AlterTable
ALTER TABLE "songs" ADD COLUMN     "search_key" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "songs_search_key_idx" ON "songs"("search_key");
