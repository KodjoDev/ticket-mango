-- CreateEnum
CREATE TYPE "Distribution" AS ENUM ('ROUND_ROBIN', 'LOAD', 'MANUAL');

-- CreateEnum
CREATE TYPE "SlaState" AS ENUM ('OK', 'WARNING', 'BREACHED', 'PAUSED', 'DONE');

-- AlterEnum
ALTER TYPE "TicketStatus" ADD VALUE 'WAITING_CUSTOMER';

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "groupId" UUID,
ADD COLUMN     "slaDueAt" TIMESTAMP(3),
ADD COLUMN     "slaState" "SlaState" NOT NULL DEFAULT 'OK';

-- CreateTable
CREATE TABLE "Group" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "distribution" "Distribution" NOT NULL DEFAULT 'MANUAL',
    "managerId" UUID,
    "lastAssignedUserId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "groupId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateTable
CREATE TABLE "RoutingRule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "groupId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPause" (
    "id" UUID NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SlaPause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaAlert" (
    "ticketId" INTEGER NOT NULL,
    "metric" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaAlert_pkey" PRIMARY KEY ("ticketId","metric","level")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "ticketId" INTEGER,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Group_name_key" ON "Group"("name");

-- CreateIndex
CREATE INDEX "GroupMember_userId_idx" ON "GroupMember"("userId");

-- CreateIndex
CREATE INDEX "SlaPause_ticketId_idx" ON "SlaPause"("ticketId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_groupId_idx" ON "Ticket"("groupId");

-- CreateIndex
CREATE INDEX "Ticket_slaState_slaDueAt_idx" ON "Ticket"("slaState", "slaDueAt");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPause" ADD CONSTRAINT "SlaPause_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaAlert" ADD CONSTRAINT "SlaAlert_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Groupes par défaut (CdC §3.3) et règles de routage de départ.
INSERT INTO "Group" ("id", "name", "description", "distribution", "position", "updatedAt") VALUES
    ('00000000-0000-4000-8000-000000000001', 'Support N1', 'Premier niveau : questions et qualification', 'ROUND_ROBIN', 0, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000002', 'Support N2', 'Second niveau : incidents complexes et critiques', 'LOAD', 1, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000003', 'DevOps', 'Infrastructure, base de données, production', 'MANUAL', 2, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000004', 'Produit / QA', 'Demandes d''évolution et recette', 'MANUAL', 3, CURRENT_TIMESTAMP);

INSERT INTO "RoutingRule" ("id", "name", "conditions", "groupId", "position", "updatedAt") VALUES
    (gen_random_uuid(), 'Incidents critiques', '{"priority": ["P0", "P1"]}', '00000000-0000-4000-8000-000000000002', 0, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Évolutions', '{"type": ["FEATURE_REQUEST"]}', '00000000-0000-4000-8000-000000000004', 1, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Base de données', '{"component": ["DATABASE"]}', '00000000-0000-4000-8000-000000000003', 2, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Par défaut', '{}', '00000000-0000-4000-8000-000000000001', 3, CURRENT_TIMESTAMP);

-- Nouvelles vues, ajoutées après les vues existantes.
INSERT INTO "View" ("id", "name", "filters", "position", "updatedAt")
SELECT gen_random_uuid(), v.name, v.filters::jsonb, (SELECT COALESCE(MAX("position"), -1) FROM "View") + v.pos, CURRENT_TIMESTAMP
FROM (VALUES
    ('SLA en danger', '{"status": "open", "slaState": ["WARNING", "BREACHED"]}', 1),
    ('Mes groupes', '{"status": "open", "group": "mine"}', 2)
) AS v(name, filters, pos);
