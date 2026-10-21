ALTER TABLE "GameRooms"
  ADD COLUMN IF NOT EXISTS "VoteDeadlineAt" timestamp with time zone;
