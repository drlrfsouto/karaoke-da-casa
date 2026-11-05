import { useState, useEffect, useCallback } from "react";
import { getActiveRooms, type ActiveRoom, API_BASE } from "../api";
import "./Dashboard.css";

interface TopSong {
  videoId: string;
  title: string;
  playCount: number;
}

// Icon components
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

const IconList = ({ size = 16 }: { size?: number }) => (
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
    <line x1="8" y1="6" x2="21" y2="6"></line>
    <line x1="8" y1="12" x2="21" y2="12"></line>
    <line x1="8" y1="18" x2="21" y2="18"></line>
    <line x1="3" y1="6" x2="3.01" y2="6"></line>
    <line x1="3" y1="12" x2="3.01" y2="12"></line>
    <line x1="3" y1="18" x2="3.01" y2="18"></line>
  </svg>
);

const IconRadio = ({ size = 16 }: { size?: number }) => (
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
    <circle cx="12" cy="12" r="2"></circle>
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"></path>
  </svg>
);

export default function Dashboard() {
  const [adminKey, setAdminKey] = useState(() => {
    return localStorage.getItem("pk_admin_key") || "";
  });
  const [isAuthed, setIsAuthed] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [topSongs, setTopSongs] = useState<TopSong[]>([]);
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    if (!adminKey) return;
    setLoading(true);
    setError("");

    try {
      const [songsRes, rooms] = await Promise.all([
        fetch(`${API_BASE}/api/analytics/top-songs?key=${adminKey}&limit=20`),
        getActiveRooms(adminKey),
      ]);

      if (!songsRes.ok) {
        setError("Chave inválida ou erro ao carregar dados");
        setIsAuthed(false);
        localStorage.removeItem("pk_admin_key");
        return;
      }

      const songsData = await songsRes.json();
      setTopSongs(songsData.topSongs || []);
      setActiveRooms(rooms);
      setIsAuthed(true);
    } catch {
      setError("Erro ao conectar com o servidor");
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => {
    if (adminKey) {
      fetchData();
    }
  }, [fetchData, adminKey]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!isAuthed) return;
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [isAuthed, fetchData]);

  const handleLogin = () => {
    if (keyInput.trim()) {
      localStorage.setItem("pk_admin_key", keyInput.trim());
      setAdminKey(keyInput.trim());
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("pk_admin_key");
    setAdminKey("");
    setIsAuthed(false);
    setTopSongs([]);
    setActiveRooms([]);
  };

  if (!isAuthed) {
    return (
      <div className="dashboard-login">
        <div className="login-card">
          <h1
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <IconMic size={32} /> Pikaroke
          </h1>
          <h2>Dashboard Admin</h2>
          {error && <p className="error">{error}</p>}
          <input
            type="password"
            placeholder="Chave de acesso"
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleLogin()}
          />
          <button onClick={handleLogin}>Entrar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-left">
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <IconMic size={28} /> Pikaroke Dashboard
          </h1>
          <span className="last-update">
            Atualizado: {new Date().toLocaleTimeString("pt-BR")}
          </span>
        </div>
        <div className="header-right">
          <button
            className="btn-refresh"
            onClick={fetchData}
            disabled={loading}
          >
            {loading ? "..." : "🔄 Atualizar"}
          </button>
          <button className="btn-logout" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </header>

      {/* Active Rooms */}
      <section className="dashboard-section">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <IconRadio size={20} /> Salas Ativas Agora
        </h2>
        {activeRooms.length > 0 ? (
          <div className="active-rooms-grid">
            {activeRooms.map(room => (
              <div key={room.code} className="active-room-card">
                <div className="room-code">{room.code}</div>
                <div className="room-info">
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <IconUsers size={14} /> {room.participantsCount} online
                  </span>
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <IconList size={14} /> {room.queueLength} na fila
                  </span>
                </div>
                {room.nowPlaying && (
                  <div
                    className="now-playing-mini"
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <IconMic size={12} /> {room.nowPlaying.slice(0, 30)}...
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">Nenhuma sala ativa no momento</p>
        )}
      </section>

      {/* Top Songs */}
      <section className="dashboard-section">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <IconTrophy size={20} /> Top Músicas (Histórico)
        </h2>
        <div className="top-list">
          {topSongs.slice(0, 15).map((song, i) => (
            <div key={song.videoId} className="top-item">
              <span className="rank">{getRankBadge(i)}</span>
              <img
                src={`https://i.ytimg.com/vi/${song.videoId}/default.jpg`}
                alt=""
                className="song-thumb"
              />
              <div className="song-info">
                <span className="song-title">{song.title}</span>
                <span className="play-count">{song.playCount}x tocada</span>
              </div>
              <div className="bar-container">
                <div
                  className="bar"
                  style={{
                    width: `${
                      (song.playCount / (topSongs[0]?.playCount || 1)) * 100
                    }%`,
                  }}
                />
              </div>
            </div>
          ))}
          {topSongs.length === 0 && (
            <p className="empty-state">Nenhuma música tocada ainda</p>
          )}
        </div>
      </section>

      <footer style={{ textAlign: "center", padding: 20, opacity: 0.5 }}>
        📊 Dashboard simplificado • Analytics detalhado em breve
      </footer>
    </div>
  );
}

// Helper function
function getRankBadge(index: number) {
  const styles: Record<number, React.CSSProperties> = {
    0: {
      background: "linear-gradient(135deg, #ffd700, #ffb700)",
      color: "#000",
    },
    1: {
      background: "linear-gradient(135deg, #c0c0c0, #a0a0a0)",
      color: "#000",
    },
    2: {
      background: "linear-gradient(135deg, #cd7f32, #a0522d)",
      color: "#fff",
    },
  };

  const baseStyle: React.CSSProperties = {
    width: 24,
    height: 24,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "bold",
    fontSize: 12,
    ...(styles[index] || { background: "#444", color: "#fff" }),
  };

  return <span style={baseStyle}>{index + 1}</span>;
}
