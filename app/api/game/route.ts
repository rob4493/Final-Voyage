import { and, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { GameMessages, GamePlayers, GameReports, GameRooms } from "../../../db/schema";
import { Agendas, Crises, agendaComplete, type ResourceKey } from "../../../lib/game-data";

export const dynamic = "force-dynamic";
const resourceKeys: ResourceKey[] = ["Fuel", "Hull", "Supplies", "Morale"];
const MESSAGE_LIMIT = 500;
const MESSAGE_COOLDOWN_MS = 2000;
const COMPUTER_VOTE_DELAY_MS = 1800;
const ACTIVE_THRESHOLD_MS = 8000;
const HOST_MANAGE_THRESHOLD_MS = 30000;
const RECONNECT_GRACE_MS = 30000;
const AUTO_REPLACE_MS = 60000;
const VOTING_TIME_MS = 45000;
const computerCrew = [
  { Role: "Navigator", Name: "NOVA", AgendaId: 0, Resource: "Fuel" as ResourceKey },
  { Role: "Engineer", Name: "AXIOM", AgendaId: 1, Resource: "Hull" as ResourceKey },
  { Role: "Quartermaster", Name: "CARGO", AgendaId: 2, Resource: "Supplies" as ResourceKey },
  { Role: "Counselor", Name: "ECHO", AgendaId: 3, Resource: "Morale" as ResourceKey },
  { Role: "Wildcard", Name: "GLITCH", AgendaId: 11, Resource: null },
] as const;
const blockedWords = ["fuck", "shit", "bitch", "cunt", "nigger", "nigga", "faggot", "retard", "whore", "slut", "kike", "chink", "spic"];

function filterMessage(message: string) {
  const compact = message.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/(.)\1{7,}/gi, "$1$1$1");
  return blockedWords.reduce((clean, word) => clean.replace(new RegExp(`\\b${word}\\b`, "gi"), "*".repeat(word.length)), compact);
}

async function addSystemMessage(db: ReturnType<typeof getDb>, RoomId: string, MessageText: string) {
  await db.insert(GameMessages).values({ GameMessageId: crypto.randomUUID(), RoomId, PlayerName: "Ship Computer", MessageText, MessageType: "System", CreatedAt: new Date() });
}

function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function clamp(value: number) { return Math.max(0, Math.min(10, value)); }

function chooseComputerVote(room: typeof GameRooms.$inferSelect, player: typeof GamePlayers.$inferSelect) {
  const crisis = Crises.find((item) => item.Id === room.CurrentCrisisId);
  if (!crisis) return 0;
  const personality = computerCrew.find((item) => item.Role === player.ComputerRole);
  const current = { Fuel: room.Fuel, Hull: room.Hull, Supplies: room.Supplies, Morale: room.Morale };
  const scored = crisis.Options.map((choice, Option) => {
    const projected = resourceKeys.map((key) => clamp(current[key] + (choice.Effect[key] ?? 0)));
    const fatalPenalty = projected.some((value) => value <= 0) ? -1000 : 0;
    const dangerPenalty = projected.reduce((total, value) => total + (value <= 2 ? -18 : value <= 3 ? -6 : 0), 0);
    const balanceScore = Math.min(...projected) * 4 + projected.reduce((total, value) => total + value, 0);
    const priorityScore = personality?.Resource ? (choice.Effect[personality.Resource] ?? 0) * 7 + projected[resourceKeys.indexOf(personality.Resource)] * 2 : Math.random() * 14;
    return { Option, Score: fatalPenalty + dangerPenalty + balanceScore + priorityScore + Math.random() * 3 };
  });
  return scored.sort((a, b) => b.Score - a.Score)[0].Option;
}

function explainComputerVote(room: typeof GameRooms.$inferSelect, player: typeof GamePlayers.$inferSelect, Option: number) {
  const crisis = Crises.find((item) => item.Id === room.CurrentCrisisId);
  const personality = computerCrew.find((item) => item.Role === player.ComputerRole);
  if (!crisis) return "selected the safest available response.";
  if (!personality?.Resource) return player.ComputerRole === "Wildcard" ? "balanced ship survival with a less predictable route." : "selected the option with the safest overall resource balance.";
  const change = crisis.Options[Option].Effect[personality.Resource] ?? 0;
  if (change > 0) return `prioritized restoring ${personality.Resource} while keeping the ship viable.`;
  if (change === 0) return `protected ${personality.Resource} from further loss without risking a critical system.`;
  return `accepted a ${personality.Resource} cost to prevent greater danger elsewhere on the ship.`;
}

async function resolveVotes(db: ReturnType<typeof getDb>, room: typeof GameRooms.$inferSelect, voted: (typeof GamePlayers.$inferSelect)[]) {
  const counts = [0, 0, 0];
  voted.forEach((p) => { if (p.CurrentVote !== null) counts[p.CurrentVote]++; });
  const maxVotes = Math.max(...counts);
  const tied = counts.map((count, i) => count === maxVotes ? i : -1).filter((i) => i >= 0);
  const hostVote = voted.find((p) => p.PlayerId === room.HostPlayerId)?.CurrentVote ?? tied[0];
  const winner = tied.includes(hostVote) ? hostVote : tied[0];
  const crisis = Crises.find((c) => c.Id === room.CurrentCrisisId)!;
  const selected = crisis.Options[winner];
  const next = { Fuel: room.Fuel, Hull: room.Hull, Supplies: room.Supplies, Morale: room.Morale };
  resourceKeys.forEach((key) => { next[key] = clamp(next[key] + (selected.Effect[key] ?? 0)); });
  const [claimed] = await db.update(GameRooms).set({ ...next, Phase: "Result", WinningOption: winner, ResultText: `${selected.Title} carried the vote. ${selected.Detail}`, VoteDeadlineAt: null, ComputerTurnAt: null, Version: room.Version + 1, UpdatedAt: new Date() }).where(and(eq(GameRooms.RoomId, room.RoomId), eq(GameRooms.Phase, "Voting"))).returning({ RoomId: GameRooms.RoomId });
  if (!claimed) return;
  for (const p of voted) {
    await db.update(GamePlayers).set({ MajorityVotes: p.MajorityVotes + (p.CurrentVote === winner ? 1 : 0), MinorityVotes: p.MinorityVotes + (p.CurrentVote !== winner ? 1 : 0) }).where(eq(GamePlayers.PlayerId, p.PlayerId));
  }
}

async function replaceWithComputer(db: ReturnType<typeof getDb>, room: typeof GameRooms.$inferSelect, player: typeof GamePlayers.$inferSelect, players: (typeof GamePlayers.$inferSelect)[], Reason: "Disconnected" | "Removed" = "Disconnected") {
  const usedNames = new Set(players.map((item) => item.PlayerName.toLowerCase()));
  let PlayerName = "DRIFT";
  for (let suffix = 2; usedNames.has(PlayerName.toLowerCase()); suffix++) PlayerName = `DRIFT ${suffix}`;
  const now = new Date();
  const replacement = { ...player, PlayerId: crypto.randomUUID(), PlayerName, IsComputer: true, ComputerRole: "Emergency", LastSeenAt: now, CurrentVote: player.CurrentVote };
  if (room.Phase === "Voting" && replacement.CurrentVote === null) replacement.CurrentVote = chooseComputerVote(room, replacement);
  await db.insert(GamePlayers).values({ PlayerId: replacement.PlayerId, RoomId: room.RoomId, PlayerName: replacement.PlayerName, IsComputer: true, ComputerRole: replacement.ComputerRole, IsReady: true, AgendaId: replacement.AgendaId, CurrentVote: replacement.CurrentVote, MajorityVotes: replacement.MajorityVotes, MinorityVotes: replacement.MinorityVotes, JoinedAt: replacement.JoinedAt, LastSeenAt: now });
  await db.delete(GamePlayers).where(eq(GamePlayers.PlayerId, player.PlayerId));
  if (room.HostPlayerId === player.PlayerId) {
    const nextHost = players.filter((item) => item.PlayerId !== player.PlayerId && !item.IsComputer && now.getTime() - item.LastSeenAt.getTime() < RECONNECT_GRACE_MS).sort((a, b) => a.JoinedAt.getTime() - b.JoinedAt.getTime())[0];
    if (nextHost) await db.update(GameRooms).set({ HostPlayerId: nextHost.PlayerId, Version: room.Version + 1, UpdatedAt: now }).where(eq(GameRooms.RoomId, room.RoomId));
  }
  await addSystemMessage(db, room.RoomId, `${player.PlayerName} ${Reason === "Removed" ? "was removed by the captain" : "did not reconnect"}. ${PlayerName} has taken over as AI crew.${room.HostPlayerId === player.PlayerId ? " Captain controls were transferred." : ""}`);
}

async function state(RoomCode: string, PlayerId: string) {
  const db = getDb();
  let [room] = await db.select().from(GameRooms).where(eq(GameRooms.RoomCode, RoomCode)).limit(1);
  if (!room) return null;
  let players = await db.select().from(GamePlayers).where(eq(GamePlayers.RoomId, room.RoomId));
  const me = players.find((p) => p.PlayerId === PlayerId);
  if (!me || me.IsComputer) return null;
  const now = new Date();
  await db.update(GamePlayers).set({ LastSeenAt: now }).where(eq(GamePlayers.PlayerId, PlayerId));
  players = players.map((player) => player.PlayerId === PlayerId ? { ...player, LastSeenAt: now } : player);
  if (room.Phase !== "Lobby" && room.Phase !== "GameOver") {
    const expiredPlayers = players.filter((player) => !player.IsComputer && player.PlayerId !== PlayerId && now.getTime() - player.LastSeenAt.getTime() >= AUTO_REPLACE_MS);
    for (const expired of expiredPlayers) {
      await replaceWithComputer(db, room, expired, players);
      players = players.filter((player) => player.PlayerId !== expired.PlayerId);
    }
    if (expiredPlayers.length > 0) {
      [room] = await db.select().from(GameRooms).where(eq(GameRooms.RoomId, room.RoomId)).limit(1);
      players = await db.select().from(GamePlayers).where(eq(GamePlayers.RoomId, room.RoomId));
    }
  }
  if (room.Phase === "Voting" && room.VoteDeadlineAt && now.getTime() >= room.VoteDeadlineAt.getTime()) {
    const missingVotes = players.filter((player) => player.CurrentVote === null);
    for (const player of missingVotes) {
      await db.update(GamePlayers).set({ CurrentVote: chooseComputerVote(room, player) }).where(and(eq(GamePlayers.PlayerId, player.PlayerId), isNull(GamePlayers.CurrentVote)));
    }
    if (missingVotes.length > 0) await addSystemMessage(db, room.RoomId, `Voting time expired. The ship computer cast ${missingVotes.length} safety ${missingVotes.length === 1 ? "vote" : "votes"}.`);
    players = await db.select().from(GamePlayers).where(eq(GamePlayers.RoomId, room.RoomId));
    if (players.every((player) => player.CurrentVote !== null)) {
      await resolveVotes(db, room, players);
      [room] = await db.select().from(GameRooms).where(eq(GameRooms.RoomId, room.RoomId)).limit(1);
      players = await db.select().from(GamePlayers).where(eq(GamePlayers.RoomId, room.RoomId));
    }
  }
  const crisis = Crises.find((item) => item.Id === room.CurrentCrisisId) ?? null;
  const ended = room.Phase === "GameOver";
  const resourceState = { Fuel: room.Fuel, Hull: room.Hull, Supplies: room.Supplies, Morale: room.Morale };
  const recentMessages = await db.select().from(GameMessages).where(eq(GameMessages.RoomId, room.RoomId)).orderBy(desc(GameMessages.CreatedAt)).limit(50);
  const reports = await db.select().from(GameReports).where(eq(GameReports.RoomId, room.RoomId));
  return {
    Room: { RoomCode: room.RoomCode, Phase: room.Phase, RoundNumber: room.RoundNumber, Difficulty: room.Difficulty, AiAllowed: room.AiAllowed, Fuel: room.Fuel, Hull: room.Hull, Supplies: room.Supplies, Morale: room.Morale, WinningOption: room.WinningOption, ResultText: room.ResultText, VoteDeadlineAt: room.VoteDeadlineAt, ComputerTurnAt: room.ComputerTurnAt, Version: room.Version },
    Me: { PlayerId: me.PlayerId, PlayerName: me.PlayerName, IsHost: room.HostPlayerId === me.PlayerId, IsReady: me.IsReady, HasVoted: me.CurrentVote !== null, Vote: me.CurrentVote, Agenda: me.AgendaId === null ? null : Agendas[me.AgendaId] },
    Players: players.sort((a, b) => a.JoinedAt.getTime() - b.JoinedAt.getTime()).map((p) => ({
      PlayerId: p.PlayerId, PlayerName: p.PlayerName, IsHost: p.PlayerId === room.HostPlayerId, IsComputer: p.IsComputer, ComputerRole: p.ComputerRole, IsReady: p.IsComputer || p.IsReady, HasVoted: p.CurrentVote !== null,
      IsActive: p.IsComputer || now.getTime() - p.LastSeenAt.getTime() <= ACTIVE_THRESHOLD_MS,
      DisconnectedSeconds: p.IsComputer ? 0 : Math.max(0, Math.floor((now.getTime() - p.LastSeenAt.getTime()) / 1000)),
      GraceSecondsRemaining: p.IsComputer ? 0 : Math.max(0, Math.ceil((RECONNECT_GRACE_MS - (now.getTime() - p.LastSeenAt.getTime())) / 1000)),
      ReportCount: room.HostPlayerId === me.PlayerId ? reports.filter((report) => report.ReportedPlayerId === p.PlayerId).length : 0,
      HasReported: reports.some((report) => report.ReporterPlayerId === me.PlayerId && report.ReportedPlayerId === p.PlayerId),
      ...(ended ? { Agenda: p.AgendaId === null ? null : Agendas[p.AgendaId], AgendaComplete: agendaComplete(p.AgendaId, resourceState), Score: (resourceKeys.every((k) => resourceState[k] > 0) ? 10 : 0) + (agendaComplete(p.AgendaId, resourceState) ? 5 : 0) + resourceKeys.filter((k) => resourceState[k] > 0).length } : {}),
    })),
    Crisis: crisis,
    Messages: recentMessages.reverse().map((message) => ({ GameMessageId: message.GameMessageId, PlayerId: message.PlayerId, PlayerName: message.PlayerName, MessageText: message.MessageText, MessageType: message.MessageType, CreatedAt: message.CreatedAt })),
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("Public") === "true") {
      const db = getDb();
      const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const rooms = await db.select().from(GameRooms).where(and(eq(GameRooms.IsPublic, true), eq(GameRooms.Phase, "Lobby"), gt(GameRooms.UpdatedAt, cutoff))).orderBy(desc(GameRooms.UpdatedAt)).limit(20);
      const lobbies = [];
      for (const room of rooms) {
        const players = await db.select().from(GamePlayers).where(eq(GamePlayers.RoomId, room.RoomId));
        if (players.length >= 5) continue;
        const host = players.find((player) => player.PlayerId === room.HostPlayerId);
        if (!host) continue;
        const humans = players.filter((player) => !player.IsComputer);
        const computers = players.filter((player) => player.IsComputer);
        lobbies.push({ RoomCode: room.RoomCode, HostName: host.PlayerName, PlayerCount: players.length, HumanCount: humans.length, ComputerCount: computers.length, ReadyHumanCount: humans.filter((player) => player.IsReady).length, OpenSeats: 5 - players.length, Difficulty: room.Difficulty, AiAllowed: room.AiAllowed, AgeMinutes: Math.max(0, Math.floor((Date.now() - room.CreatedAt.getTime()) / 60000)), UpdatedAt: room.UpdatedAt });
      }
      return Response.json({ Lobbies: lobbies });
    }
    const RoomCode = (url.searchParams.get("RoomCode") ?? "").toUpperCase();
    const PlayerId = url.searchParams.get("PlayerId") ?? "";
    const game = await state(RoomCode, PlayerId);
    return game ? Response.json(game) : Response.json({ Error: "Room or player not found." }, { status: 404 });
  } catch (error) {
    return Response.json({ Error: error instanceof Error ? error.message : "Game state unavailable." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { Action?: string; PlayerName?: string; RoomCode?: string; PlayerId?: string; Option?: number; IsPublic?: boolean; MessageText?: string; ComputerRole?: string; ComputerPlayerId?: string; TargetPlayerId?: string; Difficulty?: string; AiAllowed?: boolean };
    const Action = body.Action ?? "";
    const PlayerName = (body.PlayerName ?? "").trim().slice(0, 20);
    const RoomCode = (body.RoomCode ?? "").trim().toUpperCase();
    const PlayerId = body.PlayerId ?? "";
    const db = getDb();

    if (Action === "Create") {
      if (PlayerName.length < 2) return Response.json({ Error: "Enter a name with at least 2 characters." }, { status: 400 });
      const RoomId = crypto.randomUUID();
      const NewPlayerId = crypto.randomUUID();
      let NewCode = code();
      for (let attempt = 0; attempt < 5; attempt++) {
        const [taken] = await db.select({ RoomId: GameRooms.RoomId }).from(GameRooms).where(eq(GameRooms.RoomCode, NewCode)).limit(1);
        if (!taken) break;
        NewCode = code();
      }
      const now = new Date();
      await db.insert(GameRooms).values({ RoomId, RoomCode: NewCode, HostPlayerId: NewPlayerId, IsPublic: body.IsPublic === true, CreatedAt: now, UpdatedAt: now });
      await db.insert(GamePlayers).values({ PlayerId: NewPlayerId, RoomId, PlayerName, JoinedAt: now, LastSeenAt: now });
      return Response.json({ RoomCode: NewCode, PlayerId: NewPlayerId }, { status: 201 });
    }

    if (Action === "Join") {
      if (PlayerName.length < 2) return Response.json({ Error: "Enter a name with at least 2 characters." }, { status: 400 });
      const [room] = await db.select().from(GameRooms).where(eq(GameRooms.RoomCode, RoomCode)).limit(1);
      if (!room) return Response.json({ Error: "That room code does not exist." }, { status: 404 });
      if (room.Phase !== "Lobby") return Response.json({ Error: "That voyage has already launched." }, { status: 409 });
      const players = await db.select().from(GamePlayers).where(eq(GamePlayers.RoomId, room.RoomId));
      if (players.length >= 5) return Response.json({ Error: "This crew is already full. Final Voyage supports up to 5 players." }, { status: 409 });
      if (players.some((p) => p.PlayerName.toLowerCase() === PlayerName.toLowerCase())) return Response.json({ Error: "That name is already in this room." }, { status: 409 });
      const NewPlayerId = crypto.randomUUID();
      const now = new Date();
      await db.insert(GamePlayers).values({ PlayerId: NewPlayerId, RoomId: room.RoomId, PlayerName, JoinedAt: now, LastSeenAt: now });
      await addSystemMessage(db, room.RoomId, `${PlayerName} joined the crew.`);
      await db.update(GameRooms).set({ UpdatedAt: now, Version: room.Version + 1 }).where(eq(GameRooms.RoomId, room.RoomId));
      return Response.json({ RoomCode, PlayerId: NewPlayerId }, { status: 201 });
    }

    const [room] = await db.select().from(GameRooms).where(eq(GameRooms.RoomCode, RoomCode)).limit(1);
    if (!room) return Response.json({ Error: "Room not found." }, { status: 404 });
    const players = await db.select().from(GamePlayers).where(eq(GamePlayers.RoomId, room.RoomId));
    const me = players.find((p) => p.PlayerId === PlayerId);
    if (!me) return Response.json({ Error: "Player not found." }, { status: 404 });
    const IsHost = room.HostPlayerId === PlayerId;

    if (Action === "ProcessComputerTurns") {
      if (room.Phase !== "Voting" || !room.ComputerTurnAt) return Response.json(await state(RoomCode, PlayerId));
      if (Date.now() < room.ComputerTurnAt.getTime()) return Response.json({ Error: "AI crew are still evaluating the crisis." }, { status: 409 });
      const computers = players.filter((player) => player.IsComputer && player.CurrentVote === null);
      for (const computer of computers) {
        const Option = chooseComputerVote(room, computer);
        const [claimed] = await db.update(GamePlayers).set({ CurrentVote: Option, LastSeenAt: new Date() }).where(and(eq(GamePlayers.PlayerId, computer.PlayerId), isNull(GamePlayers.CurrentVote))).returning({ PlayerId: GamePlayers.PlayerId });
        if (claimed) await addSystemMessage(db, room.RoomId, `${computer.PlayerName} ${explainComputerVote(room, computer, Option)}`);
      }
      await db.update(GameRooms).set({ ComputerTurnAt: null, Version: room.Version + 1 }).where(eq(GameRooms.RoomId, room.RoomId));
      const updatedPlayers = await db.select().from(GamePlayers).where(eq(GamePlayers.RoomId, room.RoomId));
      if (updatedPlayers.every((player) => player.CurrentVote !== null)) await resolveVotes(db, room, updatedPlayers);
      return Response.json(await state(RoomCode, PlayerId));
    }

    if (Action === "ReportPlayer") {
      const target = players.find((player) => player.PlayerId === body.TargetPlayerId && !player.IsComputer && player.PlayerId !== PlayerId);
      if (!target) return Response.json({ Error: "That player cannot be reported." }, { status: 400 });
      const [existing] = await db.select().from(GameReports).where(and(eq(GameReports.RoomId, room.RoomId), eq(GameReports.ReporterPlayerId, PlayerId), eq(GameReports.ReportedPlayerId, target.PlayerId))).limit(1);
      if (existing) return Response.json({ Error: "You already reported this player in this room." }, { status: 409 });
      await db.insert(GameReports).values({ GameReportId: crypto.randomUUID(), RoomId: room.RoomId, ReporterPlayerId: PlayerId, ReportedPlayerId: target.PlayerId, Reason: "Inappropriate chat or conduct", CreatedAt: new Date() });
      return Response.json(await state(RoomCode, PlayerId));
    }

    if (Action === "RemovePlayer") {
      if (!IsHost) return Response.json({ Error: "Only the captain can remove a player." }, { status: 403 });
      const target = players.find((player) => player.PlayerId === body.TargetPlayerId && !player.IsComputer && player.PlayerId !== PlayerId);
      if (!target) return Response.json({ Error: "That player cannot be removed." }, { status: 400 });
      if (room.Phase === "Lobby") {
        await db.delete(GamePlayers).where(eq(GamePlayers.PlayerId, target.PlayerId));
        await addSystemMessage(db, room.RoomId, `${target.PlayerName} was removed by the captain.`);
      } else if (room.Phase !== "GameOver") await replaceWithComputer(db, room, target, players, "Removed");
      else return Response.json({ Error: "The voyage has already ended." }, { status: 409 });
      await db.update(GameRooms).set({ Version: room.Version + 1, UpdatedAt: new Date() }).where(eq(GameRooms.RoomId, room.RoomId));
      return Response.json(await state(RoomCode, PlayerId));
    }

    if (Action === "ToggleReady") {
      if (room.Phase !== "Lobby" || me.IsComputer) return Response.json({ Error: "Ready status can only be changed by human players in the lobby." }, { status: 409 });
      await db.update(GamePlayers).set({ IsReady: !me.IsReady, LastSeenAt: new Date() }).where(eq(GamePlayers.PlayerId, PlayerId));
      await db.update(GameRooms).set({ Version: room.Version + 1, UpdatedAt: new Date() }).where(eq(GameRooms.RoomId, room.RoomId));
      return Response.json(await state(RoomCode, PlayerId));
    }

    if (Action === "UpdateLobbySettings") {
      if (!IsHost || room.Phase !== "Lobby") return Response.json({ Error: "Only the captain can update lobby settings." }, { status: 403 });
      const Difficulty = body.Difficulty ?? room.Difficulty;
      if (!["Easy", "Standard", "Hard"].includes(Difficulty)) return Response.json({ Error: "Choose Easy, Standard, or Hard difficulty." }, { status: 400 });
      const AiAllowed = typeof body.AiAllowed === "boolean" ? body.AiAllowed : room.AiAllowed;
      if (!AiAllowed && players.some((player) => player.IsComputer)) return Response.json({ Error: "Remove AI crew before switching to humans only." }, { status: 409 });
      const settingsChanged = Difficulty !== room.Difficulty || AiAllowed !== room.AiAllowed;
      if (settingsChanged) {
        for (const player of players.filter((item) => !item.IsComputer)) await db.update(GamePlayers).set({ IsReady: false }).where(eq(GamePlayers.PlayerId, player.PlayerId));
      }
      await db.update(GameRooms).set({ Difficulty, AiAllowed, Version: room.Version + 1, UpdatedAt: new Date() }).where(eq(GameRooms.RoomId, room.RoomId));
      if (settingsChanged) await addSystemMessage(db, room.RoomId, `Lobby settings changed: ${Difficulty} difficulty, ${AiAllowed ? "AI allowed" : "humans only"}. Human crew must ready up again.`);
      return Response.json(await state(RoomCode, PlayerId));
    }

    if (Action === "ManageDisconnected") {
      if (!IsHost) return Response.json({ Error: "Only the captain can manage disconnected crew." }, { status: 403 });
      const target = players.find((player) => player.PlayerId === body.TargetPlayerId && !player.IsComputer && player.PlayerId !== PlayerId);
      if (!target) return Response.json({ Error: "Disconnected crew member not found." }, { status: 404 });
      if (Date.now() - target.LastSeenAt.getTime() < HOST_MANAGE_THRESHOLD_MS) return Response.json({ Error: "That player is still within the reconnection window." }, { status: 409 });
      if (room.Phase === "Lobby") {
        await db.delete(GamePlayers).where(eq(GamePlayers.PlayerId, target.PlayerId));
        await db.update(GameRooms).set({ Version: room.Version + 1, UpdatedAt: new Date() }).where(eq(GameRooms.RoomId, room.RoomId));
        await addSystemMessage(db, room.RoomId, `${target.PlayerName} was removed after disconnecting.`);
      } else if (room.Phase !== "GameOver") {
        await replaceWithComputer(db, room, target, players);
      } else return Response.json({ Error: "The voyage has already ended." }, { status: 409 });
      return Response.json(await state(RoomCode, PlayerId));
    }

    if (Action === "AddComputer") {
      if (!IsHost || room.Phase !== "Lobby") return Response.json({ Error: "Only the captain can add AI crew before launch." }, { status: 403 });
      if (!room.AiAllowed) return Response.json({ Error: "This lobby is set to humans only." }, { status: 409 });
      if (players.length >= 5) return Response.json({ Error: "This crew is already full." }, { status: 409 });
      const personality = computerCrew.find((item) => item.Role === body.ComputerRole);
      if (!personality) return Response.json({ Error: "Choose a valid AI crew personality." }, { status: 400 });
      if (players.some((player) => player.IsComputer && player.ComputerRole === personality.Role)) return Response.json({ Error: `${personality.Role} is already assigned to this crew.` }, { status: 409 });
      const now = new Date();
      await db.insert(GamePlayers).values({ PlayerId: crypto.randomUUID(), RoomId: room.RoomId, PlayerName: personality.Name, IsComputer: true, ComputerRole: personality.Role, IsReady: true, JoinedAt: now, LastSeenAt: now });
      await db.update(GameRooms).set({ UpdatedAt: now, Version: room.Version + 1 }).where(eq(GameRooms.RoomId, room.RoomId));
      await addSystemMessage(db, room.RoomId, `${personality.Name}, the AI ${personality.Role}, joined the crew.`);
      return Response.json(await state(RoomCode, PlayerId));
    }

    if (Action === "RemoveComputer") {
      if (!IsHost || room.Phase !== "Lobby") return Response.json({ Error: "Only the captain can remove AI crew before launch." }, { status: 403 });
      const computer = players.find((player) => player.PlayerId === body.ComputerPlayerId && player.IsComputer);
      if (!computer) return Response.json({ Error: "AI crew member not found." }, { status: 404 });
      await db.delete(GamePlayers).where(eq(GamePlayers.PlayerId, computer.PlayerId));
      await db.update(GameRooms).set({ UpdatedAt: new Date(), Version: room.Version + 1 }).where(eq(GameRooms.RoomId, room.RoomId));
      await addSystemMessage(db, room.RoomId, `${computer.PlayerName} was removed from the crew.`);
      return Response.json(await state(RoomCode, PlayerId));
    }

    if (Action === "SendMessage") {
      const rawMessage = (body.MessageText ?? "").trim();
      if (!rawMessage) return Response.json({ Error: "Enter a message before sending." }, { status: 400 });
      if (rawMessage.length > MESSAGE_LIMIT) return Response.json({ Error: `Messages can be up to ${MESSAGE_LIMIT} characters.` }, { status: 400 });
      if ((rawMessage.match(/https?:\/\//gi) ?? []).length > 1) return Response.json({ Error: "Only one link is allowed per message." }, { status: 400 });
      const recent = await db.select().from(GameMessages).where(and(eq(GameMessages.RoomId, room.RoomId), eq(GameMessages.PlayerId, PlayerId))).orderBy(desc(GameMessages.CreatedAt)).limit(5);
      const latest = recent[0];
      if (latest && Date.now() - latest.CreatedAt.getTime() < MESSAGE_COOLDOWN_MS) return Response.json({ Error: "Please wait a moment before sending another message." }, { status: 429 });
      if (latest && latest.MessageText.trim().toLowerCase() === rawMessage.toLowerCase()) return Response.json({ Error: "Please do not repeat the same message." }, { status: 429 });
      if (recent.length >= 5 && Date.now() - recent[4].CreatedAt.getTime() < 20000) return Response.json({ Error: "You are sending messages too quickly. Please pause before continuing." }, { status: 429 });
      const now = new Date();
      await db.insert(GameMessages).values({ GameMessageId: crypto.randomUUID(), RoomId: room.RoomId, PlayerId, PlayerName: me.PlayerName, MessageText: filterMessage(rawMessage), MessageType: "Player", CreatedAt: now });
      await db.update(GamePlayers).set({ LastSeenAt: now }).where(eq(GamePlayers.PlayerId, PlayerId));
      return Response.json(await state(RoomCode, PlayerId));
    }

    if (Action === "Start") {
      if (!IsHost) return Response.json({ Error: "Only the captain can launch." }, { status: 403 });
      if (room.Phase !== "Lobby") return Response.json({ Error: "The voyage has already started." }, { status: 409 });
      if (players.length < 3) return Response.json({ Error: "At least 3 crew members are required." }, { status: 400 });
      if (players.filter((player) => player.IsComputer || Date.now() - player.LastSeenAt.getTime() <= ACTIVE_THRESHOLD_MS).length < 3) return Response.json({ Error: "At least 3 active crew members are required to launch." }, { status: 400 });
      if (players.some((player) => !player.IsComputer && !player.IsReady)) return Response.json({ Error: "Every human crew member must be ready before launch." }, { status: 409 });
      const crisisOrder = shuffle(Crises.map((c) => c.Id)).slice(0, 6);
      const agendaOrder = shuffle(Agendas.map((_, i) => i));
      const now = new Date();
      let humanAgendaIndex = 0;
      for (const player of players) {
        const personality = player.IsComputer ? computerCrew.find((item) => item.Role === player.ComputerRole) : null;
        const AgendaId = personality?.AgendaId ?? agendaOrder[humanAgendaIndex++ % agendaOrder.length];
        await db.update(GamePlayers).set({ AgendaId, CurrentVote: null, MajorityVotes: 0, MinorityVotes: 0 }).where(eq(GamePlayers.PlayerId, player.PlayerId));
      }
      const startingResource = room.Difficulty === "Easy" ? 8 : room.Difficulty === "Hard" ? 5 : 6;
      await db.update(GameRooms).set({ Phase: "Voting", RoundNumber: 1, CrisisOrder: JSON.stringify(crisisOrder), CurrentCrisisId: crisisOrder[0], WinningOption: null, ResultText: null, VoteDeadlineAt: new Date(now.getTime() + VOTING_TIME_MS), ComputerTurnAt: new Date(now.getTime() + COMPUTER_VOTE_DELAY_MS), Fuel: startingResource, Hull: startingResource, Supplies: startingResource, Morale: startingResource, Version: room.Version + 1, UpdatedAt: now }).where(eq(GameRooms.RoomId, room.RoomId));
      await addSystemMessage(db, room.RoomId, "The voyage has launched. Good luck, crew.");
    }

    if (Action === "Vote") {
      const Option = Number(body.Option);
      if (room.Phase !== "Voting" || ![0, 1, 2].includes(Option)) return Response.json({ Error: "That vote is not available." }, { status: 409 });
      if (room.VoteDeadlineAt && Date.now() >= room.VoteDeadlineAt.getTime()) return Response.json({ Error: "Voting time has expired. The ship computer is finalizing the round." }, { status: 409 });
      if (me.IsComputer) return Response.json({ Error: "AI crew votes automatically." }, { status: 403 });
      await db.update(GamePlayers).set({ CurrentVote: Option, LastSeenAt: new Date() }).where(eq(GamePlayers.PlayerId, PlayerId));
      const voted = await db.select().from(GamePlayers).where(and(eq(GamePlayers.RoomId, room.RoomId), isNotNull(GamePlayers.CurrentVote)));
      if (voted.length === players.length) await resolveVotes(db, room, voted);
    }

    if (Action === "CloseLobby") {
      if (!IsHost || room.Phase !== "Lobby") return Response.json({ Error: "Only the captain can close an open lobby." }, { status: 403 });
      await db.delete(GameMessages).where(eq(GameMessages.RoomId, room.RoomId));
      await db.delete(GameReports).where(eq(GameReports.RoomId, room.RoomId));
      await db.delete(GamePlayers).where(eq(GamePlayers.RoomId, room.RoomId));
      await db.delete(GameRooms).where(eq(GameRooms.RoomId, room.RoomId));
      return Response.json({ Closed: true });
    }

    if (Action === "LeaveGame") {
      const remaining = players.filter((p) => p.PlayerId !== PlayerId);
      const remainingHumans = remaining.filter((player) => !player.IsComputer);
      if (remainingHumans.length === 0) {
        await db.delete(GameMessages).where(eq(GameMessages.RoomId, room.RoomId));
        await db.delete(GameReports).where(eq(GameReports.RoomId, room.RoomId));
        await db.delete(GamePlayers).where(eq(GamePlayers.RoomId, room.RoomId));
        await db.delete(GameRooms).where(eq(GameRooms.RoomId, room.RoomId));
        return Response.json({ Left: true });
      }
      const NewHostPlayerId = IsHost ? remainingHumans.sort((a, b) => a.JoinedAt.getTime() - b.JoinedAt.getTime())[0].PlayerId : room.HostPlayerId;
      await db.delete(GamePlayers).where(eq(GamePlayers.PlayerId, PlayerId));
      await db.update(GameRooms).set({ HostPlayerId: NewHostPlayerId, Version: room.Version + 1, UpdatedAt: new Date() }).where(eq(GameRooms.RoomId, room.RoomId));
      await addSystemMessage(db, room.RoomId, `${me.PlayerName} left the crew.${IsHost ? ` ${remaining.find((player) => player.PlayerId === NewHostPlayerId)?.PlayerName ?? "A crew member"} is now captain.` : ""}`);
      if (room.Phase === "Voting" && remaining.every((p) => p.CurrentVote !== null)) await resolveVotes(db, { ...room, HostPlayerId: NewHostPlayerId, Version: room.Version + 1 }, remaining);
      return Response.json({ Left: true });
    }

    if (Action === "Advance") {
      if (!IsHost || room.Phase !== "Result") return Response.json({ Error: "Only the captain can continue." }, { status: 403 });
      const failed = resourceKeys.some((key) => room[key] <= 0);
      if (failed || room.RoundNumber >= 6) {
        await db.update(GameRooms).set({ Phase: "GameOver", VoteDeadlineAt: null, ComputerTurnAt: null, Version: room.Version + 1, UpdatedAt: new Date() }).where(eq(GameRooms.RoomId, room.RoomId));
      } else {
        const order = JSON.parse(room.CrisisOrder) as number[];
        for (const player of players) await db.update(GamePlayers).set({ CurrentVote: null }).where(eq(GamePlayers.PlayerId, player.PlayerId));
        const now = new Date();
        await db.update(GameRooms).set({ Phase: "Voting", RoundNumber: room.RoundNumber + 1, CurrentCrisisId: order[room.RoundNumber], WinningOption: null, ResultText: null, VoteDeadlineAt: new Date(now.getTime() + VOTING_TIME_MS), ComputerTurnAt: new Date(now.getTime() + COMPUTER_VOTE_DELAY_MS), Version: room.Version + 1, UpdatedAt: now }).where(eq(GameRooms.RoomId, room.RoomId));
      }
    }

    if (Action === "Rematch") {
      if (!IsHost || room.Phase !== "GameOver") return Response.json({ Error: "Only the captain can begin a rematch." }, { status: 403 });
      for (const player of players) await db.update(GamePlayers).set({ IsReady: player.IsComputer, AgendaId: null, CurrentVote: null, MajorityVotes: 0, MinorityVotes: 0 }).where(eq(GamePlayers.PlayerId, player.PlayerId));
      await db.update(GameRooms).set({ Phase: "Lobby", RoundNumber: 0, CrisisOrder: "[]", CurrentCrisisId: null, WinningOption: null, ResultText: null, VoteDeadlineAt: null, ComputerTurnAt: null, Fuel: 6, Hull: 6, Supplies: 6, Morale: 6, Version: room.Version + 1, UpdatedAt: new Date() }).where(eq(GameRooms.RoomId, room.RoomId));
    }

    const game = await state(RoomCode, PlayerId);
    return Response.json(game);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The ship's computer encountered an error.";
    return Response.json({ Error: message.includes("UNIQUE") ? "That name or room is already in use." : message }, { status: 500 });
  }
}
