import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Get return URL from navigation state
  const returnTo = (location.state as { returnTo?: string })?.returnTo || "/";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await login(email, password);
    setLoading(false);

    if (result.success) {
      navigate(returnTo);
    } else {
      setError(result.error || "Erro ao fazer login");
    }
  };

  return (
    <div className="container" style={{ paddingTop: 60, maxWidth: 400 }}>
      <h1 style={{ textAlign: "center", fontSize: "2rem", marginBottom: 8 }}>
        🎤 Karaokêando
      </h1>
      <p style={{ textAlign: "center", color: "#888", marginBottom: 32 }}>
        Entrar na sua conta
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
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="seu@email.com"
            required
            style={{ marginBottom: 16 }}
          />

          <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
            Senha
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••"
            required
            style={{ marginBottom: 24 }}
          />

          <button
            type="submit"
            disabled={loading}
            style={{ width: "100%", marginBottom: 16 }}
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p style={{ textAlign: "center", color: "#888", fontSize: "0.9rem" }}>
          Não tem conta?{" "}
          <Link to="/register" style={{ color: "#4CAF50" }}>
            Criar conta de Host
          </Link>
        </p>

        <p style={{ textAlign: "center", marginTop: 16 }}>
          <Link to="/" style={{ color: "#888" }}>
            ← Voltar ao início
          </Link>
        </p>
      </div>
    </div>
  );
}
