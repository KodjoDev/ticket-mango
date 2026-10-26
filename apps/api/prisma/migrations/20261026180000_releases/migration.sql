-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ReleaseCategory" AS ENUM ('NEW', 'FIX', 'ARCHITECTURE');

-- CreateTable
CREATE TABLE "Release" (
    "id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT,
    "status" "ReleaseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "notifiedCount" INTEGER,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseItem" (
    "releaseId" UUID NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "category" "ReleaseCategory" NOT NULL,
    "summary" TEXT,

    CONSTRAINT "ReleaseItem_pkey" PRIMARY KEY ("releaseId","ticketId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Release_version_key" ON "Release"("version");

-- CreateIndex
CREATE INDEX "ReleaseItem_ticketId_idx" ON "ReleaseItem"("ticketId");

-- AddForeignKey
ALTER TABLE "ReleaseItem" ADD CONSTRAINT "ReleaseItem_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseItem" ADD CONSTRAINT "ReleaseItem_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

