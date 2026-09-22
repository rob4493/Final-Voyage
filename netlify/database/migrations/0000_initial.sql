CREATE TABLE IF NOT EXISTS "GameRooms" (
  "RoomId" text PRIMARY KEY NOT NULL,
  "RoomCode" text NOT NULL,
  "HostPlayerId" text NOT NULL,
  "Phase" text DEFAULT 'Lobby' NOT NULL,
  "RoundNumber" integer DEFAULT 0 NOT NULL,
  "CrisisOrder" text DEFAULT '[]' NOT NULL,
  "CurrentCrisisId" integer,
  "WinningOption" integer,
  "ResultText" text,
  "Fuel" integer DEFAULT 6 NOT NULL,
  "Hull" integer DEFAULT 6 NOT NULL,
  "Supplies" integer DEFAULT 6 NOT NULL,
  "Morale" integer DEFAULT 6 NOT NULL,
  "Version" integer DEFAULT 0 NOT NULL,
  "CreatedAt" timestamp with time zone NOT NULL,
  "UpdatedAt" timestamp with time zone NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_GameRooms_RoomCode" ON "GameRooms" ("RoomCode");

CREATE TABLE IF NOT EXISTS "GamePlayers" (
  "PlayerId" text PRIMARY KEY NOT NULL,
  "RoomId" text NOT NULL,
  "PlayerName" text NOT NULL,
  "AgendaId" integer,
  "CurrentVote" integer,
  "MajorityVotes" integer DEFAULT 0 NOT NULL,
  "MinorityVotes" integer DEFAULT 0 NOT NULL,
  "JoinedAt" timestamp with time zone NOT NULL,
  "LastSeenAt" timestamp with time zone NOT NULL,
  CONSTRAINT "GamePlayers_RoomId_GameRooms_RoomId_fk"
    FOREIGN KEY ("RoomId") REFERENCES "GameRooms"("RoomId") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_GamePlayers_RoomName" ON "GamePlayers" ("RoomId", "PlayerName");

