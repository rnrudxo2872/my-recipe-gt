import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, MailCheck, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiError, api } from "../lib/api";
import { useDocumentTitle, useMe } from "../lib/hooks";
import { useToast } from "../lib/toast";

/** 로컬 시험 모드에서 받은 인증 링크. 가입 직후 화면에서 보여 주려고 잠깐 보관한다. */
export const DEV_LINK_KEY = "rgt-dev-link";

function readDevLink(): string | null {
  try {
    return sessionStorage.getItem(DEV_LINK_KEY);
  } catch {
    return null;
  }
}

export function rememberDevLink(link: string | undefined) {
  try {
    if (link) sessionStorage.setItem(DEV_LINK_KEY, link);
  } catch {
    // 저장소를 못 써도 다시 보내기로 받을 수 있다
  }
}

function Brand() {
  return (
    <span className="brand">
      <img src="/icons/logo-96.png" alt="" />
      <span>레시퐁</span>
    </span>
  );
}

/** 가입은 했지만 이메일 인증 전. 인증을 마칠 때까지 이 화면만 보인다. */
export function VerifyPending() {
  useDocumentTitle("이메일 인증");
  const { data: me, refetch } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [cooldown, setCooldown] = useState(60);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [devLink, setDevLink] = useState<string | null>(readDevLink);

  // 다른 기기(휴대폰 메일 앱)에서 인증하면 여기서도 알아서 넘어간다.
  useEffect(() => {
    const t = window.setInterval(() => refetch(), 5000);
    return () => window.clearInterval(t);
  }, [refetch]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  async function resend() {
    setSending(true);
    setError("");
    try {
      const r = await api.resendVerification();
      if (r.devLink) {
        rememberDevLink(r.devLink);
        setDevLink(r.devLink);
      }
      toast.show("인증 메일을 다시 보냈어요.");
      setCooldown(60);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "메일을 보내지 못했어요. 잠시 뒤에 다시 시도해 주세요.");
    } finally {
      setSending(false);
    }
  }

  async function changeEmail(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      const r = await api.changeEmail(email);
      if (r.devLink) {
        rememberDevLink(r.devLink);
        setDevLink(r.devLink);
      }
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.show("새 주소로 인증 메일을 보냈어요.");
      setEditing(false);
      setCooldown(60);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "주소를 바꾸지 못했어요.");
    } finally {
      setSending(false);
    }
  }

  async function logout() {
    await api.logout().catch(() => {});
    qc.clear();
    qc.setQueryData(["me"], null);
  }

  return (
    <div className="auth">
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
        <Brand />
      </div>
      <div className="verify-icon" aria-hidden="true">
        <MailCheck />
      </div>
      <h1>메일함을 확인해 주세요</h1>
      <p className="auth-lead">
        <strong>{me?.user.email}</strong>(으)로 인증 메일을 보냈어요.
        <br />
        메일의 <strong>이메일 인증하기</strong> 버튼을 누르면 바로 시작할 수 있어요.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {devLink && (
        <div className="notice is-warn" style={{ marginBottom: 16 }}>
          <TriangleAlert aria-hidden="true" />
          <span>
            시험 모드라 메일을 보내지 않았어요. <a href={devLink}>인증 링크 열기</a>
          </span>
        </div>
      )}

      <button type="button" className="btn btn-primary btn-block" disabled={sending || cooldown > 0} onClick={resend}>
        <RotateCcw aria-hidden="true" />
        {cooldown > 0 ? `인증 메일 다시 보내기 (${cooldown}초)` : "인증 메일 다시 보내기"}
      </button>
      <p className="help" style={{ textAlign: "center", marginTop: 12 }}>
        메일이 안 보이면 스팸함도 확인해 주세요. 인증하면 이 화면은 저절로 넘어가요.
      </p>

      <div className="card" style={{ marginTop: 24 }}>
        {editing ? (
          <form onSubmit={changeEmail}>
            <label className="field">
              <span className="label">새 이메일 주소</span>
              <input className="input" type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                그대로 두기
              </button>
              <button type="submit" className="btn btn-primary" disabled={sending || !email}>
                이 주소로 보내기
              </button>
            </div>
          </form>
        ) : (
          <p style={{ textAlign: "center", color: "var(--ink-2)", fontSize: 15 }}>
            이메일 주소가 틀렸나요?{" "}
            <button type="button" className="link-btn" onClick={() => setEditing(true)}>
              주소 바꾸기
            </button>
          </p>
        )}
      </div>

      <p className="auth-switch">
        <button type="button" className="link-btn" onClick={logout}>
          로그아웃
        </button>
      </p>
    </div>
  );
}

/** 메일의 인증 링크(/verify?token=...)를 열었을 때 */
export function VerifyToken() {
  useDocumentTitle("이메일 인증");
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = params.get("token") ?? "";
    api
      .verifyEmail(token)
      .then(async () => {
        try {
          sessionStorage.removeItem(DEV_LINK_KEY);
        } catch {
          // 무시
        }
        await qc.invalidateQueries({ queryKey: ["me"] });
        setState("done");
      })
      .catch((e) => {
        setMessage(e instanceof ApiError ? e.message : "인증하지 못했어요. 다시 시도해 주세요.");
        setState("error");
      });
  }, [params, qc]);

  return (
    <div className="auth">
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
        <Brand />
      </div>
      {state === "working" && (
        <div className="ai-wait" aria-busy="true">
          <img src="/icons/logo-96.png" alt="" />
          <p>이메일을 인증하고 있어요</p>
        </div>
      )}
      {state === "done" && (
        <>
          <div className="verify-icon is-done" aria-hidden="true">
            <CircleCheck />
          </div>
          <h1>인증을 마쳤어요</h1>
          <p className="auth-lead">{me ? "이제 레시피를 정리해 볼까요?" : "로그인하면 바로 시작할 수 있어요."}</p>
          {me ? (
            <button type="button" className="btn btn-primary btn-block" onClick={() => navigate("/", { replace: true })}>
              시작하기
            </button>
          ) : (
            <Link to="/login" className="btn btn-primary btn-block">
              로그인
            </Link>
          )}
        </>
      )}
      {state === "error" && (
        <>
          <div className="verify-icon is-error" aria-hidden="true">
            <TriangleAlert />
          </div>
          <h1>인증하지 못했어요</h1>
          <p className="auth-lead">{message}</p>
          <Link to={me ? "/" : "/login"} className="btn btn-primary btn-block">
            {me ? "인증 메일 다시 받기" : "로그인"}
          </Link>
        </>
      )}
    </div>
  );
}
