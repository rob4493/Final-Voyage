import { integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const GameRooms = pgTable("GameRooms", {
  RoomId: text("RoomId").primaryKey(), RoomCode: text("RoomCode").notNull(),
  HostPlayerId: text("HostPlayerId").notNull(), Phase: text("Phase").notNull().default("Lobby"),
  RoundNumber: integer("RoundNumber").notNull().default(0), CrisisOrder: text("CrisisOrder").notNull().default("[]"),
  CurrentCrisisId: integer("CurrentCrisisId"), WinningOption: integer("WinningOption"), ResultText: text("ResultText"),
  Fuel: integer("Fuel").notNull().default(6), Hull: integer("Hull").notNull().default(6),
  Supplies: integer("Supplies").notNull().default(6), Morale: integer("Morale").notNull().default(6),
  Version: integer("Version").notNull().default(0),
  CreatedAt: timestamp("CreatedAt", { withTimezone: true }).notNull(), UpdatedAt: timestamp("UpdatedAt", { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex("idx_GameRooms_RoomCode").on(table.RoomCode)]);

export const GamePlayers = pgTable("GamePlayers", {
  PlayerId: text("PlayerId").primaryKey(), RoomId: text("RoomId").notNull(), PlayerName: text("PlayerName").notNull(),
  AgendaId: integer("AgendaId"), CurrentVote: integer("CurrentVote"),
  MajorityVotes: integer("MajorityVotes").notNull().default(0), MinorityVotes: integer("MinorityVotes").notNull().default(0),
  JoinedAt: timestamp("JoinedAt", { withTimezone: true }).notNull(), LastSeenAt: timestamp("LastSeenAt", { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex("idx_GamePlayers_RoomName").on(table.RoomId, table.PlayerName)]);
