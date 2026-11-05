import { useEffect, useRef, useState } from "react";
import { VoiceEngine, type MicMetrics, judgeLine } from "../score/voice";
import { getLyrics, type LyricLine } from "../score/lyrics";

/**
 * HUD de voz da TV: microfone, medidor de nível, nota ao vivo e letra
 * sincronizada (LRC) desenhada por cima do vídeo.
 *
 * A nota ao vivo é só um "termômetro" (média corrente de presença de voz e
 * firmeza). A nota final da música é a que vale para o ranking.
 */

type Props = {
  videoId: string | null;
  /** chamado a cada frame com o motor ligado (para a TV saber se pode medir) */
  onEngine?: (engine: VoiceEngine | null) => void;
  /** posição atual do vídeo, em segundos (vem do player do YouTube) */
  time: number;
  playing: boolean;
  /** título do vídeo, usado na busca da letra */
  title?: string;
  /** duração do vídeo em segundos (desempata versões da mesma música) */
  duration?: number;
};

export type { VoiceEngine };

export function useVoiceHud({ videoId, onEngine, time, playing, title, duration }: Props) {
  const engineRef = useRef<VoiceEngine | null>(null);
  const [on, setOn] = useState(false);
  const [live, setLive] = useState({ level: 0, pitch: 0, singing: false });
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [lyricsState, setLyricsState] = useState<"idle" | "loading" | "none">(
    "idle"
  );
  const [lyricsOpen, setLyricsOpen] = useState(true);

  // Liga/desliga o microfone
  const toggle = async () => {
    if (on) {
      engineRef.current?.stop();
      engineRef.current = null;
      setOn(false);
      onEngine?.(null);
      return;
    }
    const eng = new VoiceEngine();
    const ok = await eng.start();
    if (!ok) {
      alert(
        "Não consegui acessar o microfone.\n\n" +
          "Permita o microfone no cadeado da barra de endereço e tente de novo."
      );
      return;
    }
    eng.onFrame = e =>
      setLive({ level: e.level, pitch: e.pitch, singing: e.singing });
    engineRef.current = eng;
    setOn(true);
    onEngine?.(eng);
  };

  // Zera as medições quando troca a música
  useEffect(() => {
    engineRef.current?.reset();
    setLyrics(null);
    setLyricsState("idle");
    if (!videoId) return;
    let cancelled = false;
    setLyricsState("loading");
    getLyrics(videoId, title, duration).then(res => {
      if (cancelled) return;
      if (res && res.lines.length) {
        setLyrics(res.lines);
        setLyricsState("idle");
      } else {
        setLyrics(null);
        setLyricsState("none");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [videoId, title, duration]);

  // Desliga o microfone ao desmontar
  useEffect(() => () => engineRef.current?.stop(), []);

  return {
    on,
    toggle,
    live,
    lyrics,
    lyricsState,
    lyricsOpen,
    setLyricsOpen,
    engine: engineRef,
    time,
    playing,
  };
}

export function VoiceHud({
  on,
  toggle,
  live,
  lyrics,
  lyricsState,
  lyricsOpen,
  setLyricsOpen,
  time,
  playing,
  lyricShift = 0,
  onShiftLyrics,
}: {
  on: boolean;
  toggle: () => void;
  live: { level: number; pitch: number; singing: boolean };
  lyrics: LyricLine[] | null;
  lyricsState: "idle" | "loading" | "none";
  lyricsOpen: boolean;
  setLyricsOpen: (v: boolean) => void;
  time: number;
  playing: boolean;
  lyricShift?: number;
  onShiftLyrics?: (delta: number) => void;
}) {
  // linha atual (com offset de 0,15 s para a letra "chegar junto")
  const t = time + 0.15 + lyricShift;
  let idx = -1;
  if (lyrics) {
    for (let i = 0; i < lyrics.length; i++) if (t >= lyrics[i].t) idx = i;
  }
  const current = idx >= 0 && lyrics ? lyrics[idx] : null;
  const next = lyrics && idx + 1 < lyrics.length ? lyrics[idx + 1] : null;

  const bars = 16;
  const note = live.pitch ? Math.round(12 * Math.log2(live.pitch / 440)) : null;

  return (
    <>
      {/* letra sincronizada */}
      {lyrics && lyricsOpen && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 88,
            textAlign: "center",
            padding: "0 6vw",
            pointerEvents: "none",
            zIndex: 12,
            fontFamily:
              "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          <div
            style={{
              fontSize: "clamp(22px, 3.4vw, 46px)",
              fontWeight: 800,
              lineHeight: 1.15,
              color: "#fff",
              textShadow:
                "0 3px 0 rgba(0,0,0,.85), 0 0 26px rgba(0,0,0,.9), 0 0 60px rgba(255,214,10,.35)",
              minHeight: "1.2em",
              transition: "opacity .15s",
              opacity: current ? 1 : 0.85,
            }}
          >
            {current ? current.text : playing ? "♪ …" : ""}
          </div>
          <div
            style={{
              fontSize: "clamp(15px, 1.9vw, 26px)",
              fontWeight: 600,
              marginTop: 10,
              color: "rgba(255,255,255,.62)",
              textShadow: "0 2px 8px rgba(0,0,0,.9)",
              minHeight: "1.2em",
            }}
          >
            {next ? next.text : ""}
          </div>
        </div>
      )}

      {/* barra de controles do microfone / letra */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "10px 16px",
          borderRadius: 999,
          background: "rgba(8,10,20,.72)",
          border: "1px solid rgba(255,255,255,.16)",
          backdropFilter: "blur(10px)",
          zIndex: 20,
        }}
      >
        <button
          onClick={() => void toggle()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 16px",
            borderRadius: 999,
            border: "none",
            cursor: "pointer",
            fontWeight: 800,
            fontSize: 14,
            color: on ? "#04170f" : "#fff",
            background: on
              ? "linear-gradient(135deg,#22e3c3,#0fb894)"
              : "rgba(255,255,255,.14)",
          }}
        >
          {on ? "● Microfone ligado" : "🎤 Ligar microfone e pontuar"}
        </button>

        {/* medidor de nível + nota */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3 }}>
          {Array.from({ length: bars }).map((_, i) => {
            const th = (i + 1) / bars;
            const h = Math.max(4, Math.min(28, (live.level * 1.4 - th * 0.5) * 60));
            return (
              <div
                key={i}
                style={{
                  width: 5,
                  height: on ? h : 4,
                  borderRadius: 3,
                  background:
                    live.level > th
                      ? "linear-gradient(180deg,#ffe066,#f4a72c)"
                      : "rgba(255,255,255,.22)",
                  transition: "height .07s linear",
                }}
              />
            );
          })}
        </div>

        <div
          style={{
            fontVariantNumeric: "tabular-nums",
            fontWeight: 800,
            fontSize: 13,
            color: on ? "#22e3c3" : "rgba(255,255,255,.45)",
            minWidth: 62,
            textAlign: "center",
          }}
          title="Nota da nota cantada (classe MIDI aproximada)"
        >
          {on ? (live.singing ? "cantando" : note !== null ? `nota ${note}` : "—") : "sem mic"}
        </div>

        {lyricsState === "loading" && (
          <span style={{ fontSize: 12, opacity: 0.6 }}>buscando letra…</span>
        )}
        {lyricsState === "none" && (
          <span style={{ fontSize: 12, opacity: 0.6 }}>sem letra para este vídeo</span>
        )}
        {lyrics && onShiftLyrics && (
          <>
            <button
              onClick={() => onShiftLyrics(-0.3)}
              title="Letra adiantada: atrasar 0,3 s"
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,.2)",
                background: "transparent",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              −0,3s
            </button>
            <button
              onClick={() => onShiftLyrics(0.3)}
              title="Letra atrasada: adiantar 0,3 s"
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,.2)",
                background: "transparent",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              +0,3s
            </button>
            {lyricShift !== 0 && (
              <span
                style={{
                  fontSize: 11,
                  opacity: 0.7,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {lyricShift > 0 ? "+" : ""}
                {lyricShift.toFixed(1)}s
              </span>
            )}
          </>
        )}
        {lyrics && (
          <button
            onClick={() => setLyricsOpen(!lyricsOpen)}
            title="Ligar/desligar a letra"
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,.2)",
              background: lyricsOpen ? "rgba(255,255,255,.16)" : "transparent",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 800,
              fontSize: 13,
            }}
          >
            Aa
          </button>
        )}
      </div>
    </>
  );
}

/** resumo de voz exibido junto da nota final */
export function voiceSummary(m: MicMetrics | null): string {
  if (!m || !m.frames) return "";
  return (
    `Voz em ${m.voicePct}% do tempo · firmeza ${m.steadyPct}% · ` +
    `${m.range} semitons · nota mais longa ${m.longestNote}s. ${judgeLine(m)}`
  );
}
