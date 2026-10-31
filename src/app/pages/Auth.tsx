import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { api, ApiError } from "../lib/api";
import { useConfig, useDocumentTitle } from "../lib/hooks";
import { useToast } from "../lib/toast";

function Brand() {
  return (
    <Link to="/" className="brand">
      <img src="/icons/logo-96.png" alt="" />
      <span>레시피GT</span>
    </Link>
  );
}

export function Login() {
  useDocumentTitle("로그인");
  const qc = useQueryClient();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(email, password);
      // me를 다시 받으면 App이 로그인 상태 화면으로 바꾸고, /login 경로가 next로 보내 준다.
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "로그인하지 못했어요. 다시 시도해 주세요.");
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <Brand />
      <h1>로그인</h1>
      <p className="auth-lead">저장해 둔 레시피를 이어서 볼 수 있어요.</p>
      <form onSubmit={submit} noValidate>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <label className="field">
          <span className="label">이메일</span>
          <input className="input" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">비밀번호</span>
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !email || !password}>
          {busy ? "로그인하는 중…" : "로그인"}
        </button>
      </form>
      <p className="auth-switch">
        처음이라면 <Link to={`/signup${location.search}`}>가입하기</Link>
      </p>
      <p className="help" style={{ textAlign: "center", marginTop: 12 }}>
        비밀번호를 잊었다면 관리자에게 임시 비밀번호를 받아 주세요.
      </p>
    </div>
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
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const config = useConfig();
  const [form, setForm] = useState({ name: "", email: "", password: "", invite: params.get("invite") ?? "", website: "" });
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const siteKey = config.data?.turnstileSiteKey ?? "";
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.password.length < 8) {
      setError("비밀번호는 8자 이상이어야 해요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api.signup({ ...form, invite: form.invite.trim() || undefined, turnstile: token || undefined });
      if (res.inviteAccepted) toast.show("지인 초대 코드를 확인했어요. 사용량 제한 없이 쓸 수 있어요.");
      if (res.inviteRejected) toast.show("초대 코드를 쓸 수 없어서 일반 계정으로 가입했어요. 내 정보에서 다시 넣을 수 있어요.", { tone: "error" });
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate(params.get("next") ?? "/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "가입하지 못했어요. 다시 시도해 주세요.");
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <Brand />
      <h1>가입하기</h1>
      <p className="auth-lead">이메일과 비밀번호만 있으면 돼요.</p>
      <form onSubmit={submit} noValidate>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
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
        <label className="field">
          <span className="label">초대 코드 (선택)</span>
          <input className="input" autoCapitalize="characters" autoComplete="off" value={form.invite} onChange={set("invite")} />
          <span className="help">지인에게 받은 코드가 있으면 넣어 주세요. 사용량 제한 없이 쓸 수 있어요.</span>
        </label>
        <label className="hp" aria-hidden="true">
          웹사이트
          <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
        </label>
        {siteKey && <Turnstile siteKey={siteKey} onToken={setToken} />}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !form.email || !form.password || Boolean(siteKey && !token)}>
          {busy ? "가입하는 중…" : "가입하고 시작하기"}
        </button>
      </form>
      <p className="auth-switch">
        이미 계정이 있다면 <Link to="/login">로그인</Link>
      </p>
    </div>
  );
}
