ALTER TABLE "GamePlayers"
  ADD COLUMN IF NOT EXISTS "IsComputer" boolean DEFAULT false NOT NULL;

ALTER TABLE "GamePlayers"
  ADD COLUMN IF NOT EXISTS "ComputerRole" text;
