/**
 * Motor de voz do Karaokêando (v2)
 * ------------------------------------------------------------
 * Substitui o sorteio (`Math.random`) por medição real do microfone:
 *
 *  - detecta a altura (f0) por autocorrelação normalizada;
 *  - acompanha nível (RMS) e presença de voz ao longo da música;
 *  - mede "firmeza" (fica na nota em vez de escorregar), notas longas
 *    e alcance vocal;
 *  - converte tudo em uma nota 0–99, no mesmo formato que o ranking já usa.
 *
 * Funciona com qualquer microfone do navegador (a permissão é pedida
 * na própria TV, no botão "Ligar microfone").
 */

export type MicMetrics = {
  /** % do tempo em que houve voz de verdade */
  voicePct: number;
  /** % das notas que ficaram firmes (variação < 60 cents em 400 ms) */
  steadyPct: number;
  /** nota final 0–99 */
  score: number;
  /** maior nota segurada, em segundos */
  longestNote: number;
  /** semitons distintos cantados (alcance) */
  range: number;
  /** frames analisados (quanto maior, mais confiável) */
  frames: number;
  /** nível médio quando cantou (0–1) */
  level: number;
};

export const EMPTY_METRICS: MicMetrics = {
  voicePct: 0,
  steadyPct: 0,
  score: 0,
  longestNote: 0,
  range: 0,
  frames: 0,
  level: 0,
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Detecção de altura por autocorrelação NORMALIZADA (estilo NSDF).
 * Normalizar pela energia de cada defasagem evita o erro clássico de
 * "meia oitava/uma oitava acima" e funciona bem em voz cantada.
 */
function detectPitch(buf: Float32Array, sampleRate: number): number {
  const SIZE = buf.length;
  let mean = 0;
  for (let i = 0; i < SIZE; i++) mean += buf[i];
  mean /= SIZE;

  let energy0 = 0;
  for (let i = 0; i < SIZE; i++) {
    const v = buf[i] - mean;
    energy0 += v * v;
  }
  if (energy0 / SIZE < 1.2e-4) return 0; // silêncio

  const minLag = Math.max(2, Math.floor(sampleRate / 1100)); // ~1100 Hz
  const maxLag = Math.min(SIZE - 2, Math.floor(sampleRate / 65)); // ~65 Hz

  const r = new Float32Array(maxLag + 2);
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let energyLag = 0;
    for (let i = 0; i < SIZE - lag; i++) {
      const a = buf[i] - mean;
      const b = buf[i + lag] - mean;
      num += a * b;
      energyLag += b * b;
    }
    const denom = Math.sqrt(energy0 * energyLag);
    const v = denom > 0 ? num / denom : 0;
    r[lag] = v;
    if (v > best) best = v;
  }
  if (best < 0.62) return 0; // periodicidade fraca: ruído, respiração, palmas

  // primeiro pico acima de 90% do melhor → evita pegar harmônicos (2T, 3T)
  const threshold = best * 0.9;
  let lag = minLag;
  for (let i = minLag + 1; i <= maxLag; i++) {
    if (r[i] >= threshold && r[i] >= r[i - 1] && r[i] >= (r[i + 1] ?? -1)) {
      lag = i;
      break;
    }
  }
  if (lag < minLag || lag > maxLag) return 0;

  // refinamento parabólico para precisão sub-amostra
  const y0 = r[lag - 1] ?? r[lag];
  const y1 = r[lag];
  const y2 = r[lag + 1] ?? r[lag];
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  const period = lag + Math.max(-0.5, Math.min(0.5, shift));
  const f0 = sampleRate / period;
  if (!isFinite(f0) || f0 < 65 || f0 > 1100) return 0;
  return f0;
}

const toSemitones = (f: number) => 12 * Math.log2(f / 440);

export type VoiceEngineListener = (engine: VoiceEngine) => void;

export class VoiceEngine {
  /** estado ao vivo (para a HUD da TV) */
  level = 0;
  pitch = 0;
  singing = false;
  running = false;
  deviceLabel = "";

  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf = new Float32Array(1024);
  private raf = 0;

  // acumuladores da música
  private frames = 0;
  private voiced = 0;
  private steady = 0;
  private levelSum = 0;
  private runStart = 0;
  private runSt = 0;
  private longestNote = 0;
  private semitones = new Set<number>();
  private recent: { t: number; st: number }[] = [];

  /** callback opcional chamado a cada frame (para HUD) */
  onFrame: VoiceEngineListener | null = null;

  async start(): Promise<boolean> {
    if (this.running) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // cancela o som que sai das caixas (evita "cantar" só o playback)
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
    } catch {
      return false;
    }

    this.deviceLabel =
      this.stream.getAudioTracks()[0]?.label || "Microfone";
    const AC: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new AC();
    await this.ctx.resume().catch(() => {});
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.5;
    const src = this.ctx.createMediaStreamSource(this.stream);
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize) as typeof this.buf;

    this.running = true;
    this.reset();
    this.loop();
    return true;
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.analyser = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.level = 0;
    this.pitch = 0;
    this.singing = false;
  }

  /** zera as medições (chamar no começo de cada música) */
  reset() {
    this.frames = 0;
    this.voiced = 0;
    this.steady = 0;
    this.levelSum = 0;
    this.runStart = 0;
    this.runSt = 0;
    this.longestNote = 0;
    this.semitones.clear();
    this.recent = [];
  }

  private loop = () => {
    if (!this.running || !this.analyser) return;
    const an = this.analyser;
    an.getFloatTimeDomainData(this.buf);

    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    this.level = clamp((20 * Math.log10(rms + 1e-6) + 60) / 48, 0, 1);

    const f0 = detectPitch(this.buf, an.context.sampleRate);
    if (f0 > 0) this.pitch = f0;

    const st = f0 > 0 ? toSemitones(f0) : 0;
    this.singing = rms > 0.012 && (f0 > 0 || this.level > 0.22);

    if (this.singing) {
      this.frames++;
      this.levelSum += this.level;
      const now = performance.now();
      if (f0 > 0) {
        this.voiced++;
        this.semitones.add(Math.round(st));

        // janela de 800 ms para julgar firmeza da nota
        this.recent.push({ t: now, st });
        while (this.recent.length && now - this.recent[0].t > 800)
          this.recent.shift();

        if (this.recent.length >= 4) {
          const vals = this.recent.map(r => r.st).sort((a, b) => a - b);
          const median = vals[Math.floor(vals.length / 2)];
          if (Math.abs(st - median) < 0.5) this.steady++;
        }

        // nota longa: mesma nota por vários frames
        if (!this.runStart || Math.abs(st - this.runSt) > 0.6) {
          this.runStart = now;
          this.runSt = st;
        } else {
          const run = (now - this.runStart) / 1000;
          if (run > this.longestNote) this.longestNote = run;
        }
      } else {
        this.runStart = 0;
      }
    } else {
      this.runStart = 0;
    }

    this.onFrame?.(this);
    this.raf = requestAnimationFrame(this.loop);
  };

  /** nota 0–99 no mesmo formato do ranking, a partir do que foi medido */
  metrics(): MicMetrics {
    if (this.frames < 8) return { ...EMPTY_METRICS, frames: this.frames };
    const voicePct = (this.frames ? this.voiced / this.frames : 0) * 100;
    const steadyPct = this.voiced ? (this.steady / this.voiced) * 100 : 0;
    const range = this.semitones.size;
    const level = this.frames ? this.levelSum / this.frames : 0;

    // Nota: presença de voz (50%), firmeza na nota (35%), alcance (15%).
    // O alcance satura em 20 semitons (~1,7 oitava), o que é bastante cantando.
    const rangePct = clamp((range / 20) * 100, 0, 100);
    const raw = voicePct * 0.5 + steadyPct * 0.35 + rangePct * 0.15;
    // quem quase não cantou não deve levar nota alta por acidente
    const penalty = voicePct < 12 ? voicePct / 12 : 1;
    const score = Math.round(clamp(raw * penalty, 0, 99));

    return {
      voicePct: Math.round(voicePct),
      steadyPct: Math.round(steadyPct),
      score,
      longestNote: Math.round(this.longestNote * 10) / 10,
      range,
      frames: this.frames,
      level: Math.round(level * 100) / 100,
    };
  }
}

/** Texto curto de retorno para a nota (o "juiz" da festa). */
export function judgeLine(m: MicMetrics): string {
  if (m.frames < 20) return "Quase não deu para te ouvir — chega mais perto do microfone!";
  if (m.score >= 90) return "Isso foi um show à parte. Afinação de rádio!";
  if (m.score >= 78) return "Mandou muito bem — nota firme e voz presente.";
  if (m.score >= 62) return "Boa cantoria! Dá para subir um tom na próxima.";
  if (m.score >= 45) return "Deu pro gasto… tenta segurar mais as notas longas.";
  return "Aquecendo a voz? Canta junto com a letra que a nota sobe.";
}
