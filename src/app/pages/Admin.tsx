import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AdminOverview, AdminUserRow, Limits, Policy, Role, UserStatus } from "../../shared/api";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { useDocumentTitle, useUser } from "../lib/hooks";
import { relativeTime } from "../lib/text";
import { useToast } from "../lib/toast";

type Tab = "users" | "usage" | "events";

const ROLE: Record<Role, string> = { admin: "관리자", friend: "지인", member: "일반" };
const STATUS: Record<UserStatus, string> = { active: "정상", limited: "제한", blocked: "차단" };

function RoleBadge({ role }: { role: Role }) {
  return <span className={`badge ${role === "admin" ? "is-admin" : role === "friend" ? "is-friend" : ""}`}>{ROLE[role]}</span>;
}

function StatusBadge({ status }: { status: UserStatus }) {
  if (status === "active") return null;
  return <span className={`badge ${status === "blocked" ? "is-blocked" : "is-limited"}`}>{STATUS[status]}</span>;
}

export function Admin() {
  useDocumentTitle("관리");
  const [tab, setTab] = useState<Tab>("users");
  const overview = useQuery({ queryKey: ["admin"], queryFn: api.admin.overview, refetchInterval: 60_000 });

  return (
    <div className="page">
      <div className="page-head">
        <h1>관리</h1>
      </div>
      <div className="tabs" role="tablist" aria-label="관리 메뉴">
        {(
          [
            ["users", "사용자"],
            ["usage", "사용량·한도"],
            ["events", "기록"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {overview.isPending ? (
        <div className="skeleton" style={{ height: 300 }} />
      ) : overview.isError ? (
        <p className="form-error">관리 정보를 불러오지 못했어요. {overview.error.message}</p>
      ) : tab === "users" ? (
        <Users data={overview.data} />
      ) : tab === "usage" ? (
        <Usage data={overview.data} />
      ) : (
        <Events data={overview.data} />
      )}
    </div>
  );
}

function Users({ data }: { data: AdminOverview }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const order = { blocked: 0, limited: 1, active: 2 };
    return data.users
      .filter((u) => !s || u.name.toLowerCase().includes(s) || u.email.includes(s))
      .sort((a, b) => order[a.status] - order[b.status] || (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0));
  }, [data.users, q]);
  const counts = {
    friend: data.users.filter((u) => u.role !== "member").length,
    member: data.users.filter((u) => u.role === "member").length,
    flagged: data.users.filter((u) => u.status !== "active").length,
  };

  return (
    <>
      <RoleByEmail data={data} />
      <div className="stat-grid" style={{ marginBottom: 16, gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
        <div className="stat">
          <div className="value num">{counts.friend}</div>
          <div className="label">지인·관리자</div>
        </div>
        <div className="stat">
          <div className="value num">{counts.member}</div>
          <div className="label">일반</div>
        </div>
        <div className="stat">
          <div className="value num">{counts.flagged}</div>
          <div className="label">제한·차단</div>
        </div>
      </div>
      <label className="search" style={{ display: "block", marginBottom: 8 }}>
        <Search aria-hidden="true" />
        <span className="sr-only">사용자 찾기</span>
        <input className="input" type="search" placeholder="이름이나 이메일로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {list.map((u) => (
        <button type="button" className="user-row" key={u.id} onClick={() => setSelected(u)}>
          <span className="grow">
            <span className="name">
              {u.name}
              <RoleBadge role={u.role} />
              <StatusBadge status={u.status} />
              {!u.emailVerified && <span className="badge">미인증</span>}
            </span>
            <span className="sub" style={{ display: "block" }}>
              {u.email} · 레시피 {u.recipeCount}개 · {u.lastSeenAt ? relativeTime(u.lastSeenAt) : "접속 기록 없음"}
            </span>
          </span>
          <span className="today">
            오늘 AI {u.today.ai ?? 0}
            <br />
            링크 {u.today.import ?? 0}
            {(u.today.denied ?? 0) > 0 && (
              <>
                <br />
                <span style={{ color: "var(--danger)" }}>거절 {u.today.denied}</span>
              </>
            )}
          </span>
        </button>
      ))}
      <UserSheet user={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function UserSheet({ user, onClose }: { user: AdminUserRow | null; onClose: () => void }) {
  const me = useUser();
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [temp, setTemp] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    setReason("");
    setTemp(null);
    setConfirmDelete(false);
  }, [user?.id]);

  const update = useMutation({
    mutationFn: (body: { role?: Role; status?: UserStatus; reason?: string; verified?: boolean }) => api.admin.updateUser(user!.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      toast.show("바꿨어요.");
      onClose();
    },
    onError: (e) => toast.error(e),
  });
  const reset = useMutation({
    mutationFn: () => api.admin.resetPassword(user!.id),
    onSuccess: (r) => setTemp(r.password),
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({
    mutationFn: () => api.admin.deleteUser(user!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      toast.show("계정을 지웠어요.");
      onClose();
    },
    onError: (e) => toast.error(e),
  });

  const isMe = user?.id === me.user.id;

  return (
    <Sheet open={user != null} onClose={onClose} title={user?.name ?? ""}>
      {user && (
        <>
          <p className="help" style={{ marginBottom: 16 }}>
            {user.email} · 가입 {relativeTime(user.createdAt)}
            {user.statusReason && (
              <>
                <br />
                상태 사유: {user.statusReason}
              </>
            )}
          </p>

          {!user.emailVerified && (
            <div className="field">
              <span className="label">이메일 인증</span>
              <button type="button" className="btn btn-soft" disabled={update.isPending} onClick={() => update.mutate({ verified: true })}>
                인증한 것으로 처리
              </button>
              <span className="help">아직 메일 인증을 하지 않았어요. 아는 사람인데 메일이 안 간다면 직접 처리해 주세요.</span>
            </div>
          )}

          <div className="field">
            <span className="label">역할</span>
            <div className="chips">
              {(["friend", "member", "admin"] as Role[]).map((r) => (
                <button key={r} type="button" className="chip" aria-pressed={user.role === r} disabled={isMe || update.isPending} onClick={() => update.mutate({ role: r })}>
                  {ROLE[r]}
                </button>
              ))}
            </div>
            <span className="help">지인과 관리자는 사용량 제한이 없어요.</span>
          </div>

          <div className="field">
            <span className="label">상태</span>
            <input className="input" value={reason} placeholder="제한·차단 사유 (선택)" onChange={(e) => setReason(e.target.value)} disabled={isMe} />
            <div className="chips" style={{ marginTop: 8 }}>
              {(["active", "limited", "blocked"] as UserStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip"
                  aria-pressed={user.status === s}
                  disabled={isMe || update.isPending}
                  onClick={() => update.mutate({ status: s, reason: reason.trim() || undefined })}
                >
                  {STATUS[s]}
                </button>
              ))}
            </div>
            <span className="help">제한은 하루 한도를 크게 줄이고, 차단은 로그인을 막아요.</span>
          </div>

          <div className="field">
            <span className="label">비밀번호</span>
            {temp ? (
              <div className="code-box">
                {temp}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="복사"
                  onClick={() => navigator.clipboard?.writeText(temp).then(() => toast.show("임시 비밀번호를 복사했어요."))}
                >
                  <Copy />
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-soft" onClick={() => reset.mutate()} disabled={reset.isPending}>
                임시 비밀번호 만들기
              </button>
            )}
            <span className="help">만들면 기존 비밀번호와 로그인은 모두 풀려요. 본인에게 전달한 뒤 바꾸라고 알려 주세요.</span>
          </div>

          {!isMe &&
            (confirmDelete ? (
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                  그대로 두기
                </button>
                <button type="button" className="btn btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
                  레시피까지 모두 지우기
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-danger btn-block" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden="true" />
                계정 지우기
              </button>
            ))}
        </>
      )}
    </Sheet>
  );
}

/** 지인이 알려 준 이메일로 권한을 바로 바꾼다. 아직 가입 전이면 예약해 두었다가 가입·인증 때 적용한다. */
function RoleByEmail({ data }: { data: AdminOverview }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const set = useMutation({
    mutationFn: (role: Role) => api.admin.setRoleByEmail(email.trim(), role),
    onSuccess: (r, role) => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      toast.show(
        r.status === "updated"
          ? `${r.name}님을 ${ROLE[role]} 계정으로 바꿨어요.`
          : `아직 가입하지 않은 이메일이에요. 가입해서 인증을 마치면 ${ROLE[role]} 계정이 돼요.`,
      );
      setEmail("");
    },
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({
    mutationFn: (target: string) => api.admin.deleteGrant(target),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
    onError: (e) => toast.error(e),
  });
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <div className="card">
      <h2>이메일로 권한 바꾸기</h2>
      <p className="card-sub">지인이 가입한 이메일을 알려 주면 넣고 권한을 누르세요. 지인과 관리자는 사용량 제한이 없어요.</p>
      <input
        className="input"
        type="email"
        inputMode="email"
        autoComplete="off"
        placeholder="name@example.com"
        aria-label="권한을 바꿀 이메일"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-primary" disabled={!valid || set.isPending} onClick={() => set.mutate("friend")}>
          지인으로
        </button>
        <button type="button" className="btn" disabled={!valid || set.isPending} onClick={() => set.mutate("member")}>
          일반으로
        </button>
        <button type="button" className="btn btn-quiet" disabled={!valid || set.isPending} onClick={() => set.mutate("admin")}>
          관리자로
        </button>
      </div>
      {data.grants.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p className="label" style={{ marginBottom: 4 }}>
            가입하면 적용할 권한
          </p>
          {data.grants.map((g) => (
            <div className="user-row" key={g.email}>
              <span className="grow">
                <span className="name">
                  {g.email}
                  <RoleBadge role={g.role} />
                </span>
                <span className="sub" style={{ display: "block" }}>
                  {relativeTime(g.createdAt)} 예약 · 가입해서 인증을 마치면 적용돼요
                </span>
              </span>
              <button type="button" className="icon-btn" aria-label={`${g.email} 예약 지우기`} onClick={() => remove.mutate(g.email)}>
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const LIMIT_FIELDS: { key: keyof Limits; label: string }[] = [
  { key: "import", label: "링크 가져오기/일" },
  { key: "ai", label: "AI 기능/일" },
  { key: "video", label: "영상 분석/일" },
  { key: "upload", label: "사진 올리기/일" },
  { key: "save", label: "저장·수정/일" },
  { key: "burstPerMin", label: "AI 요청/분" },
  { key: "videoMaxMinutes", label: "영상 최대 길이(분)" },
  { key: "recipes", label: "레시피 저장 수" },
];

/** 요리 종류가 없는 레시피(이 기능 전에 저장한 것 등)를 AI로 한꺼번에 정한다. 40개씩 묶어 남은 게 없을 때까지 부른다. */
function Categorize({ left }: { left: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [progress, setProgress] = useState<{ done: number; left: number } | null>(null);
  const run = useMutation({
    mutationFn: async () => {
      let done = 0;
      for (;;) {
        const r = await api.admin.categorize();
        done += r.done;
        setProgress({ done, left: r.left });
        // AI가 남은 레시피를 하나도 정하지 못하면 같은 묶음만 되풀이하므로 멈춘다.
        if (r.left === 0 || r.done === 0) return { done, left: r.left };
      }
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      qc.invalidateQueries({ queryKey: ["recipes"] });
      toast.show(r.left ? `${r.done}개를 정했어요. ${r.left}개는 AI가 정하지 못했어요. 잠시 뒤 다시 눌러 주세요.` : `레시피 ${r.done}개의 요리 종류를 정했어요.`);
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      toast.error(e);
    },
  });

  return (
    <div className="card">
      <h2>요리 종류 정하기</h2>
      {left === 0 && !run.isPending ? (
        <p className="help">모든 레시피에 요리 종류가 정해져 있어요.</p>
      ) : (
        <>
          <p className="help" style={{ marginBottom: 12 }}>
            요리 종류(한식·중식·양식·일식·브런치·디저트)가 아직 없는 레시피가 {left}개 있어요. AI가 제목과 재료를 보고 한꺼번에 정해요. 40개마다
            AI를 한 번 부르고, 사용자 한도는 쓰지 않아요.
          </p>
          <button type="button" className="btn btn-primary" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? (progress ? `정하는 중… ${progress.done}개 끝, ${progress.left}개 남음` : "정하는 중…") : `${left}개 정하기`}
          </button>
        </>
      )}
    </div>
  );
}

function Usage({ data }: { data: AdminOverview }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [policy, setPolicy] = useState<Policy>(data.policy);
  useEffect(() => setPolicy(data.policy), [data.policy]);
  const save = useMutation({
    mutationFn: () => api.admin.savePolicy(policy),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      toast.show("한도를 저장했어요.");
    },
    onError: (e) => toast.error(e),
  });

  const g = data.global;
  const memberBudget = Math.floor(policy.global.aiDaily * policy.global.memberShare);
  const providerRows = Object.entries(g)
    .filter(([k]) => k.startsWith("ai:"))
    .sort((a, b) => b[1] - a[1]);
  const p = data.providers;
  const setNum = (path: [keyof Policy, string], v: string) =>
    setPolicy((x) => ({ ...x, [path[0]]: { ...x[path[0]], [path[1]]: v === "" ? 0 : Number(v) } }) as Policy);

  return (
    <>
      <div className="card">
        <h2>오늘</h2>
        <div className="stat-grid">
          <div className="stat">
            <div className="value num">{g.ai_all ?? 0}</div>
            <div className="label">AI 호출 (전체)</div>
          </div>
          <div className="stat">
            <div className="value num">
              {g.ai_member ?? 0}
              <span style={{ fontSize: 16, color: "var(--ink-3)" }}> / {memberBudget}</span>
            </div>
            <div className="label">일반 계정 몫</div>
          </div>
          <div className="stat">
            <div className="value num">{g.video_min ?? 0}분</div>
            <div className="label">영상 분석 (하루 무료 480분)</div>
          </div>
          <div className="stat">
            <div className="value num">{g.video_min_member ?? 0}분</div>
            <div className="label">그중 일반 계정</div>
          </div>
        </div>
        {providerRows.length > 0 && (
          <ul className="status-list" style={{ marginTop: 14 }}>
            {providerRows.map(([k, v]) => (
              <li key={k}>
                <span>{k.slice(3)}</span>
                <span className="num">{v}회</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>연결 상태</h2>
        <ul className="status-list">
          {(
            [
              [
                p.mail === "mock" ? "이메일 인증 (시험 모드: 메일 안 보냄)" : p.mail === "gmail" ? "이메일 인증 메일 (Gmail)" : "이메일 인증 메일 (Resend)",
                p.mail !== "off",
              ],
              ["Gemini (주 AI, 영상 분석)", p.gemini],
              ["Groq (예비 AI)", p.groq],
              ["Workers AI (예비 AI)", p.workersAi],
              ["OpenRouter (예비 AI)", p.openrouter],
              ["YouTube Data API (설명란)", p.youtubeApi],
              ["폰서버 인스타 도우미", p.instaHelper],
              ["가입 봇 차단 (Turnstile)", p.turnstile],
            ] as [string, boolean][]
          ).map(([label, on]) => (
            <li key={label}>
              <span>
                <span className={`dot ${on ? "on" : ""}`} />
                {label}
              </span>
              <span className="help">{on ? "연결됨" : "없음"}</span>
            </li>
          ))}
        </ul>
        {p.mock && (
          <p className="notice is-warn" style={{ marginTop: 12 }}>
            AI_MOCK이 켜져 있어 AI 대신 예시 응답을 돌려줘요. 실제 운영 전에 꺼 주세요.
          </p>
        )}
      </div>

      <Categorize left={data.uncategorized} />

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <h2>일반 계정 한도</h2>
        <p className="card-sub">지인·관리자에게는 적용되지 않아요.</p>
        <div className="policy-grid">
          {LIMIT_FIELDS.map((f) => (
            <label className="field" key={f.key}>
              <span className="label">{f.label}</span>
              <input className="input num" inputMode="numeric" value={policy.member[f.key]} onChange={(e) => setNum(["member", f.key], e.target.value.replace(/[^\d]/g, ""))} />
            </label>
          ))}
        </div>
        <h2 style={{ fontSize: 17, margin: "8px 0 12px" }}>제한된 계정 한도</h2>
        <div className="policy-grid">
          {LIMIT_FIELDS.map((f) => (
            <label className="field" key={f.key}>
              <span className="label">{f.label}</span>
              <input className="input num" inputMode="numeric" value={policy.limited[f.key]} onChange={(e) => setNum(["limited", f.key], e.target.value.replace(/[^\d]/g, ""))} />
            </label>
          ))}
        </div>
        <h2 style={{ fontSize: 17, margin: "8px 0 12px" }}>전체 예산과 자동 제한</h2>
        <div className="policy-grid">
          <label className="field">
            <span className="label">하루 AI 예산(회)</span>
            <input className="input num" inputMode="numeric" value={policy.global.aiDaily} onChange={(e) => setNum(["global", "aiDaily"], e.target.value.replace(/[^\d]/g, ""))} />
          </label>
          <label className="field">
            <span className="label">일반 계정 몫(%)</span>
            <input
              className="input num"
              inputMode="numeric"
              value={Math.round(policy.global.memberShare * 100)}
              onChange={(e) => setPolicy((x) => ({ ...x, global: { ...x.global, memberShare: Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0) / 100 } }))}
            />
          </label>
          <label className="field">
            <span className="label">하루 영상 예산(분)</span>
            <input className="input num" inputMode="numeric" value={policy.global.videoMinutes} onChange={(e) => setNum(["global", "videoMinutes"], e.target.value.replace(/[^\d]/g, ""))} />
          </label>
          <label className="field">
            <span className="label">영상 일반 몫(%)</span>
            <input
              className="input num"
              inputMode="numeric"
              value={Math.round(policy.global.memberVideoShare * 100)}
              onChange={(e) => setPolicy((x) => ({ ...x, global: { ...x.global, memberVideoShare: Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0) / 100 } }))}
            />
          </label>
          <label className="field">
            <span className="label">거절 n회면 자동 제한</span>
            <input className="input num" inputMode="numeric" value={policy.abuse.limitAfterDenials} onChange={(e) => setNum(["abuse", "limitAfterDenials"], e.target.value.replace(/[^\d]/g, ""))} />
          </label>
          <label className="field">
            <span className="label">거절 n회면 자동 차단</span>
            <input className="input num" inputMode="numeric" value={policy.abuse.blockAfterDenials} onChange={(e) => setNum(["abuse", "blockAfterDenials"], e.target.value.replace(/[^\d]/g, ""))} />
          </label>
        </div>
        <p className="help" style={{ marginBottom: 14 }}>
          하루 AI 예산은 AI Studio의 무료 한도(RPD)를 보고 조금 낮게 잡으세요. 일반 계정이 이 예산의 몫을 다 쓰면 지인 몫만 남아요.
        </p>
        <button type="submit" className="btn btn-primary btn-block" disabled={save.isPending}>
          한도 저장
        </button>
      </form>
    </>
  );
}

function Events({ data }: { data: AdminOverview }) {
  if (!data.events.length) return <p className="help">아직 기록이 없어요.</p>;
  return (
    <div>
      {data.events.map((e) => (
        <div className="event-row" key={e.id}>
          <div>
            <b>{e.userName ?? "알 수 없음"}</b> {e.detail}
          </div>
          <div className="when">{relativeTime(e.createdAt)}</div>
        </div>
      ))}
    </div>
  );
}
