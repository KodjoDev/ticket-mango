-- CreateEnum
CREATE TYPE "DevProvider" AS ENUM ('JIRA', 'GITHUB');

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "fixedInVersion" TEXT;

-- CreateTable
CREATE TABLE "DevIntegration" (
    "id" UUID NOT NULL,
    "provider" "DevProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "baseUrl" TEXT,
    "account" TEXT,
    "tokenEnc" TEXT,
    "project" TEXT NOT NULL,
    "issueType" TEXT NOT NULL DEFAULT 'Bug',
    "statusMap" JSONB NOT NULL,
    "webhookToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DevIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevLink" (
    "id" UUID NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "integrationId" UUID NOT NULL,
    "externalKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "externalStatus" TEXT,
    "fixVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "DevLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DevIntegration_webhookToken_key" ON "DevIntegration"("webhookToken");

-- CreateIndex
CREATE INDEX "DevLink_ticketId_idx" ON "DevLink"("ticketId");

-- CreateIndex
CREATE INDEX "DevLink_integrationId_externalKey_idx" ON "DevLink"("integrationId", "externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "DevLink_integrationId_externalKey_ticketId_key" ON "DevLink"("integrationId", "externalKey", "ticketId");

-- AddForeignKey
ALTER TABLE "DevLink" ADD CONSTRAINT "DevLink_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevLink" ADD CONSTRAINT "DevLink_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "DevIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

