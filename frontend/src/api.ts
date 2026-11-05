// Verifica se é um IP de rede local (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
function isPrivateIP(hostname: string): boolean {
  return (
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
  );
}

// Em dev na rede local, conecta direto no backend. Caso contrário, URL relativa ou variável de ambiente.
export const API_BASE =
  import.meta.env.VITE_API_URL ||
  (isPrivateIP(window.location.hostname)
    ? `http://${window.location.hostname}:8787`
    : "");

// ─────────────────────────────────────────────────────────────
// YouTube Search
// ─────────────────────────────────────────────────────────────

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
}

export async function searchYouTube(
  query: string
): Promise<YouTubeSearchResult[]> {
  const res = await fetch(
    `${API_BASE}/api/youtube/search?q=${encodeURIComponent(query)}`
  );
  if (!res.ok) return [];
  return res.json();
}

export async function getVideoInfo(
  videoId: string
): Promise<YouTubeSearchResult> {
  const res = await fetch(
    `${API_BASE}/api/youtube/info?videoId=${encodeURIComponent(videoId)}`
  );
  if (!res.ok) {
    return {
      videoId,
      title: "",
      thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      channelTitle: "",
    };
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────
// Room API
// ─────────────────────────────────────────────────────────────

export async function createRoom(): Promise<{ roomCode: string }> {
  const res = await fetch(`${API_BASE}/api/rooms`, { method: "POST" });
  return res.json();
}

export async function getState(roomCode: string) {
  const res = await fetch(`${API_BASE}/api/rooms/${roomCode}/state`);
  return res.json();
}

export interface ParticipantInfo {
  id: string;
  name: string;
}

export async function getParticipants(
  roomCode: string
): Promise<{ participants: ParticipantInfo[] }> {
  const res = await fetch(`${API_BASE}/api/rooms/${roomCode}/participants`);
  return res.json();
}

export async function enqueue(
  roomCode: string,
  videoId: string,
  title: string,
  requestedBy: string,
  partner?: string,
  userId?: string,
  partnerId?: string
) {
  const res = await fetch(`${API_BASE}/api/rooms/${roomCode}/enqueue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      videoId,
      title,
      requestedBy,
      partner,
      userId,
      partnerId,
    }),
  });
  return res.json();
}

export async function nextSong(roomCode: string) {
  const res = await fetch(`${API_BASE}/api/rooms/${roomCode}/next`, {
    method: "POST",
  });
  return res.json();
}

export interface VoiceMetricsPayload {
  voicePct: number;
  steadyPct: number;
  longestNote: number;
  range: number;
  frames: number;
}

/**
 * Finaliza a música. Se `voice` vier do motor de microfone da TV, a nota é
 * a que foi MEDIDA; sem microfone o servidor mantém o modo festa (sorteio).
 */
export async function finalizeSong(
  roomCode: string,
  requester: string,
  voice?: VoiceMetricsPayload | null
) {
  const res = await fetch(`${API_BASE}/api/rooms/${roomCode}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requester, voice: voice ?? undefined }),
  });
  return res.json();
}

export async function sendPlayerCommand(
  roomCode: string,
  action: "play" | "pause"
) {
  const res = await fetch(`${API_BASE}/api/rooms/${roomCode}/player`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  return res.json();
}

export async function updateUserName(
  roomCode: string,
  userId: string,
  newName: string
) {
  const res = await fetch(`${API_BASE}/api/rooms/${roomCode}/update-name`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, newName }),
  });
  return res.json();
}

export async function removeQueueItem(roomCode: string, itemId: string) {
  const res = await fetch(`${API_BASE}/api/rooms/${roomCode}/queue/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId }),
  });
  return res.json();
}

export async function moveQueueItem(
  roomCode: string,
  itemId: string,
  direction: "up" | "down"
) {
  const res = await fetch(`${API_BASE}/api/rooms/${roomCode}/queue/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, direction }),
  });
  return res.json();
}

export async function queueItemToTop(roomCode: string, itemId: string) {
  const res = await fetch(`${API_BASE}/api/rooms/${roomCode}/queue/to-top`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId }),
  });
  return res.json();
}

// Pula um vídeo que não pode ser tocado (não pontua)
export async function skipSong(roomCode: string, reason = "unplayable") {
  const res = await fetch(`${API_BASE}/api/rooms/${roomCode}/skip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  return res.json();
}

// Called by TV when score overlay closes
export async function scoreDone(roomCode: string) {
  const res = await fetch(`${API_BASE}/api/rooms/${roomCode}/score-done`, {
    method: "POST",
  });
  return res.json();
}

// ─────────────────────────────────────────────────────────────
// Song Library API (global, shared by all users)
// ─────────────────────────────────────────────────────────────

export interface SavedSong {
  id: string;
  videoId: string;
  title: string;
  addedBy: string;
  savedAt: number;
}

export async function getSongLibrary(): Promise<SavedSong[]> {
  const res = await fetch(`${API_BASE}/api/songs`);
  return res.json();
}

export async function saveSong(
  videoId: string,
  title: string,
  addedBy: string
): Promise<{ ok: boolean; song?: SavedSong; alreadySaved?: boolean }> {
  const res = await fetch(`${API_BASE}/api/songs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoId, title, addedBy }),
  });
  return res.json();
}

export async function deleteSong(songId: string) {
  const res = await fetch(`${API_BASE}/api/songs/${songId}`, {
    method: "DELETE",
  });
  return res.json();
}

export function connectWS(
  roomCode: string,
  role: "tv" | "mobile",
  name: string,
  onMessage: (msg: unknown) => void,
  token?: string | null
): WebSocket {
  let url = "";

  if (API_BASE) {
    // Se temos uma API_BASE definida (URL completa), usamos ela trocando http por ws
    url = API_BASE.replace(/^http/, "ws") + `/ws/${roomCode}`;
  } else {
    // Fallback relativo (mesmo domínio do frontend)
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    url = `${protocol}//${host}/ws/${roomCode}`;
  }

  const ws = new WebSocket(url);

  ws.onopen = () => {
    console.log("[WS] Connected, sending HELLO");
    ws.send(JSON.stringify({ type: "HELLO", role, name, token }));
  };

  ws.onmessage = event => {
    try {
      const msg = JSON.parse(event.data);
      onMessage(msg);
    } catch {
      // ignore
    }
  };

  ws.onerror = err => {
    console.error("[WS] Error", err);
  };

  ws.onclose = () => {};

  return ws;
}

// ─────────────────────────────────────────────────────────────
// Analytics API
// ─────────────────────────────────────────────────────────────

export interface TopSong {
  videoId: string;
  title: string;
  playCount: number;
}

export async function getTopSongs(
  limit = 20,
  period?: string
): Promise<TopSong[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (period) params.set("period", period);
  const res = await fetch(`${API_BASE}/api/analytics/top-songs?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.topSongs || [];
}

export interface ActiveRoom {
  code: string;
  createdAt: number;
  queueLength: number;
  nowPlaying: string | null;
  participantsCount: number;
}

export async function getActiveRooms(adminKey: string): Promise<ActiveRoom[]> {
  const res = await fetch(
    `${API_BASE}/api/analytics/active-rooms?key=${adminKey}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.activeRooms || [];
}
