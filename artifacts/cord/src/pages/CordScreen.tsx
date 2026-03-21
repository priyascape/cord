import { useEffect, useRef, useState, useCallback } from "react";

const STREAMS = ["Slack", "Gmail", "Calendar", "Linear", "Dropbox"];
const KATAKANA =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
const CHARS = KATAKANA + "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*";
const FS = 16;

function rchar() {
  return CHARS[Math.floor(Math.random() * CHARS.length)];
}

interface Drop {
  y: number;
  speed: number;
  chars: string[];
  trailLen: number;
  glow: number;
  stream: number;
  isLabel: boolean;
}

interface LogLine {
  text: string;
  dim: boolean;
  key: number;
}

interface Bubble {
  id: number;
  streamIdx: number;
  label: string;
  icon: string;
  text: string;
  left: number;
  top: number;
  warning?: boolean;
  duration?: number;
}

const DEFAULT_BUBBLE_DURATION = 8000;
const WARNING_BUBBLE_DURATION = 10000;

const NOTIFICATIONS: Omit<Bubble, "id" | "left" | "top">[] = [
  { streamIdx: 0, label: "NEURIPS SLACK AGENT", icon: "◉", text: "Terri: travel grant doc needs sign-off" },
  { streamIdx: 1, label: "GMAIL NEURIPS AGENT", icon: "✉", text: "14 new paper submissions in review queue" },
  { streamIdx: 2, label: "CALENDAR",            icon: "◈", text: "NeurIPS Creative AI call — 3pm today" },
  { streamIdx: 0, label: "NEURIPS SLACK AGENT", icon: "◉", text: "Creative AI schedule needed by EOD" },
  { streamIdx: 1, label: "GMAIL NEURIPS AGENT", icon: "✉", text: "AV setup confirmation pending — Max" },
  {
    streamIdx: 3,
    label: "GPTZERO AGENT",
    icon: "⚠",
    text: "⚠ GPTZero: Paper #4471 — hallucinated citation detected: 'Chen et al. 2023, Nature ML' does not exist. Authors: Google Brain / Cambridge.",
    warning: true,
    duration: WARNING_BUBBLE_DURATION,
  },
];

const makeBubbleId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

const SCAN_SEQUENCE = [
  "↓ SCANNING SLACK...",
  "↓ SCANNING GMAIL...",
  "↓ SCANNING DROPBOX...",
  "↓ SCANNING CALENDAR...",
  "SYNTHESISING WITH GEMINI...",
];

let keyCounter = 0;

export default function CordScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const slowedRef = useRef(false);
  const dropsRef = useRef<Drop[]>([]);
  const animRef = useRef<number>(0);

  const [uiState, setUiState] = useState<"idle" | "listening" | "processing" | "speaking">("idle");
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [transcript, setTranscript] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const bubblesRef = useRef<Bubble[]>([]);
  bubblesRef.current = bubbles;

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scanTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const logLinesRef = useRef<LogLine[]>([]);
  const uiStateRef = useRef(uiState);
  uiStateRef.current = uiState;
  const notifIndexRef = useRef(0);

  // Pick a y% that maximises distance from any active bubble in the same or adjacent column
  const findTop = useCallback((streamIdx: number): number => {
    const START = 8;
    const END = 60;
    const CARD_GAP = 16; // ~16% of screen height clears a card + breathing room
    const nearby = bubblesRef.current.filter(
      (b) => Math.abs(b.streamIdx - streamIdx) <= 1
    );
    if (nearby.length === 0) return START + Math.random() * (END - START);
    let bestTop = START;
    let bestDist = -1;
    for (let i = 0; i < 20; i++) {
      const candidate = START + Math.random() * (END - START);
      const minDist = Math.min(...nearby.map((b) => Math.abs(b.top - candidate)));
      if (minDist > bestDist) {
        bestDist = minDist;
        bestTop = candidate;
        if (minDist >= CARD_GAP) break;
      }
    }
    return bestTop;
  }, []);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    const spawnBubble = () => {
      if (uiStateRef.current !== "idle") return;
      const notif = NOTIFICATIONS[notifIndexRef.current % NOTIFICATIONS.length];
      notifIndexRef.current += 1;
      const streamCenter = notif.streamIdx * 20 + 10;
      const left = streamCenter + (Math.random() * 8 - 4);
      const top = findTop(notif.streamIdx);
      const id = makeBubbleId();
      const bubble: Bubble = { id, left, top, ...notif };
      const bubbleDuration = notif.duration ?? DEFAULT_BUBBLE_DURATION;
      setBubbles((prev) => [...prev, bubble]);
      const t = setTimeout(() => {
        setBubbles((prev) => prev.filter((b) => b.id !== id));
      }, bubbleDuration);
      timers.push(t);
    };

    // pre-seed 4 bubbles at staggered times so screen fills immediately
    [300, 900, 1800, 2700].forEach((delay) => {
      const t = setTimeout(spawnBubble, delay);
      timers.push(t);
    });

    const interval = setInterval(spawnBubble, 2000);

    return () => {
      clearInterval(interval);
      timers.forEach(clearTimeout);
    };
  }, [findTop]);

  const addLog = useCallback((text: string) => {
    logLinesRef.current = logLinesRef.current.map((l) => ({ ...l, dim: true }));
    logLinesRef.current = [...logLinesRef.current, { text, dim: false, key: keyCounter++ }];
    setLogLines([...logLinesRef.current]);
  }, []);

  const clearLog = useCallback(() => {
    logLinesRef.current = [];
    setLogLines([]);
  }, []);

  const clearScanTimers = useCallback(() => {
    scanTimersRef.current.forEach(clearTimeout);
    scanTimersRef.current = [];
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const makeDrop = (col: number, streamIdx: number, isLabel: boolean, h: number): Drop => {
      const trailLen = Math.floor(Math.random() * 24) + 12;
      return {
        y: Math.floor(Math.random() * (h / FS)),
        speed: Math.random() * 1.2 + 0.6,
        chars: Array.from({ length: trailLen }, rchar),
        trailLen,
        glow: 0,
        stream: streamIdx,
        isLabel,
      };
    };

    const initDrops = (w: number, h: number) => {
      const cols = Math.floor(w / FS);
      const streamWidth = Math.ceil(cols / STREAMS.length);
      dropsRef.current = Array.from({ length: cols }, (_, i) => {
        const streamIdx = Math.min(Math.floor(i / streamWidth), STREAMS.length - 1);
        const midOfStream = streamIdx * streamWidth + Math.floor(streamWidth / 2);
        return makeDrop(i, streamIdx, i === midOfStream, h);
      });
    };

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initDrops(canvas.width, canvas.height);
    };

    resize();
    window.addEventListener("resize", resize);

    let lastBurst = 0;
    let lastTime = 0;

    const draw = (t: number) => {
      const slowed = slowedRef.current;
      const fps = slowed ? 8 : 30;
      const interval = 1000 / fps;
      const dt = t - lastTime;

      if (dt >= interval) {
        lastTime = t - (dt % interval);
        const W = canvas.width;
        const H = canvas.height;

        ctx.fillStyle = slowed ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.05)";
        ctx.fillRect(0, 0, W, H);

        const dimFactor = slowed ? 0.2 : 1;
        const drops = dropsRef.current;

        for (let i = 0; i < drops.length; i++) {
          const d = drops[i];
          const x = i * FS;

          for (let j = 0; j < d.trailLen; j++) {
            const cy = (d.y - j) * FS;
            if (cy < -FS || cy > H + FS) continue;

            const isHead = j === 0;
            const fade = 1 - j / d.trailLen;

            ctx.font = `${FS}px monospace`;

            if (isHead) {
              ctx.shadowBlur = d.glow > 0 ? 20 * d.glow : 4;
              ctx.shadowColor = d.glow > 0 ? "#39ff14" : "#00ff41";
              ctx.fillStyle = `rgba(220,255,225,${0.95 * dimFactor})`;
            } else if (d.glow > 0) {
              const a = fade * d.glow * dimFactor;
              ctx.shadowColor = "#39ff14";
              ctx.shadowBlur = 10 * fade * d.glow;
              ctx.fillStyle = `rgba(57,255,20,${Math.min(a, 1)})`;
            } else {
              ctx.shadowBlur = 0;
              const a = Math.max(0.04, fade * 0.75 * dimFactor);
              ctx.fillStyle = `rgba(0,255,65,${a})`;
            }

            ctx.fillText(d.chars[j], x, cy);
          }

          ctx.shadowBlur = 0;

          if (d.isLabel && !slowed) {
            const label = STREAMS[d.stream];
            const ly = (d.y + 2) * FS;
            if (ly > 0 && ly < H) {
              ctx.font = "bold 9px monospace";
              ctx.shadowBlur = d.glow > 0 ? 8 * d.glow : 0;
              ctx.shadowColor = "#39ff14";
              ctx.fillStyle = d.glow > 0
                ? `rgba(57,255,20,${0.9 * d.glow})`
                : "rgba(0,255,65,0.38)";
              ctx.fillText(label, x - 2, ly);
              ctx.shadowBlur = 0;
            }
          }

          if (Math.random() < 0.04) {
            const ri = Math.floor(Math.random() * d.trailLen);
            d.chars[ri] = rchar();
          }

          d.y += d.speed * (slowed ? 0.2 : 1);

          if (d.y * FS > H + d.trailLen * FS) {
            const streamIdx = d.stream;
            const cols = drops.length;
            const sw = Math.ceil(cols / STREAMS.length);
            const midOfStream = streamIdx * sw + Math.floor(sw / 2);
            const isLabel = i === midOfStream;
            dropsRef.current[i] = makeDrop(i, streamIdx, isLabel, H);
            dropsRef.current[i].y = -Math.floor(Math.random() * 10);
          }

          if (d.glow > 0) {
            d.glow = Math.max(0, d.glow - 0.012);
          }
        }

        if (!slowed && t - lastBurst > 3000 + Math.random() * 2000) {
          lastBurst = t;
          const si = Math.floor(Math.random() * STREAMS.length);
          for (const d of drops) {
            if (d.stream === si) d.glow = 1.0;
          }
        }
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animRef.current);
    };
  }, []);

  const runScanSequence = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      SCAN_SEQUENCE.forEach((line, i) => {
        const t = setTimeout(() => {
          addLog(line);
          if (i === SCAN_SEQUENCE.length - 1) {
            const final = setTimeout(resolve, 400);
            scanTimersRef.current.push(final);
          }
        }, (i + 1) * 500);
        scanTimersRef.current.push(t);
      });
    });
  }, [addLog]);

  const handleMicClick = useCallback(async () => {
    if (uiStateRef.current !== "idle") return;

    setError("");
    setAiResponse("");
    setTranscript("");
    clearLog();
    clearScanTimers();
    slowedRef.current = true;
    setUiState("listening");
    addLog("LISTENING...");

    const SR =
      (window as Window).SpeechRecognition || (window as Window).webkitSpeechRecognition;

    if (!SR) {
      setError("Web Speech API not supported in this browser.");
      slowedRef.current = false;
      setUiState("idle");
      clearLog();
      return;
    }

    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onresult = async (event: SpeechRecognitionEvent) => {
      const text = event.results[0][0].transcript;
      setTranscript(text);
      setUiState("processing");
      addLog("PROCESSING...");

      try {
        const [aiData] = await Promise.all([
          fetch("/api/cord/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript: text }),
          }).then((r) => r.json() as Promise<{ response?: string; message?: string }>),
          runScanSequence(),
        ]);

        if (!aiData.response) throw new Error(aiData.message || "AI request failed");

        const responseText = aiData.response;
        setAiResponse(responseText);
        setUiState("speaking");

        const onSpeechEnd = () => {
          slowedRef.current = false;
          setUiState("idle");
          setAiResponse("");
          clearLog();
        };

        const speakWithBrowser = () => {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(responseText);
          utterance.lang = "en-US";
          utterance.rate = 0.92;
          utterance.pitch = 1.0;
          utterance.onend = onSpeechEnd;
          utterance.onerror = onSpeechEnd;
          window.speechSynthesis.speak(utterance);
        };

        let elevenLabsOk = false;
        try {
          const ttsRes = await fetch("/api/cord/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: responseText }),
          });

          if (ttsRes.ok) {
            const ttsData = (await ttsRes.json()) as {
              audioBase64?: string;
              contentType?: string;
            };
            const { audioBase64, contentType } = ttsData;
            if (audioBase64 && contentType) {
              const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
              const blob = new Blob([bytes], { type: contentType });
              const url = URL.createObjectURL(blob);
              const audio = new Audio(url);
              audioRef.current = audio;
              audio.onended = () => {
                URL.revokeObjectURL(url);
                onSpeechEnd();
              };
              audio.onerror = () => {
                URL.revokeObjectURL(url);
                speakWithBrowser();
              };
              await audio.play();
              elevenLabsOk = true;
            }
          }
        } catch {
          // ElevenLabs failed — fall through to browser synthesis
        }

        if (!elevenLabsOk) {
          speakWithBrowser();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setError(msg);
        slowedRef.current = false;
        setUiState("idle");
        clearLog();
        clearScanTimers();
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech" || event.error === "aborted") {
        slowedRef.current = false;
        setUiState("idle");
        clearLog();
        return;
      }
      if (event.error === "not-allowed") {
        setError("Microphone access denied. Please allow microphone permissions and try again.");
      } else {
        setError(`Speech error: ${event.error}`);
      }
      slowedRef.current = false;
      setUiState("idle");
      clearLog();
    };

    recognition.onend = () => {
      if (uiStateRef.current === "listening") {
        slowedRef.current = false;
        setUiState("idle");
        clearLog();
      }
    };

    recognition.start();
  }, [addLog, clearLog, clearScanTimers, runScanSequence]);

  const handleStop = useCallback(() => {
    recognitionRef.current?.stop();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    clearScanTimers();
    slowedRef.current = false;
    setUiState("idle");
    setAiResponse("");
    setTranscript("");
    setError("");
    clearLog();
  }, [clearLog, clearScanTimers]);

  const micClass = () => {
    if (uiState === "listening") return "mic-btn mic-listening";
    if (uiState === "processing") return "mic-btn mic-processing";
    if (uiState === "speaking") return "mic-btn mic-speaking";
    return "mic-btn mic-idle";
  };

  return (
    <div className="cord-root">
      <canvas ref={canvasRef} className="cord-canvas" />

      <div className="cord-clock">
        <span className="cord-clock-time">
          {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
        <span className="cord-clock-date">
          {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </span>
      </div>

      <div className="bubbles-layer">
        {bubbles.map((b) => (
          <div
            key={b.id}
            className="bubble-wrap"
            style={{ left: `${b.left}%`, top: `${b.top}%` }}
          >
            <div
              className="bubble-dot"
              style={b.warning ? { animationDuration: "10s" } : undefined}
            />
            <div
              className={`bubble-card${b.warning ? " bubble-card--warning" : ""}`}
              style={b.warning ? { animationDuration: "10s" } : undefined}
            >
              <div className="bubble-header">
                <span className={`bubble-icon${b.warning ? " bubble-icon--warning" : ""}`}>{b.icon}</span>
                <span className={`bubble-label${b.warning ? " bubble-label--warning" : ""}`}>{b.label}</span>
                <span className="bubble-cursor">_</span>
              </div>
              <div className={`bubble-text${b.warning ? " bubble-text--warning" : ""}`}>{b.text}</div>
            </div>
          </div>
        ))}
      </div>

      {logLines.length > 0 && (
        <div className="cord-terminal">
          {logLines.map((line) => (
            <div
              key={line.key}
              className={`cord-terminal-line ${line.dim ? "cord-terminal-line--dim" : "cord-terminal-line--active"} ${line.text === "LISTENING..." ? "cord-terminal-line--pulse" : ""}`}
            >
              {line.text}
            </div>
          ))}
        </div>
      )}

      {transcript && uiState !== "idle" && (
        <div className="cord-transcript">
          <span className="cord-transcript-text">"{transcript}"</span>
        </div>
      )}

      {aiResponse && uiState === "speaking" && (
        <div className="cord-response">
          <div className="cord-response-label">▶ CORD</div>
          <div className="cord-response-text">{aiResponse}</div>
        </div>
      )}

      {error && (
        <div className="cord-error">
          <span>⚠ {error}</span>
          <button className="cord-error-dismiss" onClick={() => setError("")}>✕</button>
        </div>
      )}

      <div className="cord-mic-area">
        {uiState !== "idle" ? (
          <button className={micClass()} onClick={handleStop}>
            {uiState === "listening" ? (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <line x1="12" y1="19" x2="12" y2="22" />
                <line x1="8" y1="22" x2="16" y2="22" />
              </svg>
            ) : "■"}
          </button>
        ) : (
          <button className="mic-btn mic-idle" onClick={handleMicClick} title="Speak to CORD">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="8" y1="22" x2="16" y2="22" />
            </svg>
          </button>
        )}
        <div className="cord-mic-label">ASK CORD</div>
      </div>

      <div className="cord-wordmark">CORD</div>
    </div>
  );
}
