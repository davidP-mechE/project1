-- CreateEnum
CREATE TYPE "DeckStatus" AS ENUM ('AWAITING_UPLOAD', 'UPLOADED', 'MERGED', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "Deck" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "isPptx" BOOLEAN NOT NULL DEFAULT false,
    "sizeBytes" BIGINT NOT NULL,
    "status" "DeckStatus" NOT NULL DEFAULT 'AWAITING_UPLOAD',
    "error" TEXT,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deck_bookId_status_idx" ON "Deck"("bookId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Deck_bookId_order_key" ON "Deck"("bookId", "order");

-- AddForeignKey
ALTER TABLE "Deck" ADD CONSTRAINT "Deck_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
