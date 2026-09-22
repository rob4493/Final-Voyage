ALTER TABLE "GameRooms" ADD COLUMN IF NOT EXISTS "IsPublic" boolean DEFAULT false NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_GameRooms_PublicLobby"
  ON "GameRooms" ("IsPublic", "Phase", "UpdatedAt");

