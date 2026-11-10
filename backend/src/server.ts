import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { exec } from "child_process";
import { promisify } from "util";
import authRoutes from "./routes/auth.js";
import roomRoutes, {
  setRoomCallbacks,
  recordRoomVisit,
} from "./routes/rooms.js";
import { verifyToken, UserTokenPayload, TvTokenPayload } from "./lib/auth.js";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import prisma from "./lib/prisma.js";
import { normalizaBusca } from "./lib/text.js";
import {
  addSongToLibrary,
  incrementPlayCount,
  getSongLibrary as getSongLibraryFromDb,
  getTopSongs as getTopSongsFromDb,
  removeSongFromLibrary,
  backfillSearchKeys,
  upsertCatalogoRenomeando,
} from "./lib/songs.js";

const execAsync = promisify(exec);

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface Singer {
  id: string; // Unique user ID
  name: string; // Display name
}

interface QueueItem {
  id: string;
  videoId: string;
  title: string;
  requestedBy: string;
  singers: Singer[]; // All singers with their IDs
}

interface RankingEntry {
  name: string;
  score: number;
}

interface DuetRankingEntry {
  singerIds: [string, string]; // Sorted IDs for consistent lookup
  names: [string, string]; // Display names
  score: number;
  count: number; // Number of songs sung together
}

interface RoomState {
  code: string;
  createdAt: number;
  lastActivityAt: number; // timestamp da última atividade (pra cleanup)
  nowPlaying: QueueItem | null;
  queue: QueueItem[];
  ranking: Record<string, RankingEntry | number>; // odUserId -> { name, score } OR old format name -> score
  duetRanking?: Record<string, DuetRankingEntry>; // "id1|id2" -> { names, score, count }
  lastFinalizeMs: number;
  showingScore: boolean; // true while TV is showing score overlay
  /**
   * Nota da plateia: cada convidado vota no cantor pelo celular.
   * Voto por participante (userId), 0–10, uma vez por música.
   */
  crowd?: {
    votes: Record<string, { score: number; name: string }>;
    open: boolean;
  };
}

interface RoomConnections {
  tv: Set<WebSocket>;
  mobile: Set<WebSocket>;
  participants: Map<WebSocket, { id: string; name: string }>; // socket -> user info
  recentParticipants: Map<string, { name: string; lastSeen: number }>; // odUserId -> info
}

// ─────────────────────────────────────────────────────────────
// State (in-memory for rooms only - songs now in database)
// ─────────────────────────────────────────────────────────────

const rooms = new Map<string, RoomState>();
const connections = new Map<string, RoomConnections>();

// ─────────────────────────────────────────────────────────────
// Cleanup automático de salas inativas (on/off dinâmico)
// ─────────────────────────────────────────────────────────────

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos
const INACTIVE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 horas

let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

function startCleanupIfNeeded() {
  if (cleanupIntervalId === null && rooms.size > 0) {
    cleanupIntervalId = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  }
}

function stopCleanupIfEmpty() {
  if (cleanupIntervalId !== null && rooms.size === 0) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}

function runCleanup() {
  const now = Date.now();

  for (const [code, room] of rooms) {
    const conns = connections.get(code);
    const hasConnections =
      conns && (conns.tv.size > 0 || conns.mobile.size > 0);
    const isInactive = now - room.lastActivityAt > INACTIVE_THRESHOLD_MS;

    // Limpa se: ninguém conectado E inativo há mais de threshold
    if (!hasConnections && isInactive) {
      rooms.delete(code);
      connections.delete(code);
    }
  }

  // Se não sobrou nenhuma sala, para o cleanup
  stopCleanupIfEmpty();
}

// Helper para adicionar sala e iniciar cleanup se necessário
function addRoom(code: string, room: RoomState) {
  rooms.set(code, room);
  startCleanupIfNeeded();
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

// Atualiza timestamp de última atividade da sala
function touchRoom(roomCode: string) {
  const room = rooms.get(roomCode);
  if (room) {
    room.lastActivityAt = Date.now();
  }
}

function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Create a normalized duet key from two user IDs (sorted alphabetically)
function makeDuetKey(id1: string, id2: string): string {
  return [id1, id2].sort().join("|");
}

// Mesma fórmula do frontend (pikaraokeScore.ts) - port exato do PiKaraoke original
// bias=2 significa sqrt(random), que puxa os valores pra cima mas não exagera
// Máximo 99 normal, com 1% de chance de tirar 100 (perfeito!)
function biasedPartyScore(): number {
  // 1% de chance de score perfeito!
  if (Math.random() < 0.01) return 100;

  const random = Math.random();
  const bias = 2;
  const scoreValue = Math.pow(random, 1 / bias) * 100; // sqrt(random) * 100 → máx 99
  return Math.floor(scoreValue);
}

type VoiceMetrics = {
  voicePct?: number;
  steadyPct?: number;
  longestNote?: number;
  range?: number;
  frames?: number;
};

/**
 * Nota medida pela TV a partir do microfone.
 * O cliente manda as métricas; aqui só sanitizamos e, se o microfone
 * praticamente não captou voz, devolvemos 0 (sem nota) em vez de sortear.
 */
function scoreFromVoiceMetrics(m?: VoiceMetrics | null): number | null {
  if (!m) return null;
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);
  const voicePct = Math.min(100, Math.max(0, num(m.voicePct)));
  const steadyPct = Math.min(100, Math.max(0, num(m.steadyPct)));
  const range = Math.min(36, Math.max(0, num(m.range)));
  const frames = num(m.frames);
  if (frames < 8) return 0; // microfone não pegou nada
  const rangePct = Math.min(100, (range / 20) * 100);
  const raw = voicePct * 0.5 + steadyPct * 0.35 + rangePct * 0.15;
  const penalty = voicePct < 12 ? voicePct / 12 : 1;
  return Math.round(Math.min(99, Math.max(0, raw * penalty)));
}

function getRoomState(room: RoomState) {
  // Convert ranking to format for frontend: userId -> { name, score }
  // This keeps users with same name separate
  const rankingForFrontend: Record<string, { name: string; score: number }> =
    {};
  for (const [odUserId, entry] of Object.entries(room.ranking)) {
    // Handle both old format (name -> number) and new format (userId -> { name, score })
    if (typeof entry === "number") {
      // Old format: userId is actually the name, entry is the score
      rankingForFrontend[odUserId] = { name: odUserId, score: entry };
    } else {
      // New format: entry is { name, score }
      rankingForFrontend[odUserId] = { name: entry.name, score: entry.score };
    }
  }

  // Nota da plateia (média 0–10 e quantos votaram)
  const crowdVotes = Object.values(room.crowd?.votes || {});
  const crowd = {
    open: !!room.crowd?.open,
    count: crowdVotes.length,
    average: crowdVotes.length
      ? Math.round(
          (crowdVotes.reduce((a, v) => a + v.score, 0) / crowdVotes.length) *
            10,
        ) / 10
      : null,
    votes: room.crowd?.votes || {},
  };

  // Convert duet ranking to array format for frontend
  const duetRankingArray = Object.values(room.duetRanking || {}).map(
    (entry) => ({
      names: entry.names,
      score: entry.score,
      count: entry.count,
    }),
  );

  return {
    roomCode: room.code,
    nowPlaying: room.nowPlaying
      ? {
          id: room.nowPlaying.id,
          videoId: room.nowPlaying.videoId,
          title: room.nowPlaying.title,
          requestedBy: room.nowPlaying.requestedBy,
          singers: room.nowPlaying.singers,
        }
      : null,
    queue: room.queue.map((item) => ({
      id: item.id,
      videoId: item.videoId,
      title: item.title,
      requestedBy: item.requestedBy,
      singers: item.singers,
    })),
    ranking: rankingForFrontend,
    duetRanking: duetRankingArray,
    showingScore: room.showingScore,
    crowd,
  };
}

function broadcast(roomCode: string, msg: object) {
  const conns = connections.get(roomCode);
  if (!conns) return;
  const payload = JSON.stringify(msg);
  const dead: WebSocket[] = [];
  for (const ws of [...conns.tv, ...conns.mobile]) {
    try {
      if (ws.readyState === 1) ws.send(payload);
      else dead.push(ws);
    } catch {
      dead.push(ws);
    }
  }
  for (const ws of dead) {
    conns.tv.delete(ws);
    conns.mobile.delete(ws);
  }
}

interface ParticipantInfo {
  id: string;
  name: string;
}

function getParticipantsList(roomCode: string): ParticipantInfo[] {
  const conns = connections.get(roomCode);
  if (!conns) return [];

  const participantsMap = new Map<string, string>(); // id -> name
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;

  // Add online participants
  for (const info of conns.participants.values()) {
    if (info && info.id) {
      participantsMap.set(info.id, info.name);
    }
  }

  // Add recently offline participants (< 1 hour)
  for (const [odUserId, info] of conns.recentParticipants) {
    if (now - info.lastSeen < ONE_HOUR) {
      if (!participantsMap.has(odUserId)) {
        participantsMap.set(odUserId, info.name);
      }
    } else {
      conns.recentParticipants.delete(odUserId);
    }
  }

  return Array.from(participantsMap.entries()).map(([id, name]) => ({
    id,
    name,
  }));
}

function getParticipantsNamesList(roomCode: string): string[] {
  return getParticipantsList(roomCode).map((p) => p.name);
}

// Generate unique nickname for a user in a room
// If "André" exists, returns "André2", "André3", etc.
function getUniqueNickname(
  roomCode: string,
  desiredName: string,
  odUserId: string,
): string {
  const participants = getParticipantsList(roomCode);
  const trimmedName = desiredName.trim();

  // Check if this exact name is already used by someone else
  const nameExists = participants.some(
    (p) =>
      p.name.toLowerCase() === trimmedName.toLowerCase() && p.id !== odUserId,
  );

  if (!nameExists) {
    return trimmedName;
  }

  // Find unique suffix
  let suffix = 2;
  while (suffix < 100) {
    const candidateName = `${trimmedName}${suffix}`;
    const candidateExists = participants.some(
      (p) =>
        p.name.toLowerCase() === candidateName.toLowerCase() &&
        p.id !== odUserId,
    );
    if (!candidateExists) {
      return candidateName;
    }
    suffix++;
  }

  // Fallback (very unlikely)
  return `${trimmedName}_${randomId().slice(0, 4)}`;
}

// Helper: Get or restore room from DB
async function getOrRestoreRoom(roomCode: string): Promise<RoomState | null> {
  const code = roomCode.toUpperCase();
  let room = rooms.get(code);

  if (!room) {
    // Check database
    const dbRoom = await prisma.room.findUnique({
      where: { code },
    });

    if (!dbRoom) return null;

    // Restore room in memory
    room = {
      code: dbRoom.code,
      createdAt: dbRoom.createdAt.getTime(),
      lastActivityAt: Date.now(),
      nowPlaying: null,
      queue: [],
      ranking: {},
      duetRanking: {},
      lastFinalizeMs: 0,
      showingScore: false,
      crowd: { votes: {}, open: false },
    };
    addRoom(code, room);
    connections.set(code, {
      tv: new Set(),
      mobile: new Set(),
      participants: new Map(),
      recentParticipants: new Map(),
    });
  }

  return room;
}

function broadcastParticipants(roomCode: string) {
  const participants = getParticipantsList(roomCode);
  broadcast(roomCode, {
    type: "PARTICIPANTS",
    participants,
  });
}

// ─────────────────────────────────────────────────────────────────
// Fastify App
// ─────────────────────────────────────────────────────────────

const app = Fastify({ logger: { level: "warn" } });

await app.register(cors, { origin: true });
await app.register(websocket);

// Register auth routes
await app.register(authRoutes);

// Register room routes (new DB-backed routes)
await app.register(roomRoutes);

// Setup callback for when room is created via DB
setRoomCallbacks({
  onRoomCreated: (roomCode: string, ownerId: string) => {
    // Create in-memory state for the room
    if (!rooms.has(roomCode)) {
      addRoom(roomCode, {
        code: roomCode,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        nowPlaying: null,
        queue: [],
        ranking: {},
        duetRanking: {},
        lastFinalizeMs: 0,
        showingScore: false,
      });
      connections.set(roomCode, {
        tv: new Set(),
        mobile: new Set(),
        participants: new Map(),
        recentParticipants: new Map(),
      });
    }
  },
});

// Health
app.get("/health", async () => ({ status: "ok" }));

// Get state (with auto-restore from DB if room exists in DB but not in memory)
app.get<{ Params: { roomCode: string } }>(
  "/api/rooms/:roomCode/state",
  async (req, reply) => {
    const room = await getOrRestoreRoom(req.params.roomCode);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    return getRoomState(room);
  },
);

// Get participants in room (for duet selection)
// Returns online users + recently offline (< 1 hour)
app.get<{ Params: { roomCode: string } }>(
  "/api/rooms/:roomCode/participants",
  async (req, reply) => {
    const room = await getOrRestoreRoom(req.params.roomCode);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const conns = connections.get(room.code);
    if (!conns) return reply.code(404).send({ error: "room_not_found" });

    const participants = getParticipantsList(req.params.roomCode);
    return { participants };
  },
);

// Enqueue
app.post<{
  Params: { roomCode: string };
  Body: {
    videoId: string;
    title?: string;
    requestedBy?: string;
    partner?: string;
    userId?: string;
    partnerId?: string;
  };
}>("/api/rooms/:roomCode/enqueue", async (req, reply) => {
  const room = await getOrRestoreRoom(req.params.roomCode);
  if (!room) return reply.code(404).send({ error: "room_not_found" });
  touchRoom(req.params.roomCode);

  const videoId = (req.body.videoId || "").trim();
  const title = (req.body.title || "").trim() || "(sem título)";
  const requestedBy = (req.body.requestedBy || "").trim() || "Convidado";
  const partner = (req.body.partner || "").trim();
  const odUserId = (req.body.userId || "").trim() || `anon_${randomId()}`;
  const partnerId = (req.body.partnerId || "").trim();

  if (!videoId) return reply.code(400).send({ error: "missing_videoId" });

  // Build singers array with IDs
  const singers: Singer[] = [{ id: odUserId, name: requestedBy }];
  if (partner && partner !== requestedBy && partnerId) {
    singers.push({ id: partnerId, name: partner });
  }

  const item: QueueItem = {
    id: randomId(),
    videoId,
    title,
    requestedBy,
    singers,
  };
  room.queue.push(item);

  // Auto-save to database library (upsert - creates if not exists)
  addSongToLibrary(videoId, title, requestedBy).catch(() => {
    // Silent fail - song still plays even if library save fails
  });

  broadcast(room.code, { type: "STATE", state: getRoomState(room) });

  return { ok: true, itemId: item.id };
});

// Next song
app.post<{ Params: { roomCode: string } }>(
  "/api/rooms/:roomCode/next",
  async (req, reply) => {
    const room = await getOrRestoreRoom(req.params.roomCode);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    touchRoom(req.params.roomCode);

    room.nowPlaying = room.queue.shift() || null;
    broadcast(room.code, { type: "STATE", state: getRoomState(room) });

    // Auto-play after a delay to give TV time to create the player
    if (room.nowPlaying) {
      const code = room.code;
      setTimeout(() => {
        const conns = connections.get(code);
        if (conns) {
          const payload = JSON.stringify({
            type: "PLAYER_COMMAND",
            action: "play",
          });
          for (const ws of conns.tv) {
            try {
              if (ws.readyState === 1) ws.send(payload);
            } catch {
              // ignore
            }
          }
        }
      }, 800);
    }

    return { ok: true };
  },
);

// Queue management (host controls)
app.post<{
  Params: { roomCode: string };
  Body: { itemId: string };
}>("/api/rooms/:roomCode/queue/remove", async (req, reply) => {
  const room = await getOrRestoreRoom(req.params.roomCode);
  if (!room) return reply.code(404).send({ error: "room_not_found" });

  const itemId = (req.body.itemId || "").trim();
  if (!itemId) return reply.code(400).send({ error: "missing_itemId" });

  const before = room.queue.length;
  room.queue = room.queue.filter((i) => i.id !== itemId);
  if (room.queue.length === before) {
    return reply.code(404).send({ error: "not_found" });
  }

  broadcast(room.code, { type: "STATE", state: getRoomState(room) });
  return { ok: true };
});

app.post<{
  Params: { roomCode: string };
  Body: { itemId: string; direction: "up" | "down" };
}>("/api/rooms/:roomCode/queue/move", async (req, reply) => {
  const room = await getOrRestoreRoom(req.params.roomCode);
  if (!room) return reply.code(404).send({ error: "room_not_found" });

  const itemId = (req.body.itemId || "").trim();
  const direction = req.body.direction;
  if (!itemId) return reply.code(400).send({ error: "missing_itemId" });
  if (direction !== "up" && direction !== "down") {
    return reply.code(400).send({ error: "invalid_direction" });
  }

  const idx = room.queue.findIndex((i) => i.id === itemId);
  if (idx === -1) return reply.code(404).send({ error: "not_found" });

  const newIdx = direction === "up" ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= room.queue.length) return { ok: true };

  const tmp = room.queue[idx];
  room.queue[idx] = room.queue[newIdx];
  room.queue[newIdx] = tmp;

  broadcast(room.code, { type: "STATE", state: getRoomState(room) });
  return { ok: true };
});

app.post<{
  Params: { roomCode: string };
  Body: { itemId: string };
}>("/api/rooms/:roomCode/queue/to-top", async (req, reply) => {
  const room = await getOrRestoreRoom(req.params.roomCode);
  if (!room) return reply.code(404).send({ error: "room_not_found" });

  const itemId = (req.body.itemId || "").trim();
  if (!itemId) return reply.code(400).send({ error: "missing_itemId" });

  const idx = room.queue.findIndex((i) => i.id === itemId);
  if (idx === -1) return reply.code(404).send({ error: "not_found" });
  if (idx === 0) return { ok: true };

  const [item] = room.queue.splice(idx, 1);
  room.queue.unshift(item);

  broadcast(room.code, { type: "STATE", state: getRoomState(room) });
  return { ok: true };
});

// Finalize (party-friendly, minimal cooldown)
app.post<{
  Params: { roomCode: string };
  Body: { requester?: string; voice?: VoiceMetrics };
}>("/api/rooms/:roomCode/finalize", async (req, reply) => {
  const room = await getOrRestoreRoom(req.params.roomCode);
  if (!room) return reply.code(404).send({ error: "room_not_found" });
  touchRoom(req.params.roomCode);

  const requester = (req.body.requester || "").trim() || "Convidado";
  const now = Date.now();

  // 10s cooldown (party spam protection)
  if (now - room.lastFinalizeMs < 10_000) {
    return reply.code(429).send({ error: "cooldown", cooldownMs: 10_000 });
  }
  room.lastFinalizeMs = now;

  if (!room.nowPlaying) {
    return reply.code(400).send({ error: "nothing_playing" });
  }

  // Get all singers (supports duets) - now with IDs
  const singers: Singer[] = room.nowPlaying.singers || [
    { id: `anon_${randomId()}`, name: room.nowPlaying.requestedBy },
  ];
  const measured = scoreFromVoiceMetrics(req.body?.voice);

  // Nota da plateia: média 0–10 -> 0–99 (peso 30% quando existe)
  const crowdVotes = Object.values(room.crowd?.votes || {});
  const crowdAvg = crowdVotes.length
    ? crowdVotes.reduce((a, v) => a + v.score, 0) / crowdVotes.length
    : null;
  const crowdScore =
    crowdAvg === null ? null : Math.round((crowdAvg / 10) * 99);

  let score: number;
  let scoring: string;
  if (measured !== null && crowdScore !== null) {
    score = Math.round(measured * 0.7 + crowdScore * 0.3);
    scoring = "microfone+plateia";
  } else if (measured !== null) {
    score = measured;
    scoring = "microfone";
  } else if (crowdScore !== null) {
    score = crowdScore;
    scoring = "plateia";
  } else {
    score = biasedPartyScore();
    scoring = "aleatoria";
  }

  // Give points to ALL singers (individual ranking)
  for (const singer of singers) {
    const existingEntry = room.ranking[singer.id];
    if (!existingEntry || typeof existingEntry === "number") {
      room.ranking[singer.id] = { name: singer.name, score: 0 };
    }
    (room.ranking[singer.id] as RankingEntry).score += score;
    // Update name in case it changed
    (room.ranking[singer.id] as RankingEntry).name = singer.name;
  }

  // If it's a duet, update duet ranking
  if (singers.length === 2) {
    // Initialize duetRanking if it doesn't exist (old room)
    if (!room.duetRanking) {
      room.duetRanking = {};
    }
    const duetKey = makeDuetKey(singers[0].id, singers[1].id);
    if (!room.duetRanking[duetKey]) {
      // Sort singers by ID to keep ID-name correspondence consistent
      const sortedSingers = [...singers].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      room.duetRanking[duetKey] = {
        singerIds: [sortedSingers[0].id, sortedSingers[1].id] as [
          string,
          string,
        ],
        names: [sortedSingers[0].name, sortedSingers[1].name] as [
          string,
          string,
        ],
        score: 0,
        count: 0,
      };
    } else {
      // Update names based on singerIds order (preserves ID-name correspondence)
      const entry = room.duetRanking[duetKey];
      for (let i = 0; i < entry.singerIds.length; i++) {
        const singer = singers.find((s) => s.id === entry.singerIds[i]);
        if (singer) {
          entry.names[i] = singer.name;
        }
      }
    }
    room.duetRanking[duetKey].score += score;
    room.duetRanking[duetKey].count += 1;
  }

  // Format singer names for display (e.g., "Dede e Ana")
  const singerNames = singers.map((s) => s.name);
  const singerDisplay =
    singerNames.length > 1
      ? singerNames.slice(0, -1).join(", ") +
        " e " +
        singerNames[singerNames.length - 1]
      : singerNames[0];

  // Set showingScore flag - TV will clear it when done
  room.showingScore = true;
  // fecha a votação da música que acabou
  if (room.crowd) room.crowd.open = false;

  broadcast(room.code, {
    type: "FINALIZED",
    by: requester,
    singer: singerDisplay,
    singers: singerNames, // Array of singer names for display
    score,
    scoring,
    crowdAverage: crowdAvg,
    crowdCount: crowdVotes.length,
    videoId: room.nowPlaying.videoId,
    title: room.nowPlaying.title,
  });

  // Increment play count in database
  const finalizedVideoId = room.nowPlaying.videoId;
  incrementPlayCount(finalizedVideoId).catch(() => {
    // Silent fail - finalize still works even if count fails
  });

  // NÃO auto-avança para próxima - espera alguém apertar "Começar"
  room.nowPlaying = null;
  broadcast(room.code, { type: "STATE", state: getRoomState(room) });

  return { ok: true, score, scoring };
});

// ─────────────────────────────────────────────────────────────
// Nota da plateia (o público vota pelo celular)
// ─────────────────────────────────────────────────────────────

// Abre/reinicia a votação da música atual
app.post<{ Params: { roomCode: string } }>(
  "/api/rooms/:roomCode/crowd/open",
  async (req, reply) => {
    const room = await getOrRestoreRoom(req.params.roomCode);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    if (!room.nowPlaying) {
      return reply.code(400).send({ error: "nothing_playing" });
    }
    touchRoom(req.params.roomCode);
    room.crowd = { votes: {}, open: true };
    broadcast(room.code, { type: "STATE", state: getRoomState(room) });
    return { ok: true, open: true };
  },
);

// Fecha a votação (a TV chama antes de finalizar)
app.post<{ Params: { roomCode: string } }>(
  "/api/rooms/:roomCode/crowd/close",
  async (req, reply) => {
    const room = await getOrRestoreRoom(req.params.roomCode);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    if (room.crowd) room.crowd.open = false;
    const votes = Object.values(room.crowd?.votes || {});
    const average = votes.length
      ? Math.round(
          (votes.reduce((a, v) => a + v.score, 0) / votes.length) * 10,
        ) / 10
      : null;
    broadcast(room.code, { type: "STATE", state: getRoomState(room) });
    return { ok: true, count: votes.length, average };
  },
);

// Voto de um convidado (0–10). Um voto por participante por música.
app.post<{
  Params: { roomCode: string };
  Body: { userId?: string; name?: string; score?: number };
}>("/api/rooms/:roomCode/crowd/vote", async (req, reply) => {
  const room = await getOrRestoreRoom(req.params.roomCode);
  if (!room) return reply.code(404).send({ error: "room_not_found" });
  if (!room.nowPlaying)
    return reply.code(400).send({ error: "nothing_playing" });
  if (!room.crowd?.open)
    return reply.code(409).send({ error: "voting_closed" });

  const score = Math.round(Number(req.body?.score));
  if (!isFinite(score) || score < 0 || score > 10) {
    return reply.code(400).send({ error: "invalid_score" });
  }
  const userId = (req.body?.userId || "").trim() || `anon_${randomId()}`;
  const name = (req.body?.name || "").trim() || "Convidado";

  room.crowd.votes[userId] = { score, name };
  touchRoom(req.params.roomCode);
  broadcast(room.code, { type: "STATE", state: getRoomState(room) });
  return { ok: true, score };
});

// Pular vídeo (ex.: com incorporação bloqueada) — não pontua e sobe o próximo
app.post<{ Params: { roomCode: string }; Body: { reason?: string } }>(
  "/api/rooms/:roomCode/skip",
  async (req, reply) => {
    const room = await getOrRestoreRoom(req.params.roomCode);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    touchRoom(req.params.roomCode);

    const skipped = room.nowPlaying?.title || "";
    room.nowPlaying = null;
    room.showingScore = false;
    if (room.queue.length) {
      room.nowPlaying = room.queue.shift() || null;
    }

    broadcast(room.code, {
      type: "SKIPPED",
      reason: req.body?.reason || "unplayable",
      title: skipped,
      next: room.nowPlaying?.title || null,
    });
    broadcast(room.code, { type: "STATE", state: getRoomState(room) });
    return { ok: true, skipped, next: room.nowPlaying?.title || null };
  },
);

// Update user name (when user changes their display name)
app.post<{
  Params: { roomCode: string };
  Body: { userId: string; newName: string };
}>("/api/rooms/:roomCode/update-name", async (req, reply) => {
  const room = await getOrRestoreRoom(req.params.roomCode);
  if (!room) return reply.code(404).send({ error: "room_not_found" });

  const { userId, newName } = req.body;
  if (!userId || !newName) {
    return reply.code(400).send({ error: "missing_userId_or_newName" });
  }

  const trimmedName = newName.trim();
  if (!trimmedName) {
    return reply.code(400).send({ error: "empty_name" });
  }

  // Check for duplicate name in room
  const existingParticipants = getParticipantsList(req.params.roomCode);
  const duplicateName = existingParticipants.find(
    (p) =>
      p.name.toLowerCase() === trimmedName.toLowerCase() && p.id !== userId,
  );
  if (duplicateName) {
    return reply.code(400).send({
      error: "duplicate_name",
      message: `O nome "${trimmedName}" já está sendo usado nesta sala.`,
    });
  }

  // Update in ranking
  if (room.ranking[userId] && typeof room.ranking[userId] !== "number") {
    (room.ranking[userId] as RankingEntry).name = trimmedName;
  }

  // Update in duet ranking
  if (room.duetRanking) {
    for (const entry of Object.values(room.duetRanking)) {
      const idx = entry.singerIds.indexOf(userId);
      if (idx !== -1) {
        entry.names[idx] = trimmedName;
      }
    }
  }

  // Update in queue
  for (const item of room.queue) {
    for (const singer of item.singers) {
      if (singer.id === userId) {
        singer.name = trimmedName;
      }
    }
    // Also update requestedBy if it matches
    if (item.singers.some((s) => s.id === userId)) {
      item.requestedBy = item.singers.map((s) => s.name).join(" e ");
    }
  }

  // Update in nowPlaying
  if (room.nowPlaying) {
    for (const singer of room.nowPlaying.singers) {
      if (singer.id === userId) {
        singer.name = trimmedName;
      }
    }
    if (room.nowPlaying.singers.some((s) => s.id === userId)) {
      room.nowPlaying.requestedBy = room.nowPlaying.singers
        .map((s) => s.name)
        .join(" e ");
    }
  }

  // Update in participants map
  const conns = connections.get(req.params.roomCode);
  if (conns) {
    for (const [socket, info] of conns.participants) {
      if (info.id === userId) {
        conns.participants.set(socket, { id: userId, name: trimmedName });
      }
    }
    // Update in recentParticipants
    if (conns.recentParticipants.has(userId)) {
      const existing = conns.recentParticipants.get(userId)!;
      conns.recentParticipants.set(userId, { ...existing, name: trimmedName });
    }
    // Broadcast updated participants
    broadcastParticipants(req.params.roomCode);
  }

  // Broadcast updated state
  broadcast(room.code, { type: "STATE", state: getRoomState(room) });

  return { ok: true };
});

// Clear showingScore flag (called by TV when score overlay closes)
app.post<{ Params: { roomCode: string } }>(
  "/api/rooms/:roomCode/score-done",
  async (req, reply) => {
    const room = await getOrRestoreRoom(req.params.roomCode);
    if (!room) return reply.code(404).send({ error: "room_not_found" });

    room.showingScore = false;
    broadcast(room.code, { type: "STATE", state: getRoomState(room) });

    return { ok: true };
  },
);

// Remote play control (mobile -> TV)
app.post<{ Params: { roomCode: string }; Body: { action: string } }>(
  "/api/rooms/:roomCode/player",
  async (req, reply) => {
    const room = await getOrRestoreRoom(req.params.roomCode);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    touchRoom(req.params.roomCode);

    const action = req.body.action; // 'play' | 'pause'
    if (!["play", "pause"].includes(action)) {
      return reply.code(400).send({ error: "invalid_action" });
    }

    // Broadcast to TV clients only
    const conns = connections.get(room.code);
    if (conns) {
      const payload = JSON.stringify({ type: "PLAYER_COMMAND", action });
      for (const ws of conns.tv) {
        try {
          if (ws.readyState === 1) ws.send(payload);
        } catch {
          // ignore
        }
      }
    }

    return { ok: true, action };
  },
);

// ─────────────────────────────────────────────────────────────
// YouTube Search API (using yt-dlp like PiKaraoke)
// ─────────────────────────────────────────────────────────────

interface YouTubeSearchResult {
  videoId: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  /** "4:32" quando a fonte informa a duração */
  duration?: string;
}

// Search YouTube using yt-dlp (same method as PiKaraoke)
async function searchWithYtDlp(query: string): Promise<YouTubeSearchResult[]> {
  const numResults = 10;
  // Format exactly like PiKaraoke: ytsearch10:"query"
  // Escape shell special characters
  const safeQuery = query.replace(/[`$\\]/g, "\\$&").replace(/"/g, '\\"');
  const cmd = `yt-dlp -j --no-playlist --flat-playlist "ytsearch${numResults}:${safeQuery}"`;

  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 }); // 30s timeout

    const results: YouTubeSearchResult[] = [];
    for (const line of stdout.split("\n")) {
      if (line.trim().length < 2) continue;
      try {
        const j = JSON.parse(line);
        if (!j.id) continue;
        results.push({
          videoId: j.id,
          title: j.title || "(sem título)",
          thumbnail: `https://i.ytimg.com/vi/${j.id}/mqdefault.jpg`,
          channelTitle: j.channel || j.uploader || "",
        });
      } catch {
        // skip invalid JSON lines
      }
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Busca no YouTube SEM chave de API.
 *
 * Usa o endpoint que o próprio site do YouTube usa (InnerTube, formato JSON).
 * Não precisa de chave, conta nem cota. É a mesma fonte que sites de karaokê
 * comerciais usam por trás — a diferença é que aqui não dependemos do servidor
 * de ninguém.
 *
 * Vantagens sobre o yt-dlp: resposta em ~0,5 s (contra ~6 s) e não precisa
 * instalar nada no Windows. O yt-dlp fica como reserva.
 */
async function searchWithInnerTube(
  query: string,
): Promise<YouTubeSearchResult[]> {
  const body = {
    context: {
      client: {
        clientName: "WEB",
        clientVersion: "2.20240101.00.00",
        hl: "pt",
        gl: "BR",
      },
    },
    query,
  };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(
      "https://www.youtube.com/youtubei/v1/search?prettyPrint=false",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": "pt-BR,pt;q=0.9",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        },
        body: JSON.stringify(body),
        signal: ctl.signal,
      },
    );
    if (!res.ok) return [];
    const data = await res.json();

    // percorre a árvore atrás de videoRenderer (o formato muda de nome às vezes)
    const out: YouTubeSearchResult[] = [];
    const seen = new Set<string>();
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object" || out.length >= 16) return;
      const obj = node as Record<string, unknown>;
      const vr = obj.videoRenderer as
        | {
            videoId?: string;
            title?: { runs?: { text?: string }[]; simpleText?: string };
            ownerText?: { runs?: { text?: string }[] };
            shortBylineText?: { runs?: { text?: string }[] };
            lengthText?: { simpleText?: string };
            viewCountText?: { simpleText?: string };
          }
        | undefined;
      if (vr?.videoId && !seen.has(vr.videoId)) {
        seen.add(vr.videoId);
        const title =
          vr.title?.runs?.map((r) => r.text || "").join("") ||
          vr.title?.simpleText ||
          "(sem título)";
        const channel =
          vr.ownerText?.runs?.map((r) => r.text || "").join("") ||
          vr.shortBylineText?.runs?.map((r) => r.text || "").join("") ||
          "";
        out.push({
          videoId: vr.videoId,
          title,
          thumbnail: `https://i.ytimg.com/vi/${vr.videoId}/mqdefault.jpg`,
          channelTitle: channel,
          duration: vr.lengthText?.simpleText || "",
        } as YouTubeSearchResult);
      }
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") walk(v);
      }
    };
    walk(data);
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Search YouTube
app.get<{ Querystring: { q: string; mode?: string } }>(
  "/api/youtube/search",
  async (req, reply) => {
    const query = (req.query.q || "").trim();
    if (!query) return reply.code(400).send({ error: "missing_query" });

    try {
      // A palavra "karaoke" é acrescentada no MESMO idioma da consulta:
      // o "karaoke" em inglês puxava versões em espanhol no meio da busca
      // brasileira ("Evidências" vinha como "Cuando digo que no quiero...").
      const ptHints =
        /[ãõáéíóúâêôç]/i.test(query) ||
        /\b(evidencias|musica|musicas|karaoke|karaokê|ao vivo|sertanejo|pagode|forro|forró|mpb|gospel|funk|axe|axé)\b/i.test(
          query,
        );
      const searchTerm = query + (ptHints ? " karaokê" : " karaoke");

      // mode=ytdlp | mode=public servem para testar cada fonte isolada
      const mode = (req.query.mode || "").toLowerCase();
      const started = Date.now();

      if (mode === "ytdlp") {
        const only = await searchWithYtDlp(searchTerm);
        return { source: "yt-dlp", ms: Date.now() - started, results: only };
      }

      const publicResults = await searchWithInnerTube(searchTerm);
      if (publicResults.length >= 2) {
        return {
          source: "publica",
          ms: Date.now() - started,
          results: publicResults,
        };
      }

      // reserva: yt-dlp (precisa estar instalado; resolve buscas que a pública erra)
      const fallback = await searchWithYtDlp(searchTerm);
      return {
        source: fallback.length ? "yt-dlp (reserva)" : "nenhuma",
        ms: Date.now() - started,
        results: fallback.length ? fallback : publicResults,
      };
    } catch {
      return reply.code(500).send({ error: "search_failed" });
    }
  },
);

// Get video info from YouTube (for when user pastes a link)
app.get<{ Querystring: { videoId: string } }>(
  "/api/youtube/info",
  async (req, reply) => {
    const videoId = (req.query.videoId || "").trim();
    if (!videoId) return reply.code(400).send({ error: "missing_videoId" });

    try {
      // Use yt-dlp to get video title
      const cmd = `yt-dlp -j --no-playlist "https://www.youtube.com/watch?v=${videoId}"`;

      const { stdout } = await execAsync(cmd, { timeout: 15000 });
      const info = JSON.parse(stdout);

      return {
        videoId,
        title: info.title || "",
        thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        channelTitle: info.channel || info.uploader || "",
      };
    } catch {
      // Return basic info even if yt-dlp fails
      return {
        videoId,
        title: "",
        thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        channelTitle: "",
      };
    }
  },
);

// ─────────────────────────────────────────────────────────────
// Song Library API (global, shared by all users) - uses database
// ─────────────────────────────────────────────────────────────

// Mapeia o formato do banco para o que o app usa
const toSavedSong = (s: {
  id: string;
  videoId: string;
  title: string;
  addedBy: string;
  createdAt: Date;
  playCount: number;
}) => ({
  id: s.id,
  videoId: s.videoId,
  title: s.title,
  addedBy: s.addedBy,
  savedAt: s.createdAt.getTime(),
  playCount: s.playCount,
});

// Lista a biblioteca (catálogo). Com 20 mil+ músicas, o app pede só as mais
// recentes (`?limit=`) e busca o resto pela rota /api/songs/search.
app.get<{ Querystring: { limit?: string } }>(
  "/api/songs",
  async (req, reply) => {
    const pedido = Number(req.query.limit ?? 0);
    const limit =
      Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, 5000) : 0;
    const [total, songs] = await Promise.all([
      prisma.song.count(),
      limit
        ? prisma.song.findMany({ orderBy: { createdAt: "desc" }, take: limit })
        : getSongLibraryFromDb(),
    ]);
    reply.header("Cache-Control", "no-store");
    return { songs: songs.map(toSavedSong), total };
  },
);

// Busca no catálogo inteiro, no servidor (tolerante a acento e maiúscula).
// Vários termos = todos precisam aparecer: "forro avioes" acha
// "Aviões do Forró — ...".
app.get<{ Querystring: { q?: string; limit?: string } }>(
  "/api/songs/search",
  async (req) => {
    const q = (req.query.q || "").trim();
    const pedido = Number(req.query.limit ?? 40);
    const limit = Math.min(Math.max(pedido > 0 ? pedido : 40, 1), 100);

    // unaccent não está garantido no Postgres; para o volume de casa a
    // comparação em SQL puro (ILIKE) já resolve o caso comum e é instantânea
    // com o índice. Acentos são tratados em JS quando há termo acentuado.
    if (!q) return { songs: [], total: 0 };
    // A dica em destaque era "unaccent": usamos a coluna search_key, que já é
    // o título sem acento e em minúsculas (preenchida ao salvar/importar).
    const termos = normalizaBusca(q).split(" ").filter(Boolean);
    if (!termos.length) return { songs: [], total: 0 };
    const where = {
      AND: termos.map((t) => ({ searchKey: { contains: t } })),
    };
    const [total, songs] = await Promise.all([
      prisma.song.count({ where }),
      prisma.song.findMany({
        where,
        orderBy: [{ playCount: "desc" }, { createdAt: "desc" }],
        take: limit,
      }),
    ]);
    return { songs: songs.map(toSavedSong), total };
  },
);

// Save a song to library
app.post<{
  Body: { videoId: string; title?: string; addedBy?: string };
}>("/api/songs", async (req, reply) => {
  const videoId = (req.body.videoId || "").trim();
  const title = (req.body.title || "").trim() || "(sem título)";
  const addedBy = (req.body.addedBy || "").trim() || "Anônimo";

  if (!videoId) return reply.code(400).send({ error: "missing_videoId" });

  const song = await addSongToLibrary(videoId, title, addedBy);
  // mantém a busca funcionando também para músicas adicionadas na mão
  await prisma.song
    .update({
      where: { videoId },
      data: { searchKey: normalizaBusca(title) },
    })
    .catch(() => {});
  return { ok: true, song };
});

// Importa o catálogo em bloco (24 mil músicas de uma vez).
// O app não pula as que já existem: `createMany({skipDuplicates})` resolve em
// UMA consulta, em vez de 24 mil idas e voltas ao banco.
app.post<{
  Body: {
    musicas?: { videoId?: string; title?: string; artist?: string }[];
    addedBy?: string;
    /** reescreve o título de quem já existia (ex.: catálogo reenriquecido) */
    atualizar?: boolean;
  };
}>(
  "/api/songs/import",
  // catálogo de 24 mil músicas passa de 1 MB (limite padrão do Fastify)
  { bodyLimit: 40 * 1024 * 1024 },
  async (req, reply) => {
    const lista = Array.isArray(req.body?.musicas) ? req.body.musicas : [];
    if (!lista.length)
      return reply.code(400).send({ error: "missing_musicas" });
    const addedBy = (req.body?.addedBy || "").trim() || "Catálogo";

    const vistos = new Set<string>();
    const linhas: {
      videoId: string;
      title: string;
      searchKey: string;
      addedBy: string;
    }[] = [];
    for (const m of lista) {
      const videoId = (m?.videoId || "").trim();
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || vistos.has(videoId)) continue;
      vistos.add(videoId);
      const titulo = (m?.title || "").trim() || videoId;
      const artista = (m?.artist || "").trim();
      // a biblioteca tem um campo só: "Artista — Título" faz a busca achar os dois
      const tituloFinal =
        artista && !titulo.toLowerCase().startsWith(artista.toLowerCase())
          ? `${artista} — ${titulo}`
          : titulo;
      linhas.push({
        videoId,
        title: tituloFinal,
        searchKey: normalizaBusca(tituloFinal),
        addedBy,
      });
    }
    if (!linhas.length)
      return reply.code(400).send({ error: "no_valid_songs" });

    const antes = await prisma.song.count();
    // em lotes, para não estourar o limite de parâmetros do Postgres
    let inseridas = 0;
    let atualizadas = 0;
    for (let i = 0; i < linhas.length; i += 1000) {
      const lote = linhas.slice(i, i + 1000);
      if (req.body.atualizar) {
        // catálogo reenriquecido: renomeia no lugar quem já existe
        atualizadas += await upsertCatalogoRenomeando(lote);
      }
      const r = await prisma.song.createMany({ data: lote, skipDuplicates: true });
      inseridas += r.count;
    }
    const total = await prisma.song.count();
    return {
      ok: true,
      recebidas: lista.length,
      validas: linhas.length,
      inseridas,
      atualizadas,
      ja_existiam: linhas.length - inseridas,
      biblioteca: total,
      antes,
    };
  },
);

// Delete a song from library (by videoId now, not id)
app.delete<{ Params: { songId: string } }>(
  "/api/songs/:songId",
  async (req, reply) => {
    const songId = req.params.songId;

    // Try to find by id first, then by videoId
    const deleted = await removeSongFromLibrary(songId);
    if (!deleted) return reply.code(404).send({ error: "not_found" });

    return { ok: true };
  },
);

// ─────────────────────────────────────────────────────────────
// Analytics Endpoints (simplified)
// ─────────────────────────────────────────────────────────────

// Top songs (from database)
app.get<{ Querystring: { limit?: string; key?: string } }>(
  "/api/analytics/top-songs",
  async (req) => {
    const limit = parseInt(req.query.limit || "20", 10);
    const songs = await getTopSongsFromDb(limit);
    return {
      topSongs: songs.map((s) => ({
        videoId: s.videoId,
        title: s.title,
        playCount: s.playCount,
      })),
    };
  },
);

// Active rooms (admin only)
app.get<{ Querystring: { key?: string } }>(
  "/api/analytics/active-rooms",
  async (req, reply) => {
    const key = req.query.key;
    if (!key || key !== process.env.ADMIN_KEY) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const activeRooms = Array.from(rooms.entries()).map(([code, room]) => {
      const conns = connections.get(code);
      return {
        code,
        createdAt: room.createdAt,
        queueLength: room.queue.length,
        nowPlaying: room.nowPlaying?.title || null,
        participantsCount: conns?.participants.size || 0,
      };
    });

    return { activeRooms };
  },
);

// WebSocket
app.get<{ Params: { roomCode: string } }>(
  "/ws/:roomCode",
  { websocket: true },
  (socket, req) => {
    const roomCode = req.params.roomCode;
    const room = rooms.get(roomCode);
    let role: "tv" | "mobile" = "mobile";
    let name = "";
    let odUserId = "";

    if (!room) {
      socket.send(JSON.stringify({ type: "ERROR", error: "room_not_found" }));
      socket.close();
      return;
    }

    socket.on("message", (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "HELLO") {
          const conns = connections.get(roomCode)!;
          touchRoom(roomCode); // Marca atividade na sala

          // New auth flow: token-based
          if (msg.token) {
            const payload = verifyToken(msg.token);

            if (!payload) {
              socket.send(
                JSON.stringify({
                  type: "ERROR",
                  error: "invalid_token",
                  message: "Token inválido ou expirado",
                }),
              );
              socket.close();
              return;
            }

            if (payload.type === "tv") {
              // TV token
              if (payload.roomCode !== roomCode) {
                socket.send(
                  JSON.stringify({
                    type: "ERROR",
                    error: "wrong_room",
                    message: "Token não é válido para esta sala",
                  }),
                );
                socket.close();
                return;
              }
              role = "tv";
              name = "TV";
              odUserId = `tv_${roomCode}`;
              conns.tv.add(socket);
            } else if (payload.type === "user") {
              // User token (mobile)
              role = "mobile";
              odUserId = payload.userId;

              // Use the name from HELLO message (current nickname) if provided,
              // otherwise fall back to name from token (original registered name)
              const requestedName = msg.name || payload.name;

              // Get unique nickname (auto-number if duplicate)
              name = getUniqueNickname(roomCode, requestedName, odUserId);

              conns.mobile.add(socket);
              conns.participants.set(socket, { id: odUserId, name });
              conns.recentParticipants.delete(odUserId);

              // Send the assigned nickname back to the user
              // wasModified is true only if server changed the requested name
              socket.send(
                JSON.stringify({
                  type: "NICKNAME_ASSIGNED",
                  nickname: name,
                  originalName: requestedName,
                  wasModified: name !== requestedName,
                }),
              );

              broadcastParticipants(roomCode);

              // Record room visit (async, don't wait)
              recordRoomVisit(roomCode, odUserId).catch(() => {});
            }
          } else {
            // Legacy flow: no token (for users without accounts yet)
            role = msg.role === "tv" ? "tv" : "mobile";
            name = msg.name || "";
            odUserId = msg.userId || `anon_${randomId()}`;

            if (role === "mobile" && name) {
              // Get unique nickname (auto-number if duplicate)
              const originalName = name;
              name = getUniqueNickname(roomCode, name, odUserId);

              if (name !== originalName) {
                socket.send(
                  JSON.stringify({
                    type: "NICKNAME_ASSIGNED",
                    nickname: name,
                    originalName,
                    wasModified: true,
                  }),
                );
              }
            }

            if (role === "tv") {
              conns.tv.add(socket);
            } else {
              conns.mobile.add(socket);
              if (name && odUserId) {
                conns.participants.set(socket, { id: odUserId, name });
                conns.recentParticipants.delete(odUserId);
                broadcastParticipants(roomCode);
              }
            }
          }

          socket.send(
            JSON.stringify({ type: "HELLO", roomCode, role, name, odUserId }),
          );
          socket.send(
            JSON.stringify({ type: "STATE", state: getRoomState(room) }),
          );
          socket.send(
            JSON.stringify({
              type: "PARTICIPANTS",
              participants: getParticipantsList(roomCode),
            }),
          );
        } else {
          socket.send(JSON.stringify({ type: "ACK" }));
        }
      } catch {
        // ignore
      }
    });

    socket.on("close", () => {
      const conns = connections.get(roomCode);
      if (conns) {
        // Get info before removing from participants
        const participantInfo = conns.participants.get(socket);

        conns.tv.delete(socket);
        conns.mobile.delete(socket);
        conns.participants.delete(socket);

        // Add to recentParticipants with current timestamp (for offline < 1h feature)
        if (participantInfo) {
          conns.recentParticipants.set(participantInfo.id, {
            name: participantInfo.name,
            lastSeen: Date.now(),
          });
          // Broadcast updated participants list
          broadcastParticipants(roomCode);
        }
      }
    });
  },
);

// Start
const PORT = parseInt(process.env.PORT || "8787", 10);
app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`🎤 Karaokêando backend running on http://localhost:${PORT}`);

  // biblioteca antiga (de antes da busca sem acento) ganha a chave de busca
  backfillSearchKeys()
    .then((n) => {
      if (n > 0) console.log(`🔎 Índice de busca atualizado em ${n} músicas.`);
    })
    .catch((err) => app.log.error(err));
});
