ALTER TABLE "GameRooms"
  ADD COLUMN IF NOT EXISTS "Difficulty" text DEFAULT 'Standard' NOT NULL;

ALTER TABLE "GameRooms"
  ADD COLUMN IF NOT EXISTS "AiAllowed" boolean DEFAULT true NOT NULL;

ALTER TABLE "GamePlayers"
  ADD COLUMN IF NOT EXISTS "IsReady" boolean DEFAULT false NOT NULL;

UPDATE "GamePlayers"
SET "IsReady" = true
WHERE "IsComputer" = true;
