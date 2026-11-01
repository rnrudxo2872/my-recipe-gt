import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router";
import { AuthHead, AuthLayout, FormError } from "../components/AuthLayout";
import { api, ApiError } from "../lib/api";
import { useConfig, useDocumentTitle } from "../lib/hooks";
import { useToast } from "../lib/toast";
import { rememberDevLink } from "./Verify";

interface FailState {
  message: string;
  code?: string;
}

export function Login() {
  useDocumentTitle("로그인");
  const config = useConfig();
  const qc = useQueryClient();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<FailState | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);

  // 시도 횟수를 넘기면 풀릴 때까지 입력을 잠가 둔다.
  useEffect(() => {
    if (!lockedUntil) return;
    const t = window.setTimeout(
      () => {
        setLockedUntil(0);
        setError(null);
      },
      Math.max(0, lockedUntil - Date.now()),
    );
    return () => window.clearTimeout(t);
  }, [lockedUntil]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(email, password);
      // me를 다시 받으면 App이 로그인 상태 화면으로 바꾸고, /login 경로가 next로 보내 준다.
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ message: err.message, code: err.code });
        if (err.code === "too_many_attempts") setLockedUntil(err.resetAt ?? Date.now() + 15 * 60 * 1000);
      } else {
        setError({ message: "로그인하지 못했어요. 다시 시도해 주세요." });
      }
      setBusy(false);
    }
  }

  const locked = lockedUntil > 0;
  const wrong = error?.code === "bad_credentials" || undefined;

  return (
    <AuthLayout>
      <AuthHead title="로그인" lead={locked ? undefined : "저장해 둔 레시피를 이어서 볼 수 있어요."} muted={locked} />
      {error && <FormError message={error.message} code={error.code} />}
      <form onSubmit={submit} noValidate>
        <fieldset className={locked ? "auth-fields is-locked" : "auth-fields"} disabled={busy || locked}>
          <label className="field">
            <span className="label">이메일</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              aria-invalid={wrong}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">비밀번호</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={wrong}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary btn-block btn-lg auth-submit" disabled={!email || !password}>
            {busy && <LoaderCircle className="spinner" aria-hidden="true" />}
            {busy ? "로그인하는 중…" : "로그인"}
          </button>
        </fieldset>
      </form>
      <div className={busy ? "auth-foot is-muted" : "auth-foot"}>
        {config.data?.passwordReset ? (
          <Link to="/forgot" className="auth-quiet-link">
            비밀번호를 잊었나요?
          </Link>
        ) : (
          <p className="auth-note">
            비밀번호를 잊었다면 관리자에게
            <br />
            임시 비밀번호를 받아 주세요.
          </p>
        )}
        <hr />
        <p>
          처음이라면{" "}
          <Link to={`/signup${location.search}`} className="link-brand">
            가입하기
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback"?: () => void; language?: string }) => string;
      reset: (id?: string) => void;
    };
  }
}

/** Cloudflare Turnstile(자동 가입 방지). 관리자가 키를 넣었을 때만 나온다. */
function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    const render = () => {
      if (cancelled || !ref.current || !window.turnstile) return;
      ref.current.innerHTML = "";
      window.turnstile.render(ref.current, { sitekey: siteKey, callback: onToken, "expired-callback": () => onToken(""), language: "ko" });
    };
    if (window.turnstile) render();
    else {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
    return () => {
      cancelled = true;
    };
  }, [siteKey, onToken]);
  return <div ref={ref} style={{ minHeight: 65, marginBottom: 16 }} />;
}

export function Signup() {
  useDocumentTitle("가입하기");
  const qc = useQueryClient();
  const toast = useToast();
  const config = useConfig();
  const [form, setForm] = useState({ name: "", email: "", password: "", website: "" });
  const [token, setToken] = useState("");
  const [error, setError] = useState<FailState | null>(null);
  const [busy, setBusy] = useState(false);
  const siteKey = config.data?.turnstileSiteKey ?? "";
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.password.length < 8) {
      setError({ message: "비밀번호는 8자 이상이어야 해요." });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.signup({ ...form, turnstile: token || undefined });
      rememberDevLink(res.devLink);
      if (res.mailError) toast.show(res.mailError, { tone: "error" });
      // me가 바뀌면 /signup 경로가 next(내부 주소만)로 보내 준다.
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      setError(err instanceof ApiError ? { message: err.message, code: err.code } : { message: "가입하지 못했어요. 다시 시도해 주세요." });
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <AuthHead title="가입하기" lead="이메일과 비밀번호만 있으면 돼요." />
      {error && <FormError message={error.message} code={error.code} />}
      <form onSubmit={submit} noValidate>
        <fieldset className="auth-fields" disabled={busy}>
          <label className="field">
            <span className="label">이름</span>
            <input className="input" autoComplete="nickname" maxLength={20} placeholder="레시피에 표시할 이름" value={form.name} onChange={set("name")} />
          </label>
          <label className="field">
            <span className="label">이메일</span>
            <input className="input" type="email" autoComplete="email" inputMode="email" required value={form.email} onChange={set("email")} />
          </label>
          <label className="field">
            <span className="label">비밀번호</span>
            <input className="input" type="password" autoComplete="new-password" minLength={8} required value={form.password} onChange={set("password")} />
            <span className="help">8자 이상</span>
          </label>
          <label className="hp" aria-hidden="true">
            웹사이트
            <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
          </label>
          {siteKey && <Turnstile siteKey={siteKey} onToken={setToken} />}
          <button type="submit" className="btn btn-primary btn-block btn-lg auth-submit" disabled={!form.email || !form.password || Boolean(siteKey && !token)}>
            {busy && <LoaderCircle className="spinner" aria-hidden="true" />}
            {busy ? "가입하는 중…" : "가입하고 시작하기"}
          </button>
        </fieldset>
      </form>
      <p className="auth-note" style={{ marginTop: 16 }}>
        레시피를 정리할 때 링크와 글 내용이 AI(Google Gemini)로 보내져요. 개인정보는 넣지 마세요.
      </p>
      <div className={busy ? "auth-foot is-muted" : "auth-foot"}>
        <hr />
        <p>
          이미 계정이 있다면{" "}
          <Link to="/login" className="link-brand">
            로그인
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
