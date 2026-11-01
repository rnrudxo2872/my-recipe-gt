import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, MailCheck, TriangleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AuthHead, AuthLayout, FormError } from "../components/AuthLayout";
import { ApiError, api } from "../lib/api";
import { useDocumentTitle } from "../lib/hooks";
import { useToast } from "../lib/toast";
import { SpamHint } from "./Verify";

/** 비밀번호 찾기: 이메일로 재설정 링크를 받는다. */
export function Forgot() {
  useDocumentTitle("비밀번호 찾기");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [sent, setSent] = useState<{ devLink?: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSent(await api.forgotPassword(email));
    } catch (err) {
      setError(err instanceof ApiError ? { message: err.message, code: err.code } : { message: "메일을 보내지 못했어요. 잠시 뒤에 다시 시도해 주세요." });
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout>
        <div className="status-icon" aria-hidden="true">
          <MailCheck />
        </div>
        <AuthHead
          title="메일함을 확인해 주세요"
          lead={
            <>
              가입된 이메일이면 <strong>{email}</strong>(으)로 비밀번호를 새로 정하는 링크를 보냈어요. 링크는 1시간 동안 쓸 수 있어요.
            </>
          }
        />
        {sent.devLink && (
          <div className="notice is-warn" style={{ marginBottom: 16 }}>
            <TriangleAlert aria-hidden="true" />
            <span>
              시험 모드라 메일을 보내지 않았어요. <a href={sent.devLink}>재설정 링크 열기</a>
            </span>
          </div>
        )}
        <Link to="/login" className="btn btn-block btn-lg">
          로그인으로 돌아가기
        </Link>
        <SpamHint />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthHead title="비밀번호 찾기" lead="가입한 이메일로 비밀번호를 새로 정하는 링크를 보내 드려요." />
      {error && <FormError message={error.message} code={error.code} />}
      <form onSubmit={submit} noValidate>
        <fieldset className="auth-fields" disabled={busy}>
          <label className="field">
            <span className="label">이메일</span>
            <input className="input" type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary btn-block btn-lg auth-submit" disabled={!email}>
            {busy && <LoaderCircle className="spinner" aria-hidden="true" />}
            {busy ? "보내는 중…" : "재설정 링크 받기"}
          </button>
        </fieldset>
      </form>
      <div className="auth-foot">
        <hr />
        <Link to="/login" className="auth-quiet-link">
          로그인으로 돌아가기
        </Link>
      </div>
    </AuthLayout>
  );
}

/** 메일의 재설정 링크(/reset?token=...)에서 새 비밀번호를 정한다. */
export function Reset() {
  useDocumentTitle("새 비밀번호");
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const token = params.get("token") ?? "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("비밀번호는 8자 이상이어야 해요.");
    if (password !== confirm) return setError("두 비밀번호가 서로 달라요.");
    setBusy(true);
    setError("");
    try {
      await api.resetPassword(token, password);
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.show("비밀번호를 바꿨어요. 다른 기기에서는 다시 로그인해 주세요.");
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "비밀번호를 바꾸지 못했어요.");
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <AuthHead title="새 비밀번호 정하기" lead="바꾸면 다른 기기에서 로그인한 것은 모두 풀려요." />
      {error && (
        <FormError message={error}>
          {/만료|이미 쓴/.test(error) && (
            <>
              {" "}
              <Link to="/forgot">다시 받기</Link>
            </>
          )}
        </FormError>
      )}
      <form onSubmit={submit} noValidate>
        <fieldset className="auth-fields" disabled={busy}>
          <label className="field">
            <span className="label">새 비밀번호</span>
            <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <span className="help">8자 이상</span>
          </label>
          <label className="field">
            <span className="label">한 번 더</span>
            <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary btn-block btn-lg auth-submit" disabled={!password || !confirm || !token}>
            {busy && <LoaderCircle className="spinner" aria-hidden="true" />}
            {busy ? "바꾸는 중…" : "비밀번호 바꾸기"}
          </button>
        </fieldset>
      </form>
    </AuthLayout>
  );
}
