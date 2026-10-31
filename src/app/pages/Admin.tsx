import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, Search, Share2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AdminOverview, AdminUserRow, Limits, Policy, Role, UserStatus } from "../../shared/api";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { useDocumentTitle, useUser } from "../lib/hooks";
import { relativeTime } from "../lib/text";
import { useToast } from "../lib/toast";

type Tab = "users" | "invites" | "usage" | "events";

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
            ["invites", "초대 코드"],
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
      ) : tab === "invites" ? (
        <Invites data={overview.data} />
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
    mutationFn: (body: { role?: Role; status?: UserStatus; reason?: string }) => api.admin.updateUser(user!.id, body),
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

function Invites({ data }: { data: AdminOverview }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [days, setDays] = useState("14");
  const [created, setCreated] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.admin.createInvite({ note: note.trim(), maxUses: Number(maxUses) || 1, expiresDays: Number(days) || null }),
    onSuccess: (r) => {
      setCreated(r.code);
      setNote("");
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({
    mutationFn: (code: string) => api.admin.deleteInvite(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
    onError: (e) => toast.error(e),
  });

  const linkOf = (code: string) => `${location.origin}/signup?invite=${code}`;

  async function shareInvite(code: string) {
    const text = `레시피GT 초대 코드: ${code}\n가입하기: ${linkOf(code)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "레시피GT 초대", text });
        return;
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
    await navigator.clipboard?.writeText(text);
    toast.show("초대 링크를 복사했어요.");
  }

  return (
    <>
      <div className="card">
        <h2>지인 초대하기</h2>
        <p className="card-sub">이 코드로 가입하거나 내 정보에서 코드를 넣으면 지인 계정(제한 없음)이 돼요.</p>
        <label className="field">
          <span className="label">메모</span>
          <input className="input" value={note} maxLength={40} placeholder="예: 엄마, 회사 동기들" onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="policy-grid">
          <label className="field">
            <span className="label">쓸 수 있는 사람 수</span>
            <input className="input num" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="field">
            <span className="label">유효 기간(일, 0은 무기한)</span>
            <input className="input num" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
          </label>
        </div>
        <button type="button" className="btn btn-primary btn-block" disabled={create.isPending} onClick={() => create.mutate()}>
          <Plus aria-hidden="true" />
          초대 코드 만들기
        </button>
        {created && (
          <div style={{ marginTop: 16 }}>
            <div className="code-box">
              {created}
              <button type="button" className="icon-btn" aria-label="초대 링크 보내기" onClick={() => shareInvite(created)}>
                <Share2 />
              </button>
            </div>
            <p className="help" style={{ marginTop: 6 }}>
              링크: {linkOf(created)}
            </p>
          </div>
        )}
      </div>

      <h2 style={{ fontSize: 19, margin: "8px 0 8px" }}>만든 코드</h2>
      {data.invites.length === 0 ? (
        <p className="help">아직 만든 초대 코드가 없어요.</p>
      ) : (
        data.invites.map((i) => {
          const expired = i.expiresAt != null && i.expiresAt < Date.now();
          const used = i.uses >= i.maxUses;
          return (
            <div className="user-row" key={i.code}>
              <span className="grow">
                <span className="name">
                  <span className="num" style={{ letterSpacing: "0.06em" }}>
                    {i.code}
                  </span>
                  {(expired || used) && <span className="badge">{used ? "다 씀" : "만료"}</span>}
                </span>
                <span className="sub" style={{ display: "block" }}>
                  {i.note || "메모 없음"} · {i.uses}/{i.maxUses}명 · {i.expiresAt ? (expired ? "만료됨" : `${relativeTime(i.createdAt)} 만듦`) : "무기한"}
                </span>
              </span>
              {!expired && !used && (
                <button type="button" className="icon-btn" aria-label={`${i.code} 보내기`} onClick={() => shareInvite(i.code)}>
                  <Share2 />
                </button>
              )}
              <button type="button" className="icon-btn" aria-label={`${i.code} 지우기`} onClick={() => remove.mutate(i.code)}>
                <Trash2 />
              </button>
            </div>
          );
        })
      )}
    </>
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
