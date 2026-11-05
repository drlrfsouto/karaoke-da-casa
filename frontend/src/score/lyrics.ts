import type { VoiceEngine } from "./voice";

/**
 * Letra sincronizada (LRC) para as músicas do YouTube.
 *
 * Fonte: LRCLIB (https://lrclib.net) — base aberta, sem chave de API.
 * Estratégia em camadas, do mais preciso ao mais tolerante:
 *   1. `/api/get` com o nome do canal + título limpo;
 *   2. `/api/get` com título limpo;
 *   3. `/api/search` com o título e uso do primeiro resultado com LRC;
 *   4. `/api/search` só com as palavras principais.
 *
 * Se nada vier sincronizado, cai para a busca de letra simples (lyrics.ovh)
 * exibida em blocos — melhor que nada na tela da TV.
 *
 * O resultado fica em cache no localStorage para não repetir a busca.
 */

export type LyricLine = { t: number; text: string };
export type LyricsResult = {
  lines: LyricLine[];
  synced: boolean;
  title?: string;
  artist?: string;
  source: "lrclib" | "ovh" | "cache";
};

const CACHE_KEY = "karaokeando.lyrics.v1";
const MAX_CACHE = 400;

type Cache = Record<string, LyricsResult>;

function readCache(): Cache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") as Cache;
  } catch {
    return {};
  }
}

function writeCache(videoId: string, res: LyricsResult) {
  try {
    const c = readCache();
    c[videoId] = res;
    const keys = Object.keys(c);
    if (keys.length > MAX_CACHE) delete c[keys[0]];
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* storage cheio/indisponível: ignora */
  }
}

/** Limpa lixo comum dos títulos de karaokê do YouTube. */
export function cleanSongTitle(raw: string): string {
  return raw
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(
      /\b(karaok[eê]|karaoke\s*version|vers[aã]o\s*karaok[eê]|playback|instrumental|ao\s*vivo|lyric\s*video|letra|official|oficial|clipe|video\s*clipe|hd|hq|4k|remaster(ed)?)\b/gi,
      " "
    )
    .replace(/[|•·/\\]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Separa "Artista - Título".
 *
 * No YouTube brasileiro os DOIS formatos aparecem:
 *   "Chitãozinho e Xororó - Evidências"   (artista primeiro)
 *   "Evidências - Chitãozinho e Xororó"   (título primeiro)
 * Heurística: a parte com cara de nome de artista é a que tem "&", "e",
 * "feat", "part", banda/dupla, ou a que NÃO é a mais curta e "cantável".
 * Errar aqui só custa uma tentativa a mais de busca, então mantemos barato.
 */
export function splitArtistTitle(raw: string): { artist: string; title: string } {
  const cleaned = cleanSongTitle(raw);
  const m = cleaned.match(/^(.{2,60}?)\s+[-–—]\s+(.{2,80})$/);
  if (!m) return { artist: "", title: cleaned };
  const a = m[1].trim();
  const b = m[2].trim();
  const artistScore = (s: string) => {
    let n = 0;
    if (/\b(e|&|feat|part|ft)\b/i.test(s)) n += 2;
    if (/\b(banda|dupla|trio|grupo|mc|dj)\b/i.test(s)) n += 1;
    if (s.split(/\s+/).length >= 3) n += 1;
    return n;
  };
  return artistScore(b) > artistScore(a)
    ? { artist: b, title: a }
    : { artist: a, title: b };
}

/** Converte LRC em linhas com tempo (ignora linhas só de metadado). */
export function parseLrc(lrc: string): LyricLine[] {
  const out: { t: number; text: string }[] = [];
  const timeRe = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(timeRe)];
    if (!stamps.length) continue;
    const text = raw.replace(timeRe, "").trim();
    if (!text) continue;
    for (const s of stamps) {
      const min = Number(s[1]);
      const sec = Number(s[2]);
      const frac = s[3] ? Number(`0.${s[3]}`) : 0;
      out.push({ t: min * 60 + sec + frac, text });
    }
  }
  out.sort((a, b) => a.t - b.t);
  // remove duplicatas exatas (comum em LRC com refrão repetido)
  const dedup: LyricLine[] = [];
  for (const l of out) {
    const prev = dedup[dedup.length - 1];
    if (prev && Math.abs(prev.t - l.t) < 0.05 && prev.text === l.text) continue;
    dedup.push(l);
  }
  return dedup;
}

async function getJSON(url: string, timeoutMs = 6500): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type LrclibItem = {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  trackName?: string;
  artistName?: string;
  duration?: number;
};

/** Pontua como um candidato combina com o vídeo (quanto maior, melhor). */
function candidateScore(
  item: LrclibItem,
  opts: { artist: string; title: string; duration?: number }
): number {
  let score = 0;
  const dur = item.duration || 0;
  if (opts.duration && dur > 0) {
    const diff = Math.abs(dur - opts.duration);
    if (diff <= 3) score += 6;
    else if (diff <= 8) score += 4;
    else if (diff <= 15) score += 2;
    else if (diff > 40) score -= 6; // versão/estúdio diferente
  }
  const norm = (t: string) =>
    t
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  const want = new Set(norm(opts.title));
  const got = new Set(norm(item.trackName || ""));
  let overlap = 0;
  want.forEach(w => {
    if (got.has(w)) overlap++;
  });
  score += (overlap / Math.max(1, want.size)) * 3;
  if (opts.artist) {
    const aWant = new Set(norm(opts.artist));
    const aGot = new Set(norm(item.artistName || ""));
    let ao = 0;
    aWant.forEach(w => {
      if (aGot.has(w)) ao++;
    });
    score += (ao / Math.max(1, aWant.size)) * 2;
  }
  return score;
}

function toResult(item: LrclibItem | null, source: LyricsResult["source"]) {
  if (!item) return null;
  if (item.syncedLyrics) {
    const lines = parseLrc(item.syncedLyrics);
    if (lines.length > 3) {
      return {
        lines,
        synced: true,
        title: item.trackName,
        artist: item.artistName,
        source,
      } satisfies LyricsResult;
    }
  }
  return null;
}

export async function getLyrics(
  videoId: string,
  rawTitle?: string,
  duration?: number
): Promise<LyricsResult | null> {
  const cached = readCache()[videoId];
  if (cached) return { ...cached, source: "cache" };

  const { artist, title } = splitArtistTitle(rawTitle || "");
  const withArtist = artist
    ? `https://lrclib.net/api/get?artist_name=${encodeURIComponent(
        artist
      )}&track_name=${encodeURIComponent(title)}`
    : "";
  const byTitle = `https://lrclib.net/api/get?track_name=${encodeURIComponent(
    title || rawTitle || ""
  )}`;
  const bySearch = `https://lrclib.net/api/search?q=${encodeURIComponent(
    [artist, title].filter(Boolean).join(" ") || rawTitle || ""
  )}`;
  const byLoose = `https://lrclib.net/api/search?q=${encodeURIComponent(
    (title || rawTitle || "").split(/\s+/).slice(0, 4).join(" ")
  )}`;

  const attempts: { url: string; kind: "get" | "search" }[] = [
    ...(withArtist ? [{ url: withArtist, kind: "get" as const }] : []),
    { url: byTitle, kind: "get" },
    { url: bySearch, kind: "search" },
    { url: byLoose, kind: "search" },
  ];

  for (const a of attempts) {
    const data = await getJSON(a.url);
    if (!data) continue;
    if (a.kind === "get") {
      const r = toResult(data as LrclibItem, "lrclib");
      if (r) {
        writeCache(videoId, r);
        return r;
      }
    } else if (Array.isArray(data)) {
      const list = (data as LrclibItem[]).filter(x => x.syncedLyrics);
      if (!list.length) continue;
      // escolhe a versão que casa melhor (duração do vídeo + nome do artista)
      const ranked = list
        .map(item => ({
          item,
          score: candidateScore(item, { artist, title, duration }),
        }))
        .sort((a, b) => b.score - a.score);
      const r = toResult(ranked[0].item, "lrclib");
      if (r) {
        writeCache(videoId, r);
        return r;
      }
    }
  }

  // última tentativa: letra simples, exibida em blocos
  const ovh = (await getJSON(
    `https://api.lyrics.ovh/v1/${encodeURIComponent(artist || "")}/${encodeURIComponent(
      title || rawTitle || ""
    )}`
  )) as { lyrics?: string } | null;
  if (ovh?.lyrics) {
    const chunks = ovh.lyrics
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);
    if (chunks.length) {
      // distribui no tempo (não é sincronizado de verdade, mas orienta)
      const step = 6;
      const lines = chunks.map((text, i) => ({ t: i * step, text }));
      const r: LyricsResult = {
        lines,
        synced: false,
        title,
        artist,
        source: "ovh",
      };
      writeCache(videoId, r);
      return r;
    }
  }
  return null;
}

/** Utilidades expostas para depuração no console da TV. */
export const lyricsDebug = { cleanSongTitle, splitArtistTitle, parseLrc };

export type { VoiceEngine };
