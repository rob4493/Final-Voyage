import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { GameMessages, GamePlayers, GameRooms } from "../../../db/schema";
import { Agendas, Crises, agendaComplete, type ResourceKey } from "../../../lib/game-data";

export const dynamic = "force-dynamic";
const resourceKeys: ResourceKey[] = ["Fuel", "Hull", "Supplies", "Morale"];
const MESSAGE_LIMIT = 500;
const MESSAGE_COOLDOWN_MS = 1500;
const blockedWords = ["fuck", "shit", "bitch", "cunt", "nigger", "faggot"];

function filterMessage(message: string) {
  return blockedWords.reduce((clean, word) => clean.replace(new RegExp(`\\b${word}\\b`, "gi"), "*".repeat(word.length)), message);
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
  const [claimed] = await db.update(GameRooms).set({ ...next, Phase: "Result", WinningOption: winner, ResultText: `${selected.Title} carried the vote. ${selected.Detail}`, Version: room.Version + 1, UpdatedAt: new Date() }).where(and(eq(GameRooms.RoomId, room.RoomId), eq(GameRooms.Phase, "Voting"))).returning({ RoomId: GameRooms.RoomId });
  if (!claimed) return;
  for (const p of voted) {
    await db.update(GamePlayers).set({ MajorityVotes: p.MajorityVotes + (p.CurrentVote === winner ? 1 : 0), MinorityVotes: p.MinorityVotes + (p.CurrentVote !== winner ? 1 : 0) }).where(eq(GamePlayers.PlayerId, p.PlayerId));
  }
}

async function state(RoomCode: string, PlayerId: string) {
  const db = getDb();
  const [room] = await db.select().from(GameRooms).where(eq(GameRooms.RoomCode, RoomCode)).limit(1);
  if (!room) return null;
  const players = await db.select().from(GamePlayers).where(eq(GamePlayers.RoomId, room.RoomId));
  const me = players.find((p) => p.PlayerId === PlayerId);
  if (!me) return null;
  const crisis = Crises.find((item) => item.Id === room.CurrentCrisisId) ?? null;
  const ended = room.Phase === "GameOver";
  const resourceState = { Fuel: room.Fuel, Hull: room.Hull, Supplies: room.Supplies, Morale: room.Morale };
  const recentMessages = await db.select().from(GameMessages).where(eq(GameMessages.RoomId, room.RoomId)).orderBy(desc(GameMessages.CreatedAt)).limit(50);
  return {
    Room: { RoomCode: room.RoomCode, Phase: room.Phase, RoundNumber: room.RoundNumber, Fuel: room.Fuel, Hull: room.Hull, Supplies: room.Supplies, Morale: room.Morale, WinningOption: room.WinningOption, ResultText: room.ResultText, Version: room.Version },
    Me: { PlayerId: me.PlayerId, PlayerName: me.PlayerName, IsHost: room.HostPlayerId === me.PlayerId, HasVoted: me.CurrentVote !== null, Vote: me.CurrentVote, Agenda: me.AgendaId === null ? null : Agendas[me.AgendaId] },
    Players: players.sort((a, b) => a.JoinedAt.getTime() - b.JoinedAt.getTime()).map((p) => ({
      PlayerId: p.PlayerId, PlayerName: p.PlayerName, IsHost: p.PlayerId === room.HostPlayerId, HasVoted: p.CurrentVote !== null,
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
        lobbies.push({ RoomCode: room.RoomCode, HostName: host.PlayerName, PlayerCount: players.length, UpdatedAt: room.UpdatedAt });
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
    const body = await request.json() as { Action?: string; PlayerName?: string; RoomCode?: string; PlayerId?: string; Option?: number; IsPublic?: boolean; MessageText?: string };
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

    if (Action === "SendMessage") {
      const rawMessage = (body.MessageText ?? "").trim();
      if (!rawMessage) return Response.json({ Error: "Enter a message before sending." }, { status: 400 });
      if (rawMessage.length > MESSAGE_LIMIT) return Response.json({ Error: `Messages can be up to ${MESSAGE_LIMIT} characters.` }, { status: 400 });
      const [latest] = await db.select().from(GameMessages).where(and(eq(GameMessages.RoomId, room.RoomId), eq(GameMessages.PlayerId, PlayerId))).orderBy(desc(GameMessages.CreatedAt)).limit(1);
      if (latest && Date.now() - latest.CreatedAt.getTime() < MESSAGE_COOLDOWN_MS) return Response.json({ Error: "Please wait a moment before sending another message." }, { status: 429 });
      const now = new Date();
      await db.insert(GameMessages).values({ GameMessageId: crypto.randomUUID(), RoomId: room.RoomId, PlayerId, PlayerName: me.PlayerName, MessageText: filterMessage(rawMessage), MessageType: "Player", CreatedAt: now });
      await db.update(GamePlayers).set({ LastSeenAt: now }).where(eq(GamePlayers.PlayerId, PlayerId));
      return Response.json(await state(RoomCode, PlayerId));
    }

    if (Action === "Start") {
      if (!IsHost) return Response.json({ Error: "Only the captain can launch." }, { status: 403 });
      if (room.Phase !== "Lobby") return Response.json({ Error: "The voyage has already started." }, { status: 409 });
      if (players.length < 3) return Response.json({ Error: "At least 3 crew members are required." }, { status: 400 });
      const crisisOrder = shuffle(Crises.map((c) => c.Id)).slice(0, 6);
      const agendaOrder = shuffle(Agendas.map((_, i) => i));
      const now = new Date();
      for (const [i, player] of players.entries()) {
        await db.update(GamePlayers).set({ AgendaId: agendaOrder[i % agendaOrder.length], CurrentVote: null, MajorityVotes: 0, MinorityVotes: 0 }).where(eq(GamePlayers.PlayerId, player.PlayerId));
      }
      await db.update(GameRooms).set({ Phase: "Voting", RoundNumber: 1, CrisisOrder: JSON.stringify(crisisOrder), CurrentCrisisId: crisisOrder[0], WinningOption: null, ResultText: null, Fuel: 6, Hull: 6, Supplies: 6, Morale: 6, Version: room.Version + 1, UpdatedAt: now }).where(eq(GameRooms.RoomId, room.RoomId));
      await addSystemMessage(db, room.RoomId, "The voyage has launched. Good luck, crew.");
    }

    if (Action === "Vote") {
      const Option = Number(body.Option);
      if (room.Phase !== "Voting" || ![0, 1, 2].includes(Option)) return Response.json({ Error: "That vote is not available." }, { status: 409 });
      await db.update(GamePlayers).set({ CurrentVote: Option, LastSeenAt: new Date() }).where(eq(GamePlayers.PlayerId, PlayerId));
      const voted = await db.select().from(GamePlayers).where(and(eq(GamePlayers.RoomId, room.RoomId), isNotNull(GamePlayers.CurrentVote)));
      if (voted.length === players.length) await resolveVotes(db, room, voted);
    }

    if (Action === "CloseLobby") {
      if (!IsHost || room.Phase !== "Lobby") return Response.json({ Error: "Only the captain can close an open lobby." }, { status: 403 });
      await db.delete(GameMessages).where(eq(GameMessages.RoomId, room.RoomId));
      await db.delete(GamePlayers).where(eq(GamePlayers.RoomId, room.RoomId));
      await db.delete(GameRooms).where(eq(GameRooms.RoomId, room.RoomId));
      return Response.json({ Closed: true });
    }

    if (Action === "LeaveGame") {
      const remaining = players.filter((p) => p.PlayerId !== PlayerId);
      if (remaining.length === 0) {
        await db.delete(GameMessages).where(eq(GameMessages.RoomId, room.RoomId));
        await db.delete(GamePlayers).where(eq(GamePlayers.PlayerId, PlayerId));
        await db.delete(GameRooms).where(eq(GameRooms.RoomId, room.RoomId));
        return Response.json({ Left: true });
      }
      const NewHostPlayerId = IsHost ? remaining.sort((a, b) => a.JoinedAt.getTime() - b.JoinedAt.getTime())[0].PlayerId : room.HostPlayerId;
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
        await db.update(GameRooms).set({ Phase: "GameOver", Version: room.Version + 1, UpdatedAt: new Date() }).where(eq(GameRooms.RoomId, room.RoomId));
      } else {
        const order = JSON.parse(room.CrisisOrder) as number[];
        for (const player of players) await db.update(GamePlayers).set({ CurrentVote: null }).where(eq(GamePlayers.PlayerId, player.PlayerId));
        await db.update(GameRooms).set({ Phase: "Voting", RoundNumber: room.RoundNumber + 1, CurrentCrisisId: order[room.RoundNumber], WinningOption: null, ResultText: null, Version: room.Version + 1, UpdatedAt: new Date() }).where(eq(GameRooms.RoomId, room.RoomId));
      }
    }

    if (Action === "Rematch") {
      if (!IsHost || room.Phase !== "GameOver") return Response.json({ Error: "Only the captain can begin a rematch." }, { status: 403 });
      for (const player of players) await db.update(GamePlayers).set({ AgendaId: null, CurrentVote: null, MajorityVotes: 0, MinorityVotes: 0 }).where(eq(GamePlayers.PlayerId, player.PlayerId));
      await db.update(GameRooms).set({ Phase: "Lobby", RoundNumber: 0, CrisisOrder: "[]", CurrentCrisisId: null, WinningOption: null, ResultText: null, Fuel: 6, Hull: 6, Supplies: 6, Morale: 6, Version: room.Version + 1, UpdatedAt: new Date() }).where(eq(GameRooms.RoomId, room.RoomId));
    }

    const game = await state(RoomCode, PlayerId);
    return Response.json(game);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The ship's computer encountered an error.";
    return Response.json({ Error: message.includes("UNIQUE") ? "That name or room is already in use." : message }, { status: 500 });
  }
}
