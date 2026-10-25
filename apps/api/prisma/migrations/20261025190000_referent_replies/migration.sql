-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "awaitingAgent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastAgentReplyAt" TIMESTAMP(3),
ADD COLUMN     "lastRequesterReplyAt" TIMESTAMP(3),
ADD COLUMN     "parentId" INTEGER;

-- CreateIndex
CREATE INDEX "Ticket_parentId_idx" ON "Ticket"("parentId");

-- CreateIndex
CREATE INDEX "Ticket_awaitingAgent_idx" ON "Ticket"("awaitingAgent");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Rattrapage : dernier message public du demandeur et du support pour les tickets existants.
-- Une réponse d'un membre du support compte toujours comme réponse agent, même s'il est le demandeur.
-- La création compte comme message du demandeur quand celui-ci n'est pas un membre du support.
UPDATE "Ticket" t SET
    "lastRequesterReplyAt" = CASE WHEN u."role" = 'EXTERNAL_USER' THEN GREATEST(
        (SELECT MAX(c."createdAt") FROM "Comment" c WHERE c."ticketId" = t."id" AND c."isInternal" = false AND c."authorId" = t."requesterId"),
        t."createdAt"
    ) END,
    "lastAgentReplyAt" = (
        SELECT MAX(c."createdAt") FROM "Comment" c JOIN "User" a ON a."id" = c."authorId"
        WHERE c."ticketId" = t."id" AND c."isInternal" = false AND a."role" IN ('AGENT_N1', 'AGENT_N2', 'ADMIN')
    )
FROM "User" u
WHERE u."id" = t."requesterId";

UPDATE "Ticket" SET "awaitingAgent" = true
WHERE "status" NOT IN ('RESOLVED', 'CLOSED')
  AND "lastRequesterReplyAt" IS NOT NULL
  AND ("lastAgentReplyAt" IS NULL OR "lastRequesterReplyAt" > "lastAgentReplyAt");

INSERT INTO "View" ("id", "name", "filters", "position", "updatedAt")
SELECT gen_random_uuid(), 'Réponse client en attente', '{"status": "open", "awaitingAgent": true}'::jsonb,
       (SELECT COALESCE(MAX("position"), -1) + 1 FROM "View"), CURRENT_TIMESTAMP;
