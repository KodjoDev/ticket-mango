-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('PROPOSED', 'SCHEDULED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'DEVELOPER';

-- CreateTable
CREATE TABLE "Meeting" (
    "id" UUID NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "organizerId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" "MeetingStatus" NOT NULL,
    "startsAt" TIMESTAMP(3),
    "meetUrl" TEXT,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT,
    "bookingToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingSlot" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAttendee" (
    "meetingId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "MeetingAttendee_pkey" PRIMARY KEY ("meetingId","userId")
);

-- CreateTable
CREATE TABLE "Macro" (
    "id" UUID NOT NULL,
    "systemKey" TEXT,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "actions" JSONB NOT NULL DEFAULT '{}',
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Macro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_bookingToken_key" ON "Meeting"("bookingToken");

-- CreateIndex
CREATE INDEX "Meeting_ticketId_idx" ON "Meeting"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingSlot_meetingId_startsAt_key" ON "MeetingSlot"("meetingId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Macro_systemKey_key" ON "Macro"("systemKey");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSlot" ADD CONSTRAINT "MeetingSlot_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Macros système (préremplies après une prise de rendez-vous) et exemples modifiables.
INSERT INTO "Macro" ("id", "systemKey", "name", "body", "isInternal", "actions", "position", "updatedAt") VALUES
    (gen_random_uuid(), 'meeting_scheduled', 'Invitation Meet',
     E'Bonjour {{demandeur.prenom}},\n\nPour avancer sur votre demande #{{ticket.id}} « {{ticket.sujet}} », je vous propose un échange en visio.\n\nDate : {{meet.date}}\nDurée : {{meet.duree}}\nParticipants : {{meet.participants}}\nLien Google Meet : {{meet.lien}}\n\nÀ bientôt,\n{{agent.prenom}}',
     false, '{}', 0, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'meeting_proposal', 'Proposition de créneaux',
     E'Bonjour {{demandeur.prenom}},\n\nPour avancer sur votre demande #{{ticket.id}} « {{ticket.sujet}} », je vous propose un échange en visio de {{meet.duree}} avec {{meet.participants}}.\n\nVoici les créneaux disponibles :\n{{meet.creneaux}}\n\nChoisissez celui qui vous convient ici : {{meet.reservation}}\nLe lien Google Meet vous sera communiqué dès votre choix.\n\nÀ bientôt,\n{{agent.prenom}}',
     false, '{}', 1, CURRENT_TIMESTAMP),
    (gen_random_uuid(), NULL, 'Demande d''informations complémentaires',
     E'Bonjour {{demandeur.prenom}},\n\nPour analyser votre demande #{{ticket.id}}, pourriez-vous nous préciser :\n- les étapes pour reproduire le problème ;\n- la date et l''heure approximatives ;\n- une capture d''écran si possible ?\n\nMerci,\n{{agent.prenom}}',
     false, '{"status": "QUALIFYING", "assignToMe": true}', 2, CURRENT_TIMESTAMP),
    (gen_random_uuid(), NULL, 'Correctif livré',
     E'Bonjour {{demandeur.prenom}},\n\nLe correctif concernant votre demande #{{ticket.id}} « {{ticket.sujet}} » est désormais en production. N''hésitez pas à nous recontacter si le problème persiste.\n\nBonne journée,\n{{agent.prenom}}',
     false, '{"status": "RESOLVED"}', 3, CURRENT_TIMESTAMP);
