-- CreateEnum
CREATE TYPE "CustomFieldKind" AS ENUM ('TEXT', 'LONGTEXT', 'NUMBER', 'DATE', 'SELECT', 'CHECKBOX');

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "customValues" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "CustomField" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "CustomFieldKind" NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "forRequester" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_key_key" ON "CustomField"("key");

