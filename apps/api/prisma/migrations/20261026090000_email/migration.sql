-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('WEB', 'EMAIL');

-- CreateEnum
CREATE TYPE "InboundStatus" AS ENUM ('PROCESSED', 'DUPLICATE', 'AUTO_REPLY', 'SPAM', 'LOOP', 'ERROR');

-- CreateEnum
CREATE TYPE "OutboundStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "channel" "Channel" NOT NULL DEFAULT 'WEB',
ADD COLUMN     "messageId" TEXT;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "channel" "Channel" NOT NULL DEFAULT 'WEB',
ADD COLUMN     "mailboxId" UUID,
ADD COLUMN     "mergedIntoId" INTEGER;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Mailbox" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "imapHost" TEXT,
    "imapPort" INTEGER,
    "imapSecure" BOOLEAN NOT NULL DEFAULT true,
    "imapUser" TEXT,
    "imapPasswordEnc" TEXT,
    "imapFolder" TEXT NOT NULL DEFAULT 'INBOX',
    "uidValidity" BIGINT,
    "lastUid" INTEGER,
    "webhookToken" TEXT NOT NULL,
    "defaultType" TEXT,
    "defaultGroupId" UUID,
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEmail" (
    "id" UUID NOT NULL,
    "mailboxId" UUID,
    "messageId" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "InboundStatus" NOT NULL,
    "reason" TEXT,
    "ticketId" INTEGER,
    "commentId" UUID,
    "size" INTEGER NOT NULL,
    "rawKey" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundEmail" (
    "id" UUID NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "commentId" UUID,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "inReplyTo" TEXT,
    "references" TEXT,
    "status" "OutboundStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" UUID NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "commentId" UUID,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_address_key" ON "Mailbox"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_webhookToken_key" ON "Mailbox"("webhookToken");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEmail_messageId_key" ON "InboundEmail"("messageId");

-- CreateIndex
CREATE INDEX "InboundEmail_receivedAt_idx" ON "InboundEmail"("receivedAt");

-- CreateIndex
CREATE INDEX "InboundEmail_fromAddress_receivedAt_idx" ON "InboundEmail"("fromAddress", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundEmail_messageId_key" ON "OutboundEmail"("messageId");

-- CreateIndex
CREATE INDEX "OutboundEmail_status_nextAttemptAt_idx" ON "OutboundEmail"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboundEmail_ticketId_idx" ON "OutboundEmail"("ticketId");

-- CreateIndex
CREATE INDEX "OutboundEmail_commentId_idx" ON "OutboundEmail"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_ticketId_idx" ON "Attachment"("ticketId");

-- CreateIndex
CREATE INDEX "Attachment_commentId_idx" ON "Attachment"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "Comment_messageId_key" ON "Comment"("messageId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_defaultGroupId_fkey" FOREIGN KEY ("defaultGroupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Accusé de réception envoyé au demandeur à la création d'un ticket par e-mail (modifiable).
INSERT INTO "Macro" ("id", "systemKey", "name", "body", "isInternal", "actions", "position", "updatedAt")
SELECT gen_random_uuid(), 'email_acknowledgement', 'Accusé de réception (e-mail)',
       E'Bonjour {{demandeur.prenom}},\n\nNous avons bien reçu votre demande « {{ticket.sujet}} », enregistrée sous le numéro #{{ticket.id}}.\nUn membre de l''équipe support vous répondra dans les meilleurs délais.\n\nPour compléter votre demande, répondez simplement à cet e-mail.\n\nL''équipe support',
       false, '{}', (SELECT COALESCE(MAX("position"), -1) + 1 FROM "Macro"), CURRENT_TIMESTAMP;
