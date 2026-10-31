import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Download, KeyRound, LogOut, Pencil, Shield, Ticket, TriangleAlert, UserX } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { QuotaKind } from "../../shared/api";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { useDocumentTitle, useMe, useUser } from "../lib/hooks";
import { formatClock } from "../lib/text";
import { useToast } from "../lib/toast";

const ROLE_LABEL = { admin: "관리자", friend: "지인", member: "일반" } as const;

const METERS: { kind: QuotaKind; label: string }[] = [
  { kind: "import", label: "링크 가져오기" },
  { kind: "ai", label: "AI 기능 (대체 재료, 맛 조정, 추천)" },
  { kind: "video", label: "영상 직접 분석" },
  { kind: "upload", label: "사진 올리기" },
];

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
}

function useInstallPrompt() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);
  return prompt;
}

export function Me() {
  useDocumentTitle("내 정보");
  const me = useUser();
  const { refetch } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [sheet, setSheet] = useState<null | "name" | "password" | "delete">(null);
  const [code, setCode] = useState("");
  const install = useInstallPrompt();
  const standalone = typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches;
  const isIos = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const redeem = useMutation({
    mutationFn: () => api.redeemInvite(code),
    onSuccess: async () => {
      setCode("");
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.show("지인 계정이 됐어요. 이제 사용량 제한 없이 쓸 수 있어요.");
    },
    onError: (e) => toast.error(e),
  });

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(["me"], null);
    },
  });

  const { user } = me;

  return (
    <div className="page">
      <div className="profile">
        <div className="avatar" aria-hidden="true">
          {user.name.charAt(0)}
        </div>
        <div style={{ minWidth: 0 }}>
          <h1>{user.name}</h1>
          <p className="email">{user.email}</p>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <span className={`badge ${user.role === "admin" ? "is-admin" : user.role === "friend" ? "is-friend" : ""}`}>{ROLE_LABEL[user.role]} 계정</span>
            {user.status === "limited" && <span className="badge is-limited">한도 줄어듦</span>}
          </div>
        </div>
      </div>

      {user.status === "limited" && (
        <div className="notice is-warn" style={{ marginBottom: 16 }}>
          <TriangleAlert aria-hidden="true" />
          <span>
            <strong>사용량이 많아 하루 한도가 줄어든 계정이에요.</strong>
            {user.statusReason ? ` (${user.statusReason})` : ""} 지인이라면 초대 코드를 넣거나 관리자에게 알려 주세요.
          </span>
        </div>
      )}

      {me.unlimited ? (
        <div className="card">
          <h2>사용량</h2>
          <p className="card-sub" style={{ margin: 0 }}>
            {user.role === "admin" ? "관리자 계정" : "지인 계정"}이라 사용량 제한 없이 쓸 수 있어요.
          </p>
        </div>
      ) : (
        me.limits && (
          <div className="card">
            <h2>오늘 남은 사용량</h2>
            <p className="card-sub">매일 자정({formatClock(me.resetAt)})에 다시 채워져요.</p>
            <div className="meters">
              {METERS.map(({ kind, label }) => {
                const limit = me.limits![kind];
                const used = Math.min(limit, me.usage[kind]);
                const left = Math.max(0, limit - used);
                return (
                  <div key={kind}>
                    <div className="meter-top">
                      <span>{label}</span>
                      <span className="num">
                        {left}번 남음 <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>/ {limit}</span>
                      </span>
                    </div>
                    <div
                      className={`meter ${left === 0 ? "is-full" : ""}`}
                      role="progressbar"
                      aria-label={`${label} 남은 횟수`}
                      aria-valuemin={0}
                      aria-valuemax={limit}
                      aria-valuenow={left}
                    >
                      <div style={{ width: `${limit ? (left / limit) * 100 : 0}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}

      {user.role === "member" && (
        <form
          className="card"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (code.trim()) redeem.mutate();
          }}
        >
          <h2>초대 코드</h2>
          <p className="card-sub">지인에게 받은 코드를 넣으면 사용량 제한 없이 쓸 수 있어요.</p>
          <div className="inline-form">
            <input className="input" value={code} autoCapitalize="characters" placeholder="코드 8자리" aria-label="초대 코드" onChange={(e) => setCode(e.target.value)} />
            <button type="submit" className="btn" disabled={!code.trim() || redeem.isPending}>
              <Ticket aria-hidden="true" />
              등록
            </button>
          </div>
        </form>
      )}

      {!standalone && (install || isIos) && (
        <div className="card">
          <h2>휴대폰에 설치</h2>
          <p className="card-sub">설치하면 앱처럼 열리고, 유튜브·인스타의 공유하기로 링크를 바로 보낼 수 있어요.</p>
          {install ? (
            <button type="button" className="btn btn-block" onClick={() => install.prompt()}>
              <Download aria-hidden="true" />앱 설치하기
            </button>
          ) : (
            <p className="help">사파리 아래쪽 공유 버튼을 누르고 '홈 화면에 추가'를 골라 주세요.</p>
          )}
        </div>
      )}

      <div className="card">
        <div className="menu-list">
          <button type="button" className="menu-item" onClick={() => setSheet("name")}>
            <Pencil aria-hidden="true" />
            이름 바꾸기
            <ChevronRight className="chev" aria-hidden="true" />
          </button>
          <button type="button" className="menu-item" onClick={() => setSheet("password")}>
            <KeyRound aria-hidden="true" />
            비밀번호 바꾸기
            <ChevronRight className="chev" aria-hidden="true" />
          </button>
          {user.role === "admin" && (
            <Link to="/admin" className="menu-item">
              <Shield aria-hidden="true" />
              관리
              <ChevronRight className="chev" aria-hidden="true" />
            </Link>
          )}
          <button type="button" className="menu-item" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogOut aria-hidden="true" />
            로그아웃
          </button>
          <button type="button" className="menu-item is-danger" onClick={() => setSheet("delete")}>
            <UserX aria-hidden="true" />
            계정 지우기
          </button>
        </div>
      </div>

      <NameSheet open={sheet === "name"} onClose={() => setSheet(null)} current={user.name} />
      <PasswordSheet open={sheet === "password"} onClose={() => setSheet(null)} />
      <DeleteSheet open={sheet === "delete"} onClose={() => setSheet(null)} />
    </div>
  );
}

function NameSheet(props: { open: boolean; onClose: () => void; current: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(props.current);
  useEffect(() => setName(props.current), [props.current, props.open]);
  const save = useMutation({
    mutationFn: () => api.rename(name.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.show("이름을 바꿨어요.");
      props.onClose();
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title="이름 바꾸기"
      footer={
        <button type="button" className="btn btn-primary btn-block" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          이름 저장
        </button>
      }
    >
      <label className="field">
        <span className="label">이름</span>
        <input className="input" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
      </label>
    </Sheet>
  );
}

function PasswordSheet(props: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const save = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      toast.show("비밀번호를 바꿨어요.");
      props.onClose();
    },
  });
  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title="비밀번호 바꾸기"
      footer={
        <button type="button" className="btn btn-primary btn-block" disabled={!current || next.length < 8 || save.isPending} onClick={() => save.mutate()}>
          비밀번호 바꾸기
        </button>
      }
    >
      {save.isError && <p className="form-error">{save.error.message}</p>}
      <label className="field">
        <span className="label">지금 비밀번호</span>
        <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">새 비밀번호</span>
        <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <span className="help">8자 이상</span>
      </label>
    </Sheet>
  );
}

function DeleteSheet(props: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const remove = useMutation({
    mutationFn: () => api.deleteAccount(password),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(["me"], null);
    },
  });
  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title="계정을 지울까요?"
      footer={
        <div className="btn-row">
          <button type="button" className="btn" onClick={props.onClose}>
            그대로 두기
          </button>
          <button type="button" className="btn btn-danger" disabled={!password || remove.isPending} onClick={() => remove.mutate()}>
            계정 지우기
          </button>
        </div>
      }
    >
      <p style={{ marginBottom: 16 }}>저장한 레시피와 사진이 모두 지워지고 되돌릴 수 없어요.</p>
      {remove.isError && <p className="form-error">{remove.error.message}</p>}
      <label className="field">
        <span className="label">비밀번호 확인</span>
        <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
    </Sheet>
  );
}
