CREATE TABLE IF NOT EXISTS "GameMessages" (
  "GameMessageId" text PRIMARY KEY NOT NULL,
  "RoomId" text NOT NULL,
  "PlayerId" text,
  "PlayerName" text NOT NULL,
  "MessageText" text NOT NULL,
  "MessageType" text DEFAULT 'Player' NOT NULL,
  "CreatedAt" timestamp with time zone NOT NULL,
  CONSTRAINT "GameMessages_RoomId_GameRooms_RoomId_fk"
    FOREIGN KEY ("RoomId") REFERENCES "GameRooms"("RoomId") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_GameMessages_RoomCreated"
  ON "GameMessages" ("RoomId", "CreatedAt");
