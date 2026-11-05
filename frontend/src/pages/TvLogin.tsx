import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { API_BASE } from "../api";

export default function TvLogin() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [tvPassword, setTvPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/rooms/${code}/tv/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tvPassword }),
      });

      const data = await res.json();

      if (res.ok) {
        // Save TV token
        localStorage.setItem(`tvToken_${code}`, data.tvToken);
        // Navigate to TV view
        navigate(`/room/${code}/tv`);
      } else {
        setError(data.message || "Senha incorreta");
      }
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container" style={{ paddingTop: 60, maxWidth: 400 }}>
      <h1 style={{ textAlign: "center", fontSize: "2rem", marginBottom: 8 }}>
        📺 Modo TV
      </h1>
      <p style={{ textAlign: "center", color: "#888", marginBottom: 8 }}>
        Sala: <strong>{code}</strong>
      </p>
      <p style={{ textAlign: "center", color: "#888", marginBottom: 32 }}>
        Digite a senha para acessar o modo TV
      </p>

      <div className="card">
        <form onSubmit={handleSubmit}>
          {error && (
            <div
              style={{
                background: "#ff4444",
                color: "white",
                padding: "12px 16px",
                borderRadius: 8,
                marginBottom: 16,
                fontSize: "0.9rem",
              }}
            >
              {error}
            </div>
          )}

          <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
            Senha do TV
          </label>
          <input
            type="text"
            value={tvPassword}
            onChange={e => setTvPassword(e.target.value.slice(0, 6))}
            placeholder="••••••"
            required
            maxLength={6}
            autoFocus
            style={{
              marginBottom: 24,
              letterSpacing: "0.3em",
              textAlign: "center",
              fontSize: "1.5rem",
            }}
          />

          <button
            type="submit"
            disabled={loading || tvPassword.length === 0}
            style={{ width: "100%" }}
          >
            {loading ? "Verificando..." : "Entrar"}
          </button>
        </form>
      </div>

      <p
        style={{
          textAlign: "center",
          color: "#666",
          fontSize: "0.85rem",
          marginTop: 24,
        }}
      >
        Quer entrar como participante?{" "}
        <a
          href={`/room/${code}`}
          onClick={e => {
            e.preventDefault();
            navigate(`/room/${code}`);
          }}
          style={{ color: "#007bff" }}
        >
          Clique aqui
        </a>
      </p>
    </div>
  );
}
