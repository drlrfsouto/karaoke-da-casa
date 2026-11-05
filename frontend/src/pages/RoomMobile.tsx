import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth, getToken } from "../context/AuthContext";
import {
  connectWS,
  enqueue,
  getState,
  getParticipants,
  getSongLibrary,
  getTopSongs,
  deleteSong,
  sendPlayerCommand,
  nextSong,
  finalizeSong,
  searchYouTube,
  getVideoInfo,
  updateUserName,
  type SavedSong,
  type TopSong,
  type YouTubeSearchResult,
} from "../api";

interface Singer {
  id: string;
  name: string;
}

interface QueueItem {
  id: string;
  videoId: string;
  title: string;
  requestedBy: string;
  singers?: Singer[];
}

interface DuetRankingEntry {
  names: [string, string];
  score: number;
  count: number;
}

interface ParticipantInfo {
  id: string;
  name: string;
}

interface RankingEntry {
  name: string;
  score: number;
}

interface RoomState {
  roomCode: string;
  nowPlaying: QueueItem | null;
  queue: QueueItem[];
  ranking: Record<string, RankingEntry>;
  duetRanking: DuetRankingEntry[];
  showingScore: boolean;
}

type Tab = "queue" | "ranking" | "saved";
type RankingView = "solo" | "duet";

// Icon components
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

const IconPlus = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
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

const IconSearch = ({ size = 16 }: { size?: number }) => (
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
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

const IconEdit = ({ size = 16 }: { size?: number }) => (
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
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
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

const IconPause = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
  >
    <rect x="6" y="4" width="4" height="16"></rect>
    <rect x="14" y="4" width="4" height="16"></rect>
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

const IconTrendingUp = ({ size = 16 }: { size?: number }) => (
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
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
    <polyline points="17 6 23 6 23 12"></polyline>
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

const IconLibrary = ({ size = 16 }: { size?: number }) => (
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
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
  </svg>
);

// Truncated text with tooltip on click/tap
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
      onClick={e => {
        e.stopPropagation();
        setShowTooltip(!showTooltip);
      }}
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
            right: 0,
            marginBottom: 8,
            padding: "8px 12px",
            background: "#333",
            border: "1px solid #555",
            borderRadius: 8,
            fontSize: "0.85rem",
            color: "#fff",
            whiteSpace: "normal",
            wordBreak: "break-word",
            zIndex: 100,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            minWidth: 200,
            maxWidth: 280,
          }}
          onClick={e => e.stopPropagation()}
        >
          {text}
        </span>
      )}
    </span>
  );
};

export default function RoomMobile() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("queue");
  const [rankingView, setRankingView] = useState<RankingView>("solo");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<YouTubeSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState(""); // For when pasting a link
  const [adding, setAdding] = useState<string | null>(null); // videoId being added
  const [songLibrary, setSongLibrary] = useState<SavedSong[]>([]);
  const [savedFilter, setSavedFilter] = useState("");
  const [previewVideo, setPreviewVideo] = useState<YouTubeSearchResult | null>(
    null
  );
  const [showAllQueue, setShowAllQueue] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true); // Assume playing when song starts
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [topSongs, setTopSongs] = useState<TopSong[]>([]);
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [nickname, setNickname] = useState<string>(""); // Apelido na sala (pode ser diferente do nome cadastrado)
  const [toast, setToast] = useState<string | null>(null); // Temporary notification
  // Modal para adicionar música (escolher solo/dueto)
  const [addSongModal, setAddSongModal] = useState<{
    videoId: string;
    title: string;
    source: "search" | "library" | "top";
  } | null>(null);
  const [modalPartner, setModalPartner] = useState<string>(""); // Partner ID selected in modal
  const wsRef = useRef<WebSocket | null>(null);

  // Check auth on mount
  useEffect(() => {
    if (!authLoading && !user && code) {
      // Redirect to guest register with this room code
      navigate(`/guest-register?redirect=${code}`);
    }
  }, [authLoading, user, code, navigate]);

  // Initialize nickname from user name (will be updated by server if duplicate)
  useEffect(() => {
    if (user?.name && !nickname) {
      setNickname(user.name);
    }
  }, [user?.name, nickname]);

  const myUserId = user?.id || "";

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (trimmed && code) {
      try {
        const result = await updateUserName(code, myUserId, trimmed);
        if (result.error === "duplicate_name") {
          setNameError(result.message || "Este nome já está sendo usado.");
          return;
        }
        // Update local nickname
        setNickname(trimmed);
        setShowNameModal(false);
        setNameError(null);

        // Reconnect WebSocket with new name
        if (wsRef.current) {
          wsRef.current.close();
        }
      } catch (e) {
        console.error("Failed to update name on server", e);
      }
    }
  };

  // Load song library and top songs on mount
  useEffect(() => {
    getSongLibrary()
      .then(setSongLibrary)
      .catch(() => {});
    getTopSongs(10)
      .then(setTopSongs)
      .catch(() => {});
  }, []);

  // Salvar última sala visitada
  useEffect(() => {
    if (code) {
      localStorage.setItem("karaokeando_last_room", code);
    }
  }, [code]);

  useEffect(() => {
    if (!code || !user) return;

    const token = getToken();

    // Fallback: fetch state via HTTP in case WS is slow
    getState(code)
      .then(s => {
        if (s && s.error === "room_not_found") {
          setError("Sala não encontrada. Verifique o código.");
        } else if (s && !s.error) {
          setState(s);
        }
      })
      .catch(() => {});

    const ws = connectWS(
      code,
      "mobile",
      nickname || user?.name || "",
      (msg: unknown) => {
        const m = msg as {
          type: string;
          state?: RoomState;
          error?: string;
          message?: string;
          participants?: ParticipantInfo[];
          nickname?: string;
          originalName?: string;
          wasModified?: boolean;
        };
        if (m.type === "STATE" && m.state) {
          setState(prev => {
            // Reset isPlaying when a new song starts
            if (m.state!.nowPlaying?.id !== prev?.nowPlaying?.id) {
              setIsPlaying(true);
            }
            return m.state!;
          });
        } else if (m.type === "PARTICIPANTS" && m.participants) {
          setParticipants(m.participants);
        } else if (m.type === "NICKNAME_ASSIGNED" && m.nickname) {
          setNickname(m.nickname);
          if (m.wasModified) {
            // Show a brief toast notification that name was changed
            setToast(
              `Seu apelido é "${m.nickname}" (já havia alguém com seu nome)`
            );
            // Clear the toast after 5 seconds
            setTimeout(() => setToast(null), 5000);
          }
        } else if (m.type === "ERROR" && m.error === "room_not_found") {
          setError("Sala não encontrada. Verifique o código.");
        } else if (m.type === "ERROR" && m.error === "duplicate_name") {
          setError(
            m.message || "Este nome já está sendo usado. Escolha outro."
          );
        }
        // FINALIZED is now only handled by TV - mobile ignores it
      },
      token
    );
    wsRef.current = ws;

    return () => ws.close();
  }, [code, user, nickname]);

  // Fetch participants once on mount (WebSocket will keep it updated)
  useEffect(() => {
    if (!code) return;
    getParticipants(code)
      .then(data => {
        if (data.participants) {
          setParticipants(data.participants);
        }
      })
      .catch(() => {});
  }, [code]);

  // Refresh song library when tab changes to saved
  useEffect(() => {
    if (tab === "saved") {
      getSongLibrary()
        .then(setSongLibrary)
        .catch(() => {});
    }
  }, [tab]);

  // Extract video ID from YouTube URL or return null
  const extractVideoId = (input: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/, // Just the ID
    ];
    for (const p of patterns) {
      const m = input.trim().match(p);
      if (m) return m[1];
    }
    return null;
  };

  // Check if current input looks like a YouTube link
  const isLinkMode = extractVideoId(searchQuery) !== null;

  // Filter library songs that match query
  const matchingLibrarySongs = searchQuery.trim()
    ? songLibrary.filter(song =>
        song.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (!query) return;

    setSearchError(null);
    setSearching(true);

    // Check if it's a YouTube link
    const videoId = extractVideoId(query);
    if (videoId) {
      // It's a link - fetch video info from YouTube
      try {
        const info = await getVideoInfo(videoId);
        setSearchResults([
          {
            videoId,
            title: info.title || `YouTube Video (${videoId})`,
            thumbnail: info.thumbnail,
            channelTitle: info.channelTitle || "Link colado",
          },
        ]);
        // Pre-fill custom title if we got one
        if (info.title && !customTitle) {
          setCustomTitle(info.title);
        }
      } catch {
        // Fallback if API fails
        setSearchResults([
          {
            videoId,
            title: `YouTube Video (${videoId})`,
            thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
            channelTitle: "Link colado",
          },
        ]);
      }
      setSearching(false);
      return;
    }

    // If there are matching library songs, don't search YouTube yet
    // User can click "Buscar no YouTube" if they want more results
    if (matchingLibrarySongs.length > 0) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    // No saved songs match - search YouTube
    setSearchResults([]);
    try {
      const results = await searchYouTube(query);
      if (results.length === 0) {
        setSearchError(
          "Nenhum resultado encontrado. Tente outro termo ou cole o link do YouTube."
        );
      }
      setSearchResults(results);
    } catch (err) {
      console.error("Search error:", err);
      setSearchError(
        "Erro na busca. Tente novamente ou cole o link do YouTube."
      );
    }
    setSearching(false);
  };

  const handleSearchYouTube = async () => {
    const query = searchQuery.trim();
    if (!query) return;

    setSearchError(null);
    setSearching(true);
    setSearchResults([]);

    try {
      const results = await searchYouTube(query);
      if (results.length === 0) {
        setSearchError("Nenhum resultado encontrado no YouTube.");
      }
      setSearchResults(results);
    } catch {
      setSearchError("Erro na busca. Tente novamente.");
    }
    setSearching(false);
  };

  // Opens modal to choose solo/duet for search result
  const handleAddFromSearch = (result: YouTubeSearchResult) => {
    const title =
      isLinkMode && customTitle.trim() ? customTitle.trim() : result.title;
    openAddSongModal(result.videoId, title, "search");
  };

  const handleDeleteSaved = async (songId: string) => {
    await deleteSong(songId);
    setSongLibrary(prev => prev.filter(s => s.id !== songId));
  };

  // Abre o modal para escolher solo/dueto
  const openAddSongModal = (
    videoId: string,
    title: string,
    source: "search" | "library" | "top"
  ) => {
    setAddSongModal({ videoId, title, source });
    setModalPartner(""); // Reset partner selection
  };

  // Confirma a adição da música do modal
  const handleConfirmAddSong = async () => {
    if (!code || !addSongModal) return;

    const partner = participants.find(p => p.id === modalPartner);

    setAdding(addSongModal.videoId);
    await enqueue(
      code,
      addSongModal.videoId,
      addSongModal.title,
      nickname,
      partner?.name || undefined,
      myUserId,
      partner?.id || undefined
    );
    setAdding(null);
    setAddSongModal(null);
    setModalPartner("");

    // Clear search field and results after adding any song
    setSearchResults([]);
    setSearchQuery("");
    setCustomTitle("");
    setSearchError(null);
    setSavedFilter(""); // Also clear library filter

    // Refresh library
    getSongLibrary()
      .then(setSongLibrary)
      .catch(() => {});
  };

  // Legacy function - now opens modal
  const handleAddFromSaved = (song: SavedSong) => {
    openAddSongModal(song.videoId, song.title, "library");
  };

  // Show name modal if no name (before other screens)
  // This can happen if we want to let user change their name
  if (showNameModal) {
    return (
      <div
        className="container"
        style={{
          paddingTop: 60,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "80vh",
        }}
      >
        <div
          style={{
            background: "#1e1e1e",
            borderRadius: 16,
            padding: 24,
            width: "100%",
            maxWidth: 320,
          }}
        >
          <h3 style={{ margin: "0 0 8px", textAlign: "center" }}>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <IconMic size={24} /> Alterar Nome
            </span>
          </h3>
          <p
            style={{
              color: "#888",
              textAlign: "center",
              margin: "0 0 16px",
              fontSize: 14,
            }}
          >
            Digite seu novo nome
          </p>
          {nameError && (
            <div
              style={{
                background: "#ff4444",
                color: "#fff",
                padding: 12,
                borderRadius: 8,
                marginBottom: 16,
                fontSize: 14,
                textAlign: "center",
              }}
            >
              {nameError}
            </div>
          )}
          <input
            type="text"
            value={nameInput}
            onChange={e => {
              setNameInput(e.target.value);
              if (nameError) setNameError(null);
            }}
            onKeyDown={e => e.key === "Enter" && handleSaveName()}
            placeholder="Seu nome"
            autoFocus
            style={{
              width: "100%",
              padding: 12,
              fontSize: 16,
              background: "#2a2a2a",
              border: nameError ? "1px solid #ff4444" : "1px solid #444",
              borderRadius: 8,
              color: "#fff",
              marginBottom: 16,
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={handleSaveName}
            disabled={!nameInput.trim()}
            style={{
              width: "100%",
              padding: 12,
              background: nameInput.trim() ? "#7c4dff" : "#444",
              border: "none",
              borderRadius: 8,
              color: "#fff",
              fontSize: 16,
              fontWeight: 600,
              cursor: nameInput.trim() ? "pointer" : "not-allowed",
            }}
          >
            Atualizar Nome
          </button>
        </div>
      </div>
    );
  }

  // Loading state while checking auth
  if (authLoading || !user) {
    return (
      <div
        className="container"
        style={{ paddingTop: 60, textAlign: "center" }}
      >
        <h2>Carregando...</h2>
      </div>
    );
  }

  // Show error screen for room_not_found
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
          Volte e entre com um código válido.
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
        className="container"
        style={{ paddingTop: 60, textAlign: "center" }}
      >
        <h2>Conectando à sala {code}...</h2>
      </div>
    );
  }

  return (
    <div className="container">
      {/* Toast notification */}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#4CAF50",
            color: "#fff",
            padding: "12px 20px",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 500,
            zIndex: 2000,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            animation: "fadeIn 0.3s ease",
          }}
        >
          {toast}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <button
          onClick={() => navigate("/")}
          style={{
            background: "transparent",
            border: "1px solid #666",
            borderRadius: 8,
            padding: "6px 12px",
            color: "#fff",
            fontSize: 14,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
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
          Sair da sala
        </button>
        <h2
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: 0,
            fontSize: "1.2rem",
          }}
        >
          <IconMic size={20} /> {code}
        </h2>
        <button
          onClick={() => {
            setNameInput(nickname);
            setShowNameModal(true);
          }}
          style={{
            background: "transparent",
            border: "1px solid #444",
            borderRadius: 8,
            padding: "6px 12px",
            color: "#fff",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
          }}
        >
          {nickname || "Convidado"} <IconEdit size={14} />
        </button>
      </div>

      {/* Modal para mudar nome */}
      {showNameModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              background: "#1e1e1e",
              borderRadius: 16,
              padding: 24,
              width: "100%",
              maxWidth: 320,
            }}
          >
            <h3 style={{ margin: "0 0 16px", textAlign: "center" }}>
              Mudar apelido
            </h3>
            {nameError && (
              <div
                style={{
                  background: "#ff4444",
                  color: "#fff",
                  padding: 12,
                  borderRadius: 8,
                  marginBottom: 16,
                  fontSize: 14,
                  textAlign: "center",
                }}
              >
                {nameError}
              </div>
            )}
            <input
              type="text"
              value={nameInput}
              onChange={e => {
                setNameInput(e.target.value);
                if (nameError) setNameError(null);
              }}
              onKeyDown={e => e.key === "Enter" && handleSaveName()}
              placeholder="Digite seu apelido"
              autoFocus
              style={{
                width: "100%",
                padding: 12,
                fontSize: 16,
                background: "#2a2a2a",
                border: nameError ? "1px solid #ff4444" : "1px solid #444",
                borderRadius: 8,
                color: "#fff",
                marginBottom: 16,
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => {
                  setShowNameModal(false);
                  setNameError(null);
                }}
                style={{
                  flex: 1,
                  padding: 12,
                  background: "#333",
                  border: "none",
                  borderRadius: 8,
                  color: "#fff",
                  fontSize: 16,
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveName}
                disabled={!nameInput.trim()}
                style={{
                  flex: 1,
                  padding: 12,
                  background: nameInput.trim() ? "#7c4dff" : "#444",
                  border: "none",
                  borderRadius: 8,
                  color: "#fff",
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: nameInput.trim() ? "pointer" : "not-allowed",
                }}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="tabs">
        <button
          className={tab === "queue" ? "active" : ""}
          onClick={() => setTab("queue")}
        >
          Fila
        </button>
        <button
          className={tab === "ranking" ? "active" : ""}
          onClick={() => setTab("ranking")}
        >
          Ranking
        </button>
        <button
          className={tab === "saved" ? "active" : ""}
          onClick={() => setTab("saved")}
        >
          Músicas
        </button>
      </div>

      {tab === "queue" && (
        <div className="card">
          <h3>Fila ({state.queue.length})</h3>

          {/* Música tocando agora */}
          {state.nowPlaying ? (
            <div
              style={{
                background: "linear-gradient(135deg, #7c4dff 0%, #ff4081 100%)",
                margin: "-10px -10px 16px",
                padding: 16,
                borderRadius: "8px 8px 0 0",
              }}
            >
              <div
                style={{
                  fontSize: "0.8rem",
                  opacity: 0.8,
                  marginBottom: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <IconMusic size={14} /> Tocando agora
              </div>
              <div
                style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 4 }}
              >
                <TruncatedText text={state.nowPlaying.title} maxLength={50} />
              </div>
              <div
                style={{
                  fontSize: "0.9rem",
                  opacity: 0.9,
                  marginBottom: 12,
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
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => {
                    if (code) {
                      sendPlayerCommand(code, isPlaying ? "pause" : "play");
                      setIsPlaying(!isPlaying);
                    }
                  }}
                  style={{
                    flex: 1,
                    background: isPlaying ? "#e67e22" : "#2ecc71",
                    padding: "10px 16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  {isPlaying ? (
                    <>
                      <IconPause size={16} /> Pausar
                    </>
                  ) : (
                    <>
                      <IconPlay size={16} /> Continuar
                    </>
                  )}
                </button>
                <button
                  onClick={() => code && finalizeSong(code, nickname)}
                  style={{
                    flex: 1,
                    background: "#e74c3c",
                    padding: "10px 16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <IconSkipForward size={16} /> Pular
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{
                background: "#2a2a2a",
                margin: "-10px -10px 16px",
                padding: 16,
                borderRadius: "8px 8px 0 0",
                textAlign: "center",
              }}
            >
              {state.showingScore ? (
                <>
                  <div
                    style={{
                      color: "#f1c40f",
                      marginBottom: 8,
                      fontSize: "1.1rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    <IconTrophy size={20} /> Calculando pontuação...
                  </div>
                  <p style={{ color: "#888", margin: 0 }}>
                    Aguarde a TV mostrar o resultado
                  </p>
                </>
              ) : state.queue.length > 0 ? (
                <>
                  <div
                    style={{
                      color: "#fff",
                      marginBottom: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <IconMusic size={16} /> Próxima:{" "}
                    <strong>{state.queue[0].title}</strong>
                  </div>
                  <div
                    style={{
                      color: "#888",
                      fontSize: "0.9rem",
                      marginBottom: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <IconMic size={14} />
                    {state.queue[0].singers
                      ?.map(s => (typeof s === "string" ? s : s.name))
                      .join(" e ") || state.queue[0].requestedBy}
                  </div>
                  <button
                    onClick={() => code && nextSong(code)}
                    style={{
                      background: "#2ecc71",
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    <IconPlay size={18} /> Começar!
                  </button>
                </>
              ) : (
                <span style={{ color: "#888" }}>Nenhuma música na fila</span>
              )}
            </div>
          )}

          {/* Próximas na fila */}
          {state.queue.length === 0 ? (
            <p style={{ color: "#888" }}>
              Fila vazia - busque uma música abaixo!
            </p>
          ) : (
            <>
              <div
                style={{ fontSize: "0.85rem", color: "#888", marginBottom: 8 }}
              >
                Próximas:
              </div>
              {(showAllQueue ? state.queue : state.queue.slice(0, 5)).map(
                (item, i) => {
                  // Format singers display - singers can be objects with id/name or strings
                  const singers = item.singers || [];
                  const singerNames = singers.map(s =>
                    typeof s === "string" ? s : s.name
                  );
                  const singersDisplay =
                    singerNames.length > 1
                      ? singerNames.join(" e ")
                      : singerNames[0] || item.requestedBy;
                  return (
                    <div key={item.id} className="queue-item">
                      <span>
                        {i + 1}.{" "}
                        <TruncatedText text={item.title} maxLength={35} />
                      </span>
                      <span style={{ color: "#888" }}>{singersDisplay}</span>
                    </div>
                  );
                }
              )}
              {state.queue.length > 5 && (
                <button
                  onClick={() => setShowAllQueue(!showAllQueue)}
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: "1px solid #444",
                    marginTop: 8,
                    padding: "8px",
                    fontSize: "0.85rem",
                  }}
                >
                  {showAllQueue
                    ? "▲ Mostrar menos"
                    : `▼ Ver mais ${state.queue.length - 5} músicas`}
                </button>
              )}
            </>
          )}

          {/* Buscar música */}
          <div
            style={{
              marginTop: 20,
              paddingTop: 16,
              borderTop: "1px solid #444",
            }}
          >
            <h4
              style={{
                margin: "0 0 12px",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <IconSearch size={16} /> Adicionar música
            </h4>

            <p style={{ color: "#888", fontSize: "0.8rem", marginBottom: 8 }}>
              Cole um link do YouTube ou digite o nome da música
            </p>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginBottom: isLinkMode ? 8 : 12,
              }}
            >
              <input
                placeholder="Link ou nome da música..."
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setSearchResults([]);
                  setSearchError(null);
                }}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                style={{ flex: 1, margin: 0 }}
              />
              <button
                onClick={handleSearch}
                disabled={searching || !searchQuery.trim()}
                style={{ flex: 0, whiteSpace: "nowrap" }}
              >
                {searching ? "..." : isLinkMode ? "OK" : "Buscar"}
              </button>
            </div>

            {/* Campo de título quando é link */}
            {isLinkMode && (
              <input
                placeholder="Nome da música (opcional)"
                value={customTitle}
                onChange={e => setCustomTitle(e.target.value)}
                style={{ marginBottom: 12 }}
              />
            )}

            {/* Músicas da biblioteca que batem com a busca */}
            {!isLinkMode && matchingLibrarySongs.length > 0 && (
              <>
                <div
                  style={{
                    fontSize: "0.85rem",
                    color: "#888",
                    marginBottom: 8,
                  }}
                >
                  <IconLibrary size={14} /> Na biblioteca:
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    marginBottom: 12,
                  }}
                >
                  {matchingLibrarySongs.slice(0, 5).map(song => (
                    <div
                      key={song.id}
                      style={{
                        background: "#2a4a2a",
                        borderRadius: 8,
                        padding: 10,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <img
                        src={`https://i.ytimg.com/vi/${song.videoId}/default.jpg`}
                        alt=""
                        style={{
                          width: 50,
                          height: 38,
                          objectFit: "cover",
                          borderRadius: 4,
                        }}
                      />
                      <span style={{ flex: 1, fontSize: "0.85rem" }}>
                        {song.title}
                      </span>
                      <button
                        onClick={() => handleAddFromSaved(song)}
                        disabled={adding === song.videoId}
                        style={{
                          padding: "8px 12px",
                          fontSize: "0.85rem",
                          background: "#2ecc71",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {adding === song.videoId ? (
                          "..."
                        ) : (
                          <IconPlus size={16} />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
                {searchResults.length === 0 && !searching && (
                  <button
                    onClick={handleSearchYouTube}
                    style={{
                      width: "100%",
                      background: "#555",
                      marginBottom: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    <IconSearch size={16} /> Buscar no YouTube também
                  </button>
                )}
              </>
            )}

            {/* Resultados da busca */}
            {searching && (
              <p style={{ color: "#888", textAlign: "center" }}>
                Buscando no YouTube...
              </p>
            )}
            {searchError && (
              <p
                style={{
                  color: "#e74c3c",
                  textAlign: "center",
                  fontSize: "0.9rem",
                }}
              >
                {searchError}
              </p>
            )}
            {searchResults.length > 0 && (
              <>
                {matchingLibrarySongs.length > 0 && (
                  <div
                    style={{
                      fontSize: "0.85rem",
                      color: "#888",
                      marginBottom: 8,
                    }}
                  >
                    Resultados do YouTube:
                  </div>
                )}
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  {searchResults.map(result => (
                    <div
                      key={result.videoId}
                      style={{
                        background: "#2a2a2a",
                        borderRadius: 8,
                        overflow: "hidden",
                      }}
                    >
                      <div style={{ position: "relative" }}>
                        <img
                          src={result.thumbnail}
                          alt={result.title}
                          style={{
                            width: "100%",
                            display: "block",
                            cursor: "pointer",
                          }}
                          onClick={() => setPreviewVideo(result)}
                        />
                        <div
                          style={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                            background: "rgba(0,0,0,0.7)",
                            borderRadius: "50%",
                            width: 48,
                            height: 48,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            pointerEvents: "none",
                          }}
                        >
                          <IconPlay size={24} />
                        </div>
                      </div>
                      <div style={{ padding: 12 }}>
                        <div
                          style={{
                            fontSize: "0.9rem",
                            fontWeight: 600,
                            marginBottom: 4,
                          }}
                        >
                          {result.title}
                        </div>
                        <div
                          style={{
                            fontSize: "0.8rem",
                            color: "#888",
                            marginBottom: 8,
                          }}
                        >
                          {result.channelTitle}
                        </div>
                        <button
                          onClick={() => handleAddFromSearch(result)}
                          disabled={adding === result.videoId}
                          style={{
                            width: "100%",
                            background: "#2ecc71",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 8,
                          }}
                        >
                          {adding === result.videoId ? (
                            "Adicionando..."
                          ) : (
                            <>
                              <IconPlus size={16} /> Adicionar à fila
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "ranking" && (
        <div className="card">
          <h3
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 16,
            }}
          >
            <IconTrophy size={20} /> Ranking
          </h3>

          {/* Toggle Solo/Duplas */}
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 16,
              background: "#222",
              borderRadius: 8,
              padding: 4,
            }}
          >
            <button
              onClick={() => setRankingView("solo")}
              style={{
                flex: 1,
                padding: "8px 12px",
                background: rankingView === "solo" ? "#ff4081" : "transparent",
                border: "none",
                borderRadius: 6,
                color: "#fff",
                fontWeight: 600,
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              <IconUser size={14} /> Solo
            </button>
            <button
              onClick={() => setRankingView("duet")}
              style={{
                flex: 1,
                padding: "8px 12px",
                background: rankingView === "duet" ? "#ff4081" : "transparent",
                border: "none",
                borderRadius: 6,
                color: "#fff",
                fontWeight: 600,
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              <IconUsers size={14} /> Duplas
            </button>
          </div>

          {rankingView === "solo" ? (
            // Solo ranking
            Object.keys(state.ranking).length === 0 ? (
              <p style={{ color: "#888" }}>Ninguém pontuou ainda</p>
            ) : (
              Object.entries(state.ranking)
                .sort(([, a], [, b]) => b.score - a.score)
                .map(([odUserId, entry], i) => (
                  <div key={odUserId} className="ranking-item">
                    <span
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <span
                        style={{
                          width: 24,
                          height: 24,
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
                          fontSize: "0.75rem",
                          fontWeight: 700,
                        }}
                      >
                        {i + 1}
                      </span>
                      {entry.name}
                    </span>
                    <span style={{ fontWeight: 700 }}>{entry.score} pts</span>
                  </div>
                ))
            )
          ) : // Duet ranking
          !state.duetRanking || state.duetRanking.length === 0 ? (
            <p style={{ color: "#888" }}>Nenhuma dupla pontuou ainda</p>
          ) : (
            [...state.duetRanking]
              .sort((a, b) => b.score - a.score)
              .map((duet, i) => (
                <div key={duet.names.join("-")} className="ranking-item">
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span
                      style={{
                        width: 24,
                        height: 24,
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
                        fontSize: "0.75rem",
                        fontWeight: 700,
                      }}
                    >
                      {i + 1}
                    </span>
                    <span>
                      {duet.names[0]} & {duet.names[1]}
                    </span>
                  </span>
                  <span
                    style={{
                      fontWeight: 700,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                    }}
                  >
                    <span>{duet.score} pts</span>
                    <span style={{ fontSize: "0.7rem", color: "#888" }}>
                      {duet.count} música{duet.count > 1 ? "s" : ""}
                    </span>
                  </span>
                </div>
              ))
          )}
        </div>
      )}

      {tab === "saved" && (
        <div className="card">
          {/* Top Songs Section */}
          {topSongs.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <IconTrendingUp size={20} /> Mais Tocadas
              </h3>
              <p
                style={{ color: "#888", fontSize: "0.85rem", marginBottom: 12 }}
              >
                As músicas mais populares de todas as festas.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {topSongs.slice(0, 5).map((song, i) => (
                  <div
                    key={song.videoId}
                    style={{
                      background:
                        "linear-gradient(135deg, #2a2a2a 0%, #3a3a3a 100%)",
                      borderRadius: 8,
                      padding: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        width: 24,
                        height: 24,
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
                        fontSize: "0.75rem",
                        fontWeight: 700,
                      }}
                    >
                      {i + 1}
                    </span>
                    <img
                      src={`https://i.ytimg.com/vi/${song.videoId}/default.jpg`}
                      alt=""
                      style={{
                        width: 50,
                        height: 38,
                        objectFit: "cover",
                        borderRadius: 4,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "0.85rem",
                        }}
                      >
                        <TruncatedText text={song.title} maxLength={35} />
                      </div>
                      <div style={{ fontSize: "0.7rem", color: "#888" }}>
                        {song.playCount}{" "}
                        {song.playCount === 1 ? "vez" : "vezes"}
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        openAddSongModal(song.videoId, song.title, "top")
                      }
                      disabled={adding === song.videoId}
                      style={{
                        padding: "8px 12px",
                        fontSize: "0.8rem",
                        background: "#2ecc71",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <IconPlus size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Library Section */}
          <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <IconLibrary size={20} /> Biblioteca de Músicas
          </h3>
          <p style={{ color: "#888", fontSize: "0.85rem", marginBottom: 12 }}>
            Músicas adicionadas ficam salvas aqui para todos.
          </p>
          {songLibrary.length === 0 ? (
            <p style={{ color: "#888" }}>
              A biblioteca está vazia.
              <br />
              Busque e adicione uma música na aba Fila!
            </p>
          ) : (
            <>
              <input
                placeholder="Filtrar músicas..."
                value={savedFilter}
                onChange={e => setSavedFilter(e.target.value)}
                style={{ marginBottom: 12 }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {songLibrary
                  .filter(song =>
                    song.title.toLowerCase().includes(savedFilter.toLowerCase())
                  )
                  .map(song => (
                    <div
                      key={song.id}
                      style={{
                        background: "#2a2a2a",
                        borderRadius: 8,
                        padding: 12,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <img
                        src={`https://i.ytimg.com/vi/${song.videoId}/default.jpg`}
                        alt=""
                        style={{
                          width: 60,
                          height: 45,
                          objectFit: "cover",
                          borderRadius: 4,
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "0.9rem" }}>
                          <TruncatedText text={song.title} maxLength={40} />
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "#888" }}>
                          por {song.addedBy}
                        </div>
                      </div>
                      <button
                        onClick={() => handleAddFromSaved(song)}
                        disabled={adding === song.videoId}
                        style={{
                          padding: "8px 12px",
                          fontSize: "0.85rem",
                          background: "#2ecc71",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {adding === song.videoId ? (
                          "..."
                        ) : (
                          <IconPlus size={16} />
                        )}
                      </button>
                      <button
                        onClick={() => handleDeleteSaved(song.id)}
                        style={{
                          padding: "8px 12px",
                          fontSize: "0.85rem",
                          background: "#c0392b",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <IconTrash size={16} />
                      </button>
                    </div>
                  ))}
                {songLibrary.filter(song =>
                  song.title.toLowerCase().includes(savedFilter.toLowerCase())
                ).length === 0 && (
                  <p style={{ color: "#888", textAlign: "center" }}>
                    Nenhuma música encontrada
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Modal de Preview */}
      {previewVideo && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.9)",
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            padding: 16,
          }}
          onClick={() => setPreviewVideo(null)}
        >
          <div style={{ textAlign: "right", marginBottom: 8 }}>
            <button
              onClick={() => setPreviewVideo(null)}
              style={{
                background: "transparent",
                color: "#fff",
                fontSize: "1.5rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <IconX size={24} />
            </button>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div
              style={{
                position: "relative",
                paddingBottom: "56.25%",
                height: 0,
              }}
            >
              <iframe
                src={`https://www.youtube.com/embed/${previewVideo.videoId}?autoplay=1`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  border: "none",
                }}
                allow="autoplay; encrypted-media"
                allowFullScreen
                onClick={e => e.stopPropagation()}
              />
            </div>
            <div style={{ marginTop: 16, color: "#fff" }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {previewVideo.title}
              </div>
              <div
                style={{ color: "#888", fontSize: "0.9rem", marginBottom: 16 }}
              >
                {previewVideo.channelTitle}
              </div>
              <button
                onClick={e => {
                  e.stopPropagation();
                  handleAddFromSearch(previewVideo);
                  setPreviewVideo(null);
                }}
                disabled={adding === previewVideo.videoId}
                style={{
                  width: "100%",
                  background: "#2ecc71",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                {adding === previewVideo.videoId ? (
                  "Adicionando..."
                ) : (
                  <>
                    <IconPlus size={16} /> Adicionar à fila
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Adicionar Música - Escolher Solo/Dueto */}
      {addSongModal && (
        <div
          onClick={() => setAddSongModal(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#1a1a1a",
              borderRadius: 16,
              padding: 24,
              maxWidth: 350,
              width: "100%",
              border: "1px solid #333",
            }}
          >
            <div style={{ marginBottom: 16 }}>
              <div
                style={{ fontSize: "0.85rem", color: "#888", marginBottom: 4 }}
              >
                🎵 Adicionar à fila
              </div>
              <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
                {addSongModal.title}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label
                style={{
                  fontSize: "0.9rem",
                  color: "#ccc",
                  display: "block",
                  marginBottom: 8,
                }}
              >
                Quem vai cantar?
              </label>

              <select
                value={modalPartner}
                onChange={e => setModalPartner(e.target.value)}
                style={{
                  width: "100%",
                  padding: "14px 12px",
                  background: "#2a2a2a",
                  border: "1px solid #444",
                  borderRadius: 8,
                  color: "#fff",
                  fontSize: "1rem",
                  fontWeight: 500,
                  cursor: "pointer",
                  appearance: "none",
                  WebkitAppearance: "none",
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 12px center",
                  backgroundSize: "20px",
                  paddingRight: "40px",
                }}
              >
                <option
                  value=""
                  style={{ background: "#1a1a1a", color: "#fff" }}
                >
                  Sozinho(a)
                </option>
                {participants
                  .filter(p => p.id !== myUserId)
                  .map(p => (
                    <option
                      key={p.id}
                      value={p.id}
                      style={{ background: "#1a1a1a", color: "#fff" }}
                    >
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setAddSongModal(null)}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: "#444",
                  border: "none",
                  borderRadius: 8,
                  color: "#fff",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmAddSong}
                disabled={adding === addSongModal.videoId}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: "#2ecc71",
                  border: "none",
                  borderRadius: 8,
                  color: "#fff",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                {adding === addSongModal.videoId ? (
                  "..."
                ) : (
                  <>
                    <IconPlus size={16} /> Adicionar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
