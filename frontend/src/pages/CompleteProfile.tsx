import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function CompleteProfile() {
  const navigate = useNavigate();
  const { user, completeRegistration } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [city, setCity] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("As senhas não coincidem");
      return;
    }

    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres");
      return;
    }

    setLoading(true);

    const result = await completeRegistration({
      phone,
      password,
      city,
      birthDate,
      gender,
    });

    setLoading(false);

    if (result.success) {
      navigate("/");
    } else {
      setError(result.error || "Erro ao completar cadastro");
    }
  };

  if (!user) {
    navigate("/");
    return null;
  }

  return (
    <div className="container" style={{ paddingTop: 40, maxWidth: 450 }}>
      <h1 style={{ textAlign: "center", fontSize: "1.8rem", marginBottom: 8 }}>
        🎤 Completar Cadastro
      </h1>
      <p style={{ textAlign: "center", color: "#888", marginBottom: 24 }}>
        Complete seu cadastro para poder criar salas
      </p>

      <div className="card">
        <div
          style={{
            background: "#333",
            padding: "12px 16px",
            borderRadius: 8,
            marginBottom: 20,
          }}
        >
          <p style={{ margin: 0, fontSize: "0.9rem" }}>
            <strong>{user.name}</strong>
            <br />
            <span style={{ color: "#888" }}>{user.email}</span>
          </p>
        </div>

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
            Telefone
          </label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="(11) 99999-9999"
            required
            style={{ marginBottom: 16 }}
          />

          <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
            Cidade
          </label>
          <input
            type="text"
            value={city}
            onChange={e => setCity(e.target.value)}
            placeholder="São Paulo"
            required
            style={{ marginBottom: 16 }}
          />

          <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
            Data de Nascimento
          </label>
          <input
            type="date"
            value={birthDate}
            onChange={e => setBirthDate(e.target.value)}
            required
            style={{ marginBottom: 16 }}
          />

          <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
            Gênero
          </label>
          <select
            value={gender}
            onChange={e => setGender(e.target.value)}
            required
            style={{
              marginBottom: 16,
              width: "100%",
              padding: "12px",
              borderRadius: 8,
              background: "#222",
              color: "#fff",
              border: "1px solid #444",
            }}
          >
            <option value="">Selecione...</option>
            <option value="masculino">Masculino</option>
            <option value="feminino">Feminino</option>
            <option value="outro">Outro</option>
            <option value="prefiro_nao_informar">Prefiro não informar</option>
          </select>

          <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
            Senha
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Mínimo 6 caracteres"
            required
            style={{ marginBottom: 16 }}
          />

          <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
            Confirmar Senha
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Digite a senha novamente"
            required
            style={{ marginBottom: 24 }}
          />

          <button type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Salvando..." : "Completar Cadastro"}
          </button>
        </form>
      </div>
    </div>
  );
}
