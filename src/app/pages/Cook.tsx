import { ArrowLeft, ArrowRight, Check, ListChecks, Pause, Play, Timer, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { detectStepMinutes, formatAmount } from "../../shared/recipe";
import { CookedSheet } from "../components/CookedSheet";
import { TermText } from "../components/TermText";
import { Sheet } from "../components/Sheet";
import { useDocumentTitle, useRecipe } from "../lib/hooks";
import { useToast } from "../lib/toast";

/** 요리하는 동안 화면이 꺼지지 않게 한다. */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        if ("wakeLock" in navigator && document.visibilityState === "visible") {
          lock = await navigator.wakeLock.request("screen");
          if (cancelled) lock.release();
        }
      } catch {
        // 지원하지 않거나 배터리 절약 모드
      }
    };
    request();
    const onVisible = () => document.visibilityState === "visible" && request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, []);
}

function beep() {
  try {
    const ctx = new AudioContext();
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.35);
      osc.stop(ctx.currentTime + i * 0.35 + 0.2);
    }
    navigator.vibrate?.([300, 150, 300, 150, 300]);
  } catch {
    // 소리를 못 내도 화면 표시는 남는다
  }
}

interface TimerState {
  endsAt: number;
  pausedLeft: number | null;
  total: number;
}

function formatLeft(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Cook() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const factor = Number(params.get("x")) > 0 ? Number(params.get("x")) : 1;
  const { data: recipe } = useRecipe(id);
  useDocumentTitle(recipe ? `요리 중: ${recipe.title}` : "요리 모드");
  const navigate = useNavigate();
  const toast = useToast();
  const [idx, setIdx] = useState(0);
  const [showIngs, setShowIngs] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [now, setNow] = useState(Date.now());
  const rang = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  useWakeLock();

  const steps = recipe?.content.steps ?? [];
  const last = steps.length - 1;
  const go = useCallback((n: number) => setIdx((i) => Math.max(0, Math.min(last, i + n))), [last]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  useEffect(() => {
    if (!timer || timer.pausedLeft != null) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [timer]);

  const left = timer ? (timer.pausedLeft ?? timer.endsAt - now) : 0;
  const timerDone = Boolean(timer && timer.pausedLeft == null && left <= 0);

  useEffect(() => {
    if (timerDone && !rang.current) {
      rang.current = true;
      beep();
      toast.show("타이머가 끝났어요.");
    }
  }, [timerDone, toast]);

  if (!recipe) {
    return (
      <div className="cook">
        <div className="center-load">불러오는 중…</div>
      </div>
    );
  }

  const step = steps[idx] ?? "";
  const minutes = detectStepMinutes(step);
  const exit = () => navigate(`/r/${recipe.id}`, { replace: true });

  function startTimer(min: number) {
    rang.current = false;
    setNow(Date.now());
    setTimer({ endsAt: Date.now() + min * 60_000, pausedLeft: null, total: min });
  }

  return (
    <div
      className="cook"
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const start = touch.current;
        touch.current = null;
        if (!start) return;
        const dx = e.changedTouches[0].clientX - start.x;
        const dy = e.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="cook-top">
        <button type="button" className="icon-btn" aria-label="요리 모드 끝내기" onClick={exit}>
          <X />
        </button>
        <span className="title">{recipe.title}</span>
        <button type="button" className="btn btn-soft btn-sm" onClick={() => setShowIngs(true)}>
          <ListChecks aria-hidden="true" />
          재료
        </button>
      </div>
      <div className="cook-progress" aria-hidden="true">
        {steps.map((_, i) => (
          <span key={i} className={i <= idx ? "on" : ""} />
        ))}
      </div>

      {timer && (
        <div className={`timer-pill ${timerDone ? "is-done" : ""}`} role="timer" aria-live="off">
          <Timer aria-hidden="true" />
          <span className="num">{timerDone ? "끝!" : formatLeft(left)}</span>
          {!timerDone && (
            <button
              type="button"
              aria-label={timer.pausedLeft != null ? "타이머 계속" : "타이머 멈춤"}
              onClick={() =>
                setTimer((t) =>
                  t ? (t.pausedLeft != null ? { ...t, endsAt: Date.now() + t.pausedLeft, pausedLeft: null } : { ...t, pausedLeft: t.endsAt - Date.now() }) : t,
                )
              }
            >
              {timer.pausedLeft != null ? <Play /> : <Pause />}
            </button>
          )}
          <button type="button" aria-label="타이머 닫기" onClick={() => setTimer(null)}>
            <X />
          </button>
        </div>
      )}

      <div className="cook-stage" aria-live="polite">
        {steps.length ? (
          <>
            <p className="cook-step-no">
              {idx + 1} / {steps.length}
            </p>
            <p className="cook-text">
              <TermText text={step} />
            </p>
            {minutes && (
              <div className="cook-timer">
                <button type="button" className="btn btn-soft" onClick={() => startTimer(minutes)}>
                  <Timer aria-hidden="true" />
                  {minutes}분 타이머 시작
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="cook-text">적힌 순서가 없어요. 직접 수정에서 만드는 법을 적어 주세요.</p>
        )}
      </div>

      <div className="cook-nav">
        <button type="button" className="btn btn-soft" onClick={() => go(-1)} disabled={idx === 0}>
          <ArrowLeft aria-hidden="true" />
          이전
        </button>
        {idx < last ? (
          <button type="button" className="btn btn-primary" onClick={() => go(1)}>
            다음
            <ArrowRight aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setFinishing(true)}>
            <Check aria-hidden="true" />
            완성
          </button>
        )}
      </div>

      {finishing && <CookedSheet open onClose={() => setFinishing(false)} recipe={recipe} factor={factor} onDone={exit} />}

      <Sheet open={showIngs} onClose={() => setShowIngs(false)} title="재료">
        <ul className="ing-list">
          {recipe.content.ingredients.map((ing, i) => (
            <li className="ing" key={i}>
              <button type="button" tabIndex={-1} style={{ cursor: "default" }}>
                <span className="ing-name">
                  {ing.group && <span className="ing-note">{ing.group}</span>}
                  {ing.name}
                  {ing.note && <span className="ing-note">{ing.note}</span>}
                </span>
                <span className="ing-amount">{formatAmount(ing, factor)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}
