import { useEffect, useRef, useState } from "react";
import {
  getScoreData,
  getScoreValue,
  rotateScore,
} from "../score/pikaraokeScore";
import { launchFireworkShow } from "../score/fireworks";
import "./ScoreOverlay.css";

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

type Props = {
  open: boolean;
  // If provided, uses this score; otherwise generates score exactly like PiKaraoke.
  scoreOverride?: number;
  // If provided, shows singer name in review line prefix.
  singer?: string;
  // TV should play audio; mobile should not.
  enableAudio?: boolean;
  // Linha extra explicando COMO a nota foi obtida (microfone x modo festa).
  note?: string;
  onDone?: (finalScore: number) => void;
};

export default function ScoreOverlay({
  open,
  scoreOverride,
  singer,
  enableAudio = false,
  note,
  onDone,
}: Props) {
  const [scoreText, setScoreText] = useState("");
  const [reviewText, setReviewText] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Store onDone in a ref to avoid re-triggering effect when callback changes
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const run = async () => {
      const scoreValue =
        typeof scoreOverride === "number" ? scoreOverride : getScoreValue();
      const scoreData = getScoreData(scoreValue, singer);

      setReviewText("");
      setScoreText("");

      const drums = new Audio("/sounds/score-drums.mp3");
      const applause = new Audio(`/sounds/${scoreData.applause}`);

      // PiKaraoke settings
      drums.volume = 0.3;

      if (enableAudio) {
        // best-effort; browsers may block until a user gesture
        void drums.play().catch(() => {});
      }

      const drumDuration = 4100;
      await rotateScore(setScoreText, drumDuration);
      if (cancelled) return;

      setScoreText(String(scoreValue).padStart(2, "0"));
      setReviewText(scoreData.review);

      const canvas = canvasRef.current;
      if (canvas) launchFireworkShow(canvas, scoreValue);

      if (enableAudio) {
        await new Promise<void>(resolve => {
          void applause.play().catch(() => {
            resolve();
          });
          applause.onended = () => resolve();
        });
      } else {
        // keep overlay visible a bit like the applause duration
        await new Promise(r => setTimeout(r, 2500));
      }

      if (cancelled) return;
      setReviewText("");
      onDoneRef.current?.(scoreValue);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [open, scoreOverride, singer, enableAudio]);

  if (!open) return null;

  return (
    <div className="pk-score">
      <div className="pk-score__your">Sua Pontuação</div>
      <div className="pk-score__number">{scoreText}</div>
      <div className="pk-score__review">
        {singer ? (
          <div
            style={{
              fontSize: "2rem",
              marginBottom: 8,
              opacity: 0.9,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <IconMic size={28} /> {singer}
          </div>
        ) : null}
        <div>{reviewText}</div>
        {note ? (
          <div
            style={{
              marginTop: 14,
              fontSize: "0.95rem",
              opacity: 0.72,
              maxWidth: 620,
              marginLeft: "auto",
              marginRight: "auto",
              lineHeight: 1.4,
            }}
          >
            {note}
          </div>
        ) : null}
      </div>
      <canvas ref={canvasRef} className="pk-score__canvas" />
    </div>
  );
}
