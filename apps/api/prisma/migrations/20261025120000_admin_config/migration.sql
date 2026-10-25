-- Listes de qualification administrables : les enums deviennent des clés de FieldOption.
CREATE TYPE "OptionField" AS ENUM ('TYPE', 'COMPONENT', 'ENVIRONMENT');

CREATE TABLE "FieldOption" (
    "id" UUID NOT NULL,
    "field" "OptionField" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FieldOption_field_key_key" ON "FieldOption"("field", "key");

INSERT INTO "FieldOption" ("id", "field", "key", "label", "position", "isSystem") VALUES
    (gen_random_uuid(), 'TYPE', 'BUG', 'Bug / Incident technique', 0, true),
    (gen_random_uuid(), 'TYPE', 'FEATURE_REQUEST', 'Demande d''évolution', 1, false),
    (gen_random_uuid(), 'TYPE', 'QUESTION', 'Question / Assistance', 2, true),
    (gen_random_uuid(), 'TYPE', 'MAJOR_INCIDENT', 'Incident majeur (crise)', 3, true),
    (gen_random_uuid(), 'COMPONENT', 'FRONTEND', 'Frontend', 0, false),
    (gen_random_uuid(), 'COMPONENT', 'API', 'API', 1, false),
    (gen_random_uuid(), 'COMPONENT', 'DATABASE', 'Base de données', 2, false),
    (gen_random_uuid(), 'COMPONENT', 'BILLING', 'Facturation', 3, false),
    (gen_random_uuid(), 'COMPONENT', 'AUTH', 'Authentification', 4, false),
    (gen_random_uuid(), 'COMPONENT', 'OTHER', 'Autre', 5, false),
    (gen_random_uuid(), 'ENVIRONMENT', 'PRODUCTION', 'Production', 0, false),
    (gen_random_uuid(), 'ENVIRONMENT', 'STAGING', 'Staging / Préprod', 1, false),
    (gen_random_uuid(), 'ENVIRONMENT', 'ACCEPTANCE', 'Recette', 2, false);

-- Conversion des colonnes en texte en conservant les valeurs existantes.
ALTER TABLE "Ticket" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Ticket" ALTER COLUMN "type" SET DATA TYPE TEXT USING "type"::TEXT;
ALTER TABLE "Ticket" ALTER COLUMN "type" SET DEFAULT 'QUESTION';
ALTER TABLE "Ticket" ALTER COLUMN "component" SET DATA TYPE TEXT USING "component"::TEXT;
ALTER TABLE "Ticket" ALTER COLUMN "environment" SET DATA TYPE TEXT USING "environment"::TEXT;

DROP TYPE "TicketType";
DROP TYPE "Component";
DROP TYPE "Environment";

-- Tags
CREATE TABLE "Tag" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

CREATE TABLE "TicketTag" (
    "ticketId" INTEGER NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "TicketTag_pkey" PRIMARY KEY ("ticketId","tagId")
);

CREATE INDEX "TicketTag_tagId_idx" ON "TicketTag"("tagId");

ALTER TABLE "TicketTag" ADD CONSTRAINT "TicketTag_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketTag" ADD CONSTRAINT "TicketTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Réglages globaux (les valeurs par défaut sont fournies par l'application si absentes)
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- Vues de la barre latérale
CREATE TABLE "View" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "View_pkey" PRIMARY KEY ("id")
);

INSERT INTO "View" ("id", "name", "filters", "position", "updatedAt") VALUES
    (gen_random_uuid(), 'Mes tickets ouverts', '{"status": "open", "assignee": "me"}', 0, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Non assignés', '{"status": "open", "assignee": "none"}', 1, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Incidents P0 / P1', '{"status": "open", "priority": ["P0", "P1"]}', 2, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'Tous les tickets ouverts', '{"status": "open"}', 3, CURRENT_TIMESTAMP);
