ALTER TABLE "GameRooms"
  ADD COLUMN IF NOT EXISTS "ComputerTurnAt" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "GameReports" (
  "GameReportId" text PRIMARY KEY NOT NULL,
  "RoomId" text NOT NULL,
  "ReporterPlayerId" text NOT NULL,
  "ReportedPlayerId" text NOT NULL,
  "Reason" text NOT NULL,
  "CreatedAt" timestamp with time zone NOT NULL,
  CONSTRAINT "GameReports_RoomId_GameRooms_RoomId_fk"
    FOREIGN KEY ("RoomId") REFERENCES "GameRooms"("RoomId") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_GameReports_ReporterReported"
  ON "GameReports" ("RoomId", "ReporterPlayerId", "ReportedPlayerId");

CREATE INDEX IF NOT EXISTS "idx_GameReports_RoomReported"
  ON "GameReports" ("RoomId", "ReportedPlayerId");
