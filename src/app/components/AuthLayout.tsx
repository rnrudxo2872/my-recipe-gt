import { Ban, CircleAlert, Clock } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

/** 로그인·가입처럼 계정을 다루는 화면의 틀: 연회색 바탕 위 흰 카드, 맨 위에 로고 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <main className="auth-card">
        <div className="auth">
          <Link to="/" className="auth-brand">
            <img src="/icons/logo-96.png" alt="" />
            <span>레시퐁</span>
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}

/** 계정 화면 제목과 한 줄 설명 */
export function AuthHead({ title, lead, muted }: { title: string; lead?: ReactNode; muted?: boolean }) {
  return (
    <div className={muted ? "auth-head is-muted" : "auth-head"}>
      <h1>{title}</h1>
      {lead && <p>{lead}</p>}
    </div>
  );
}

/**
 * 오류 상자. 시도 횟수를 넘기면 시계, 차단된 계정은 금지 표시, 그 밖에는 느낌표.
 * 차단 사유는 "…계정이에요. (사유)" 꼴로 오므로 한 줄 아래 작은 글씨로 나눈다.
 */
export function FormError({ message, code, children }: { message: string; code?: string; children?: ReactNode }) {
  const Icon = code === "too_many_attempts" ? Clock : code === "blocked" ? Ban : CircleAlert;
  const reason = code === "blocked" ? message.match(/^(.*?)\s*\((.+)\)$/) : null;
  return (
    <div className="form-error" role="alert">
      <Icon aria-hidden="true" />
      <p>
        {reason ? reason[1] : message}
        {reason && <small>사유: {reason[2]}</small>}
        {children}
      </p>
    </div>
  );
}
