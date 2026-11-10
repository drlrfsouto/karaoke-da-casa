import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  connectWS,
  finalizeSong,
  getState,
  moveQueueItem,
  nextSong,
  queueItemToTop,
  removeQueueItem,
  scoreDone,
  skipSong,
  openCrowdVote,
  closeCrowdVote,
} from "../api";
import ScoreOverlay from "../components/ScoreOverlay";
import { VoiceHud, useVoiceHud, voiceSummary } from "../components/VoiceHud";
import type { MicMetrics } from "../score/voice";

// Declare global YouTube IFrame API types
declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: {
          videoId: string;
          width?: string | number;
          height?: string | number;
          host?: string;
          playerVars?: Record<string, number | string>;
          events?: {
            onReady?: (e: { target: YTPlayer }) => void;
            onStateChange?: (e: { data: number; target: YTPlayer }) => void;
            onError?: (e: { data: number; target: YTPlayer }) => void;
          };
        }
      ) => YTPlayer;
      PlayerState: { ENDED: number; PLAYING: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  destroy: () => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getPlayerState: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  getIframe?: () => HTMLIFrameElement;
}

interface QueueItem {
  id: string;
  videoId: string;
  title: string;
  requestedBy: string;
  singers?: { id: string; name: string }[];
}

interface DuetRankingEntry {
  names: [string, string];
  score: number;
  count: number;
}

interface RankingEntry {
  name: string;
  score: number;
}

interface CrowdState {
  open: boolean;
  count: number;
  average: number | null;
  votes: Record<string, { score: number; name: string }>;
}

interface RoomState {
  roomCode: string;
  nowPlaying: QueueItem | null;
  queue: QueueItem[];
  ranking: Record<string, RankingEntry>;
  duetRanking: DuetRankingEntry[];
  showingScore: boolean;
  crowd?: CrowdState;
}

type RankingView = "solo" | "duet";

interface FinalizedEvent {
  singer: string;
  score: number;
  title: string;
  scoring?: "microfone" | "aleatoria";
  voiceLine?: string;
}

// Icon components
const IconChevronUp = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="18 15 12 9 6 15"></polyline>
  </svg>
);

const IconChevronDown = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
);

const IconChevronsUp = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="17 11 12 6 7 11"></polyline>
    <polyline points="17 18 12 13 7 18"></polyline>
  </svg>
);

const IconTrash = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

const IconMusic = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 18V5l12-2v13"></path>
    <circle cx="6" cy="18" r="3"></circle>
    <circle cx="18" cy="16" r="3"></circle>
  </svg>
);

const IconMic = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
    <line x1="12" y1="19" x2="12" y2="23"></line>
    <line x1="8" y1="23" x2="16" y2="23"></line>
  </svg>
);

const IconX = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

const IconTrophy = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path>
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path>
    <path d="M4 22h16"></path>
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path>
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path>
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path>
  </svg>
);

const IconUsers = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
    <circle cx="9" cy="7" r="4"></circle>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
  </svg>
);

const IconUser = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>
);

const IconPlay = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
  >
    <polygon points="5 3 19 12 5 21 5 3"></polygon>
  </svg>
);

const IconSkipForward = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
  >
    <polygon points="5 4 15 12 5 20 5 4"></polygon>
    <line
      x1="19"
      y1="5"
      x2="19"
      y2="19"
      stroke="currentColor"
      strokeWidth="2"
    ></line>
  </svg>
);

export default function RoomTV() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finalized, setFinalized] = useState<FinalizedEvent | null>(null);
  const [rankingView, setRankingView] = useState<RankingView>("solo");
  const [autoRotate, setAutoRotate] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);

  // Check for tvToken on mount
  useEffect(() => {
    if (!code) return;
    const tvToken = localStorage.getItem(`tvToken_${code}`);
    if (!tvToken) {
      // Redirect to TV login page
      navigate(`/room/${code}/tv/login`);
    } else {
      setAuthChecked(true);
    }
  }, [code, navigate]);

  // Auto-rotate ranking view every 10 seconds
  useEffect(() => {
    if (!autoRotate) return;
    const interval = setInterval(() => {
      setRankingView(prev => (prev === "solo" ? "duet" : "solo"));
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRotate]);

  const handleQueueRemove = useCallback(
    async (itemId: string) => {
      if (!code) return;
      await removeQueueItem(code, itemId).catch(() => {});
    },
    [code]
  );

  const handleQueueMove = useCallback(
    async (itemId: string, direction: "up" | "down") => {
      if (!code) return;
      await moveQueueItem(code, itemId, direction).catch(() => {});
    },
    [code]
  );

  const handleQueueToTop = useCallback(
    async (itemId: string) => {
      if (!code) return;
      await queueItemToTop(code, itemId).catch(() => {});
    },
    [code]
  );
  const [ytReady, setYtReady] = useState(!!window.YT);
  const [nowTime, setNowTime] = useState(0);
  const [videoDur, setVideoDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ytFailed, setYtFailed] = useState(false);
  const [ytErrorCode, setYtErrorCode] = useState<number | null>(null);
  // o domínio do player: o nocookie às vezes é aceito quando o normal recusa
  const [playerHost, setPlayerHost] = useState<"nocookie" | "normal">("nocookie");
  // ajuste fino da letra (segundos) — salvo por vídeo no localStorage
  const [lyricShift, setLyricShift] = useState(0);


  // Truncated text with tooltip on hover
  const TruncatedText = ({
    text,
    maxLength,
    style,
  }: {
    text: string;
    maxLength: number;
    style?: React.CSSProperties;
  }) => {
    const [showTooltip, setShowTooltip] = useState(false);
    const needsTruncation = text.length > maxLength;
    const displayText = needsTruncation
      ? text.slice(0, maxLength).trim() + "..."
      : text;

    if (!needsTruncation) {
      return <span style={style}>{text}</span>;
    }

    return (
      <span
        style={{ position: "relative", cursor: "pointer", ...style }}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {displayText}
        {showTooltip && (
          <span
            style={{
              position: "absolute",
              bottom: "100%",
              left: 0,
              marginBottom: 8,
              padding: "10px 14px",
              background: "#222",
              border: "1px solid #444",
              borderRadius: 8,
              fontSize: "0.9rem",
              color: "#fff",
              whiteSpace: "normal",
              wordBreak: "break-word",
              zIndex: 1000,
              boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
              minWidth: 250,
              maxWidth: 400,
            }}
          >
            {text}
          </span>
        )}
      </span>
    );
  };

  // Derive values from state (safe even when state is null)
  const videoId = state?.nowPlaying?.videoId ?? null;
  const showScore = !!finalized;
  const songTitle = state?.nowPlaying?.title ?? "";

  // ── voz + letra sincronizada ────────────────────────────────
  // O motor de voz vive aqui na TV (é ela que tem o microfone e o player).
  const hud = useVoiceHud({
    videoId,
    time: nowTime,
    playing,
    title: songTitle,
    duration: videoDur,
  });
  const voiceStatsRef = useRef<MicMetrics | null>(null);

  /**
   * Finaliza a música mandando a nota MEDIDA no microfone.
   * Sem microfone ligado, `voice` vai nulo e o servidor usa o modo festa.
   */
  const doFinalize = useCallback(
    async (requester: string) => {
      if (!code) return;
      // fecha a votação da plateia para a média entrar na nota
      await closeCrowdVote(code).catch(() => {});
      const engine = hud.engine.current;
      const metrics = engine ? engine.metrics() : null;
      const measured =
        metrics && metrics.frames >= 8
          ? {
              voicePct: metrics.voicePct,
              steadyPct: metrics.steadyPct,
              longestNote: metrics.longestNote,
              range: metrics.range,
              frames: metrics.frames,
            }
          : null;
      voiceStatsRef.current = metrics;
      try {
        await finalizeSong(code, requester, measured);
      } catch (err) {
        console.error("[TV] finalize error", err);
      }
    },
    [code, hud.engine]
  );

  // Auto-finalize when YouTube video ends
  const handleVideoEnd = useCallback(async () => {
    setPlaying(false);
    await doFinalize("Auto");
  }, [doFinalize]);

  // Load YouTube IFrame API once
  useEffect(() => {
    if (window.YT) {
      setYtReady(true);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      setYtReady(true);
    };
    if (!document.getElementById("yt-iframe-api")) {
      const tag = document.createElement("script");
      tag.id = "yt-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  }, []);

  // Connect to room via WS + HTTP fallback
  useEffect(() => {
    if (!code || !authChecked) return;

    const tvToken = localStorage.getItem(`tvToken_${code}`);

    // Fallback: fetch state via HTTP in case WS is slow
    getState(code)
      .then(s => {
        if (s && s.error === "room_not_found") {
          setError("Sala não encontrada. Verifique o código.");
        } else if (s && !s.error) {
          setState(s);
        }
      })
      .catch(err => {
        console.error("[TV] HTTP state error", err);
      });

    const ws = connectWS(
      code,
      "tv",
      "TV",
      (msg: unknown) => {
        const m = msg as {
          type: string;
          state?: RoomState;
          singer?: string;
          score?: number;
          title?: string;
          error?: string;
          action?: string;
        };
        if (m.type === "STATE" && m.state) {
          // Don't update state while showing score to avoid re-triggering
          setFinalized(prev => {
            if (!prev) {
              setState(m.state!);
            }
            return prev;
          });
        } else if (m.type === "ERROR" && m.error === "room_not_found") {
          setError("Sala não encontrada. Verifique o código.");
        } else if (m.type === "FINALIZED") {
          const localMetrics = voiceStatsRef.current;
          setFinalized({
            singer: m.singer!,
            score: m.score!,
            title: m.title!,
            scoring:
              (m as { scoring?: "microfone" | "aleatoria" }).scoring ??
              (localMetrics ? "microfone" : "aleatoria"),
            voiceLine: [
              localMetrics ? voiceSummary(localMetrics) : "Sem microfone ligado.",
              (m as { crowdAverage?: number | null }).crowdAverage != null
                ? `Plateia: média ${(m as { crowdAverage?: number }).crowdAverage!.toFixed(1)}/10 em ${
                    (m as { crowdCount?: number }).crowdCount ?? 0
                  } voto(s) — peso 30% na nota final.`
                : "Ninguém votou pela plateia desta vez.",
            ].join(" "),
          });
        } else if (m.type === "PLAYER_COMMAND") {
          if (playerRef.current) {
            if (m.action === "play") {
              playerRef.current.playVideo();
            } else if (m.action === "pause") {
              playerRef.current.pauseVideo();
            }
          }
        }
      },
      tvToken
    );
    wsRef.current = ws;

    return () => ws.close();
  }, [code, authChecked]);

  // Ao começar uma música, abre a votação da plateia (o público vota no celular)
  useEffect(() => {
    if (!code || !videoId) return;
    void openCrowdVote(code).catch(() => {});
  }, [code, videoId]);

  // Começo de música: zera duração e libera o aviso de falha
  useEffect(() => {
    setVideoDur(0);
    setYtFailed(false);
    setYtErrorCode(null);
    if (!videoId) return;
    const saved = Number(localStorage.getItem(`lyricShift_${videoId}`) || 0);
    setLyricShift(isFinite(saved) ? saved : 0);
  }, [videoId]);

  const shiftLyrics = useCallback(
    (delta: number) => {
      setLyricShift(prev => {
        const next = Math.round((prev + delta) * 10) / 10;
        if (videoId) localStorage.setItem(`lyricShift_${videoId}`, String(next));
        return next;
      });
    },
    [videoId]
  );

  // Vigia: alguns erros (o 153, por exemplo) aparecem DENTRO do iframe sem
  // disparar onError. Se depois de 9 s o tempo do vídeo não saiu de zero,
  // tratamos como falha para o aviso e o botão de saída aparecerem.
  useEffect(() => {
    if (!videoId || ytFailed) return;
    const started = Date.now();
    const id = window.setInterval(() => {
      const pl = playerRef.current;
      if (!pl) return;
      try {
        const t = pl.getCurrentTime();
        const st = pl.getPlayerState();
        if (t > 0.5 || st === 1) {
          window.clearInterval(id);
          return;
        }
      } catch {
        /* player ainda montando */
      }
      if (Date.now() - started > 9000) {
        window.clearInterval(id);
        setYtFailed(true);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [videoId, ytFailed, playerHost]);

  // Vídeo que não toca: espera 5 s (dá tempo de ler o aviso) e passa para o próximo.
  // Trava de segurança: depois de 3 vídeos seguidos com erro, para de pular sozinho
  // (senão, se o YouTube estiver bloqueando tudo naquela rede, a fila inteira
  // seria consumida em segundos).
  const [autoSkips, setAutoSkips] = useState(0);
  useEffect(() => {
    if (!ytFailed || !code) return;
    if (autoSkips >= 3) return;
    const t = window.setTimeout(() => {
      setAutoSkips(n => n + 1);
      void skipSong(code, "unplayable").catch(() => {});
    }, 5000);
    return () => window.clearTimeout(t);
  }, [ytFailed, code, autoSkips, videoId]);

  // Relógio da música: alimenta a letra sincronizada e o HUD
  useEffect(() => {
    const id = window.setInterval(() => {
      const pl = playerRef.current;
      if (!pl) return;
      try {
        setNowTime(pl.getCurrentTime() || 0);
        const d = pl.getDuration();
        if (d && d > 5) setVideoDur(d);
        setPlaying(pl.getPlayerState() === 1);
      } catch {
        /* player ainda não pronto */
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [videoId]);

  // Create / destroy YouTube player
  useEffect(() => {
    // Cleanup old player when videoId changes or score shown
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }

    if (!ytReady || !videoId || showScore) {
      return;
    }

    // Wait a tick for the container to be rendered
    const timeoutId = setTimeout(() => {
      const container = playerContainerRef.current;
      if (!container) {
        return;
      }

      // Clear container
      container.innerHTML = "";
      const div = document.createElement("div");
      div.id = "yt-player-" + videoId;
      container.appendChild(div);

      playerRef.current = new window.YT!.Player(div.id, {
        videoId,
        width: "100%",
        height: "100%",
        host:
          playerHost === "nocookie"
            ? "https://www.youtube-nocookie.com"
            : "https://www.youtube.com",
        playerVars: {
          autoplay: 1,
          rel: 0,
          modestbranding: 1,
          start: 0,
          playsinline: 1,
          enablejsapi: 1,
          // Desde o fim de 2025 o player incorporado exige a identificação da
          // origem; sem isso o YouTube responde erro 153.
          origin: window.location.origin,
          widget_referrer: window.location.href,
        },
        events: {
          onReady: e => {
            // A API cria o iframe sem o atributo; reforçamos aqui porque o
            // YouTube exige o Referer desde o fim de 2025 (erro 153).
            try {
              const frame = (
                e.target as unknown as { getIframe?: () => HTMLIFrameElement }
              ).getIframe?.();
              if (frame) {
                frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
                frame.setAttribute(
                  "allow",
                  "autoplay; encrypted-media; picture-in-picture"
                );
              }
            } catch {
              /* sem permissão para inspecionar o iframe */
            }
            e.target.playVideo();
          },
          onStateChange: e => {
            if (e.data === window.YT!.PlayerState.ENDED) {
              handleVideoEnd();
            }
          },
          onError: e => {
            // 101/150 = dono bloqueou a incorporação | 153 = o YouTube não
            // reconheceu a origem (passou a exigir Referer no fim de 2025)
            const code = (e as { data?: number })?.data;
            setYtErrorCode(typeof code === "number" ? code : null);
            if (code === 153 || code === 150 || code === 101) {
              // uma tentativa no outro domínio antes de desistir
              setPlayerHost(h => (h === "nocookie" ? "normal" : "nocookie"));
            }
            setYtFailed(true);
          },
        },
      });
    }, 100); // Small delay to ensure DOM is ready

    return () => {
      clearTimeout(timeoutId);
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [ytReady, videoId, showScore, handleVideoEnd]);

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  // Wait for auth check
  if (!authChecked) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
        }}
      >
        <p>Verificando acesso...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="container"
        style={{ paddingTop: 60, textAlign: "center" }}
      >
        <h2
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <IconX size={24} /> {error}
        </h2>
        <p style={{ color: "#888", marginTop: 16 }}>
          Volte e crie uma nova sala.
        </p>
        <a
          href="/"
          style={{ color: "#3498db", marginTop: 20, display: "inline-block" }}
        >
          ← Voltar ao início
        </a>
      </div>
    );
  }

  if (!state) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
        }}
      >
        <div
          style={{
            fontSize: 48,
            marginBottom: 24,
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        >
          <IconMic size={64} />
        </div>
        <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 500 }}>
          Conectando à sala {code}...
        </h2>
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(0.95); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <>
      {/* ─────────────────────────────────────────────────────────────
          MODO 1: TELA CHEIA - Quando está tocando música
          ───────────────────────────────────────────────────────────── */}
      {state.nowPlaying && !showScore && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#000",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Barra superior com info da música */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              padding: "12px 20px",
              background:
                "linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)",
              zIndex: 10,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                <TruncatedText text={state.nowPlaying.title} maxLength={60} />
              </div>
              <div
                style={{
                  opacity: 0.7,
                  fontSize: "0.9rem",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <IconMic size={14} />
                {state.nowPlaying.singers
                  ?.map(s => (typeof s === "string" ? s : s.name))
                  .join(" e ") || state.nowPlaying.requestedBy}
              </div>
            </div>
            <div
              style={{ textAlign: "right", opacity: 0.6, fontSize: "0.85rem" }}
            >
              <div>Sala {code}</div>
              {state.queue.length > 0 && (
                <div>
                  Próxima:{" "}
                  {state.queue[0].singers
                    ?.map(s => (typeof s === "string" ? s : s.name))
                    .join(" e ") || state.queue[0].requestedBy}
                </div>
              )}
            </div>
          </div>

          {/* Player YouTube em tela cheia */}
          <div
            ref={playerContainerRef}
            style={{
              flex: 1,
              width: "100%",
              height: "100%",
            }}
          />

          {/* Placar da plateia ao vivo */}
          {state.crowd?.open && state.crowd.count > 0 && !showScore && (
            <div
              style={{
                position: "absolute",
                top: 96,
                right: 24,
                zIndex: 15,
                padding: "12px 16px",
                borderRadius: 14,
                background: "rgba(8,10,20,.78)",
                border: "1px solid rgba(255,64,129,.5)",
                textAlign: "center",
                minWidth: 132,
                backdropFilter: "blur(8px)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  opacity: 0.7,
                  fontWeight: 800,
                }}
              >
                Plateia
              </div>
              <div
                style={{
                  fontSize: 34,
                  fontWeight: 900,
                  fontVariantNumeric: "tabular-nums",
                  color: "#ffd166",
                  lineHeight: 1.1,
                }}
              >
                {state.crowd.average?.toFixed(1)}
              </div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {state.crowd.count} voto{state.crowd.count === 1 ? "" : "s"}
              </div>
            </div>
          )}

          {/* Vídeo não incorporável: mostra a capa e explica o que fazer */}
          {ytFailed && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 5,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 14,
                background: "rgba(0,0,0,.95)",
                textAlign: "center",
                padding: 24,
              }}
            >
              <img
                src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
                alt=""
                style={{
                  width: "min(560px, 70vw)",
                  borderRadius: 12,
                  opacity: 0.85,
                }}
              />
              <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                Este vídeo não permite ser tocado dentro de outro site
              </div>
              <div style={{ opacity: 0.75, maxWidth: 620, lineHeight: 1.45 }}>
                {ytErrorCode === 153
                  ? "Erro 153 é do YouTube: ele exige a identificação do site que incorpora o vídeo. Recarregue a página (F5) — o app já envia essa identificação. Se insistir, abra o vídeo no YouTube pelo botão abaixo e cante com a letra e o microfone daqui."
                  : "A letra e o microfone continuam funcionando. Para a festa não parar: escolha outra versão desta música no celular (a busca mostra várias) ou toque em “Pular” e siga para a próxima."}
              </div>
              <a
                href={`https://www.youtube.com/watch?v=${videoId}`}
                target="_blank"
                rel="noreferrer noopener"
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  background: "#fff",
                  color: "#000",
                  fontWeight: 700,
                  textDecoration: "none",
                  fontSize: ".95rem",
                }}
              >
                Abrir no YouTube ↗
              </a>
              {autoSkips >= 3 ? (
                <div
                  style={{
                    marginTop: 6,
                    padding: "10px 16px",
                    borderRadius: 10,
                    background: "rgba(255,193,7,.14)",
                    border: "1px solid rgba(255,193,7,.4)",
                    maxWidth: 620,
                    fontSize: ".95rem",
                  }}
                >
                  <b>Pulo automático pausado</b> depois de 3 vídeos seguidos sem
                  tocar. Pode ser a rede/rede corporativa bloqueando o YouTube:
                  aperte “Pular” manualmente ou use os pacotes MP4 na versão
                  Karaokê da Casa.
                </div>
              ) : null}
            </div>
          )}

          {/* Letra sincronizada + microfone + nota ao vivo */}
          <VoiceHud
            on={hud.on}
            toggle={hud.toggle}
            live={hud.live}
            lyrics={hud.lyrics}
            lyricsState={hud.lyricsState}
            lyricsOpen={hud.lyricsOpen}
            setLyricsOpen={hud.setLyricsOpen}
            time={hud.time}
            playing={hud.playing}
            lyricShift={lyricShift}
            onShiftLyrics={shiftLyrics}
          />

          {/* Botão de pular discreto no canto */}
          <button
            onClick={() => void doFinalize("Host")}
            style={{
              position: "absolute",
              bottom: 20,
              right: 20,
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              padding: "8px 16px",
              fontSize: "0.85rem",
              opacity: 0.5,
              transition: "opacity 0.2s",
              zIndex: 10,
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "0.5")}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Pular <IconSkipForward size={16} />
            </span>
          </button>

          {/* QR Code discreto no canto inferior esquerdo */}
          <div
            style={{
              position: "absolute",
              bottom: 16,
              left: 16,
              background: "rgba(255,255,255,0.95)",
              padding: 8,
              borderRadius: 8,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              opacity: 0.7,
              transition: "opacity 0.2s",
              zIndex: 10,
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "0.7")}
          >
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(
                window.location.origin + "/join/" + code
              )}`}
              alt="QR Code"
              loading="lazy"
              style={{ width: 80, height: 80, display: "block" }}
            />
            <div
              style={{
                color: "#000",
                fontSize: "0.65rem",
                fontWeight: 600,
                marginTop: 4,
              }}
            >
              {code}
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODO 2: LOBBY - Entre músicas (fila, ranking, QR code)
          ───────────────────────────────────────────────────────────── */}
      {!state.nowPlaying && !showScore && (
        <div
          style={{
            minHeight: "100vh",
            padding: 40,
            background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 40,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <button
                onClick={() => navigate("/")}
                style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 8,
                  padding: "8px 16px",
                  color: "#fff",
                  fontSize: "0.9rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 18l-6-6 6-6" />
                </svg>
                Sair
              </button>
              <h1
                style={{
                  margin: 0,
                  fontSize: "2rem",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <IconMic size={32} /> Karaokê - Sala {code}
              </h1>
            </div>
            <div
              style={{
                background: "white",
                padding: 16,
                borderRadius: 12,
                textAlign: "center",
              }}
            >
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(
                  window.location.origin + "/join/" + code
                )}`}
                alt="QR Code"
                loading="lazy"
                style={{
                  display: "block",
                  marginBottom: 8,
                  width: 120,
                  height: 120,
                }}
              />
              <div
                style={{ color: "#000", fontSize: "0.8rem", fontWeight: 600 }}
              >
                Escaneie para entrar
              </div>
            </div>
          </div>

          {/* Conteúdo principal */}
          <div
            style={{
              flex: 1,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 40,
              alignItems: "start",
            }}
          >
            {/* Próxima música / Fila */}
            <div>
              {state.queue.length > 0 ? (
                <>
                  <div
                    style={{
                      background:
                        "linear-gradient(135deg, #7c4dff 0%, #ff4081 100%)",
                      borderRadius: 16,
                      padding: 32,
                      marginBottom: 24,
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "1rem",
                        opacity: 0.9,
                        marginBottom: 8,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <IconMusic size={16} /> Próxima música
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "1.8rem",
                        fontWeight: 700,
                        marginBottom: 12,
                      }}
                    >
                      {state.queue[0].title}
                    </div>
                    <div
                      style={{
                        fontSize: "1.2rem",
                        opacity: 0.9,
                        marginBottom: 24,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                      }}
                    >
                      <IconMic size={20} />
                      {state.queue[0].singers
                        ?.map(s => (typeof s === "string" ? s : s.name))
                        .join(" e ") || state.queue[0].requestedBy}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 12,
                        justifyContent: "center",
                      }}
                    >
                      <button
                        onClick={() => code && nextSong(code)}
                        style={{
                          background: "white",
                          color: "#7c4dff",
                          fontSize: "1.3rem",
                          padding: "16px 48px",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <IconPlay size={20} /> Começar!
                      </button>
                      <button
                        onClick={() => handleQueueRemove(state.queue[0].id)}
                        style={{
                          background: "rgba(255,255,255,0.15)",
                          padding: "16px 22px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        title="Remover da fila"
                      >
                        <IconTrash size={24} />
                      </button>
                    </div>
                  </div>

                  {state.queue.length > 1 && (
                    <div className="card" style={{ padding: 20 }}>
                      <h3 style={{ margin: "0 0 16px", fontSize: "1.1rem" }}>
                        Na fila ({state.queue.length - 1} mais)
                      </h3>
                      {state.queue.slice(1, 6).map((item, i) => (
                        <div
                          key={item.id}
                          style={{
                            padding: "10px 0",
                            borderBottom:
                              i < Math.min(state.queue.length - 2, 4)
                                ? "1px solid #333"
                                : "none",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                          }}
                        >
                          <span style={{ flex: 1 }}>
                            <TruncatedText text={item.title} maxLength={40} />
                          </span>
                          <span style={{ color: "#888", whiteSpace: "nowrap" }}>
                            {item.singers
                              ?.map(s => (typeof s === "string" ? s : s.name))
                              .join(" e ") || item.requestedBy}
                          </span>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button
                              onClick={() => handleQueueMove(item.id, "up")}
                              style={{
                                padding: "6px 8px",
                                background: "#333",
                                display: "flex",
                                alignItems: "center",
                              }}
                              title="Subir"
                            >
                              <IconChevronUp />
                            </button>
                            <button
                              onClick={() => handleQueueMove(item.id, "down")}
                              style={{
                                padding: "6px 8px",
                                background: "#333",
                                display: "flex",
                                alignItems: "center",
                              }}
                              title="Descer"
                            >
                              <IconChevronDown />
                            </button>
                            <button
                              onClick={() => handleQueueToTop(item.id)}
                              style={{
                                padding: "6px 8px",
                                background: "#333",
                                display: "flex",
                                alignItems: "center",
                              }}
                              title="Mover para o topo"
                            >
                              <IconChevronsUp />
                            </button>
                            <button
                              onClick={() => handleQueueRemove(item.id)}
                              style={{
                                padding: "6px 8px",
                                background: "rgba(180,60,60,0.9)",
                                display: "flex",
                                alignItems: "center",
                              }}
                              title="Remover"
                            >
                              <IconTrash />
                            </button>
                          </div>
                        </div>
                      ))}
                      {state.queue.length > 6 && (
                        <div style={{ color: "#888", marginTop: 8 }}>
                          ... e mais {state.queue.length - 6}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div
                  className="card"
                  style={{
                    padding: 48,
                    textAlign: "center",
                    background: "rgba(255,255,255,0.05)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "4rem",
                      marginBottom: 16,
                      display: "flex",
                      justifyContent: "center",
                    }}
                  >
                    <IconMusic size={64} />
                  </div>
                  <h2 style={{ margin: "0 0 12px" }}>Fila vazia</h2>
                  <p style={{ color: "#888", fontSize: "1.1rem" }}>
                    Escaneie o QR code e adicione músicas!
                  </p>
                </div>
              )}
            </div>

            {/* Ranking */}
            <div className="card" style={{ padding: 24 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 20,
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    fontSize: "1.5rem",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <IconTrophy size={28} /> Ranking
                </h2>
                {/* Toggle Solo/Duplas */}
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    background: "#222",
                    borderRadius: 8,
                    padding: 4,
                  }}
                >
                  <button
                    onClick={() => {
                      setRankingView("solo");
                      setAutoRotate(false);
                    }}
                    style={{
                      padding: "6px 12px",
                      background:
                        rankingView === "solo" ? "#ff4081" : "transparent",
                      border: "none",
                      borderRadius: 6,
                      color: "#fff",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      cursor: "pointer",
                    }}
                  >
                    <IconUser size={14} /> Solo
                  </button>
                  <button
                    onClick={() => {
                      setRankingView("duet");
                      setAutoRotate(false);
                    }}
                    style={{
                      padding: "6px 12px",
                      background:
                        rankingView === "duet" ? "#ff4081" : "transparent",
                      border: "none",
                      borderRadius: 6,
                      color: "#fff",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      cursor: "pointer",
                    }}
                  >
                    <IconUsers size={14} /> Duplas
                  </button>
                </div>
              </div>

              {rankingView === "solo" ? (
                // Solo ranking
                Object.keys(state.ranking).length === 0 ? (
                  <p style={{ color: "#888", fontSize: "1.1rem" }}>
                    Ninguém pontuou ainda.
                    <br />
                    Cante uma música para aparecer aqui!
                  </p>
                ) : (
                  <div>
                    {Object.entries(state.ranking)
                      .sort(([, a], [, b]) => b.score - a.score)
                      .map(([odUserId, entry], i) => (
                        <div
                          key={odUserId}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "12px 0",
                            borderBottom: "1px solid #333",
                            fontSize: i < 3 ? "1.2rem" : "1rem",
                          }}
                        >
                          <span
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                            }}
                          >
                            <span
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: "50%",
                                background:
                                  i === 0
                                    ? "#f1c40f"
                                    : i === 1
                                    ? "#bdc3c7"
                                    : i === 2
                                    ? "#cd6133"
                                    : "#555",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "0.85rem",
                                fontWeight: 700,
                              }}
                            >
                              {i + 1}
                            </span>
                            {entry.name}
                          </span>
                          <span
                            style={{
                              fontWeight: 700,
                              color: i === 0 ? "#ffd700" : "inherit",
                            }}
                          >
                            {entry.score} pts
                          </span>
                        </div>
                      ))}
                  </div>
                )
              ) : // Duet ranking
              !state.duetRanking || state.duetRanking.length === 0 ? (
                <p style={{ color: "#888", fontSize: "1.1rem" }}>
                  Nenhuma dupla pontuou ainda.
                  <br />
                  Cante em dupla para aparecer aqui!
                </p>
              ) : (
                <div>
                  {[...state.duetRanking]
                    .sort((a, b) => b.score - a.score)
                    .map((duet, i) => (
                      <div
                        key={duet.names.join("-")}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "12px 0",
                          borderBottom: "1px solid #333",
                          fontSize: i < 3 ? "1.2rem" : "1rem",
                        }}
                      >
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <span
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: "50%",
                              background:
                                i === 0
                                  ? "#f1c40f"
                                  : i === 1
                                  ? "#bdc3c7"
                                  : i === 2
                                  ? "#cd6133"
                                  : "#555",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "0.85rem",
                              fontWeight: 700,
                            }}
                          >
                            {i + 1}
                          </span>
                          {duet.names[0]} & {duet.names[1]}
                        </span>
                        <span
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-end",
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 700,
                              color: i === 0 ? "#ffd700" : "inherit",
                            }}
                          >
                            {duet.score} pts
                          </span>
                          <span style={{ fontSize: "0.8rem", color: "#888" }}>
                            {duet.count} música{duet.count > 1 ? "s" : ""}
                          </span>
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Score Overlay (aparece após cada música) */}
      <ScoreOverlay
        open={!!finalized}
        scoreOverride={finalized?.score}
        singer={finalized?.singer}
        note={finalized?.voiceLine}
        enableAudio={true}
        onDone={async () => {
          setFinalized(null);
          if (code) {
            // Fetch latest state since we ignored updates during score
            try {
              const s = await getState(code);
              if (s && !s.error) setState(s);
            } catch {}
            scoreDone(code);
          }
        }}
      />
    </>
  );
}
