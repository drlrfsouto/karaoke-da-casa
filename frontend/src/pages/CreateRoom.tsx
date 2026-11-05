import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, getToken } from "../context/AuthContext";
import { API_BASE } from "../api";

export default function CreateRoom() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tvPassword, setTvPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Redirect if not a host
  if (!user?.canHost) {
    navigate("/complete-profile");
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (tvPassword.length !== 6) {
      setError("A senha do TV deve ter exatamente 6 caracteres");
      return;
    }

    if (tvPassword !== confirmPassword) {
      setError("As senhas não coincidem");
      return;
    }

    setLoading(true);

    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/rooms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tvPassword }),
      });

      const data = await res.json();

      if (res.ok) {
        // Save TV token for this room
        const tvRes = await fetch(
          `${API_BASE}/api/rooms/${data.roomCode}/tv/login`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tvPassword }),
          }
        );

        if (tvRes.ok) {
          const tvData = await tvRes.json();
          localStorage.setItem(`tvToken_${data.roomCode}`, tvData.tvToken);
        }

        // Navigate to TV view
        navigate(`/room/${data.roomCode}/tv`);
      } else {
        setError(data.message || "Erro ao criar sala");
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
        🎤 Criar Sala
      </h1>
      <p style={{ textAlign: "center", color: "#888", marginBottom: 32 }}>
        Defina uma senha para o modo TV
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

          <div
            style={{
              background: "#333",
              padding: "12px 16px",
              borderRadius: 8,
              marginBottom: 20,
              fontSize: "0.9rem",
            }}
          >
            <p style={{ margin: 0 }}>
              💡 Esta senha será usada para acessar o <strong>modo TV</strong>{" "}
              da sala. Compartilhe apenas com quem deve controlar a TV.
            </p>
          </div>

          <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
            Senha do TV (6 caracteres)
          </label>
          <input
            type="text"
            value={tvPassword}
            onChange={e => setTvPassword(e.target.value.slice(0, 6))}
            placeholder="Ex: abc123"
            required
            maxLength={6}
            style={{
              marginBottom: 16,
              letterSpacing: "0.2em",
              textAlign: "center",
              fontSize: "1.2rem",
            }}
          />

          <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
            Confirmar Senha
          </label>
          <input
            type="text"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value.slice(0, 6))}
            placeholder="Digite novamente"
            required
            maxLength={6}
            style={{
              marginBottom: 24,
              letterSpacing: "0.2em",
              textAlign: "center",
              fontSize: "1.2rem",
            }}
          />

          <button
            type="submit"
            disabled={loading || tvPassword.length !== 6}
            style={{ width: "100%" }}
          >
            {loading ? "Criando..." : "Criar Sala"}
          </button>
        </form>
      </div>
    </div>
  );
}
