import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, ChefHat, Minus, Plus, Settings2, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { FRIDGE_KINDS, formatStock, parseQuickAdd, stepFor, type Fridge as FridgeT, type FridgeItem, type FridgeKind, type FridgeState } from "../../shared/fridge";
import { COMMON_INGREDIENTS, ingredientMatches, isStaple } from "../../shared/ingredients";
import { amountText, displayNote, type RecipeContent } from "../../shared/recipe";
import { RecipeImage } from "../components/RecipeImage";
import { TermText } from "../components/TermText";
import { YouTubeIcon } from "../components/Icons";
import { youtubeSearchUrl } from "../../shared/glossary";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { pantryNames, useFridge, useSetFridge } from "../lib/fridge";
import { useDocumentTitle, useRecipes, useUser } from "../lib/hooks";
import { josa, relativeTime } from "../lib/text";
import { useToast } from "../lib/toast";

type Match = Awaited<ReturnType<typeof api.matchPantry>>[number];

function MatchRow({ m }: { m: Match }) {
  return (
    <Link to={`/r/${m.recipe.id}`} className="match">
      <div className="thumb">
        <RecipeImage src={m.recipe.image} title={m.recipe.title} />
      </div>
      <div className="match-info">
        <h3>{m.recipe.title}</h3>
        <p className="match-line">
          <b>있음</b> {m.have.join(", ")}
        </p>
        {m.missing.length > 0 && (
          <p className="match-line need">
            <b>필요</b> {m.missing.join(", ")}
          </p>
        )}
      </div>
      <span className="ratio num" aria-label={`재료 ${Math.round(m.ratio * 100)}% 있음`}>
        {Math.round(m.ratio * 100)}%
      </span>
    </Link>
  );
}

/** AI 추천 레시피에서 냉장고에 없는 재료 */
function neededFor(recipe: RecipeContent, pantry: string[], staples: boolean): string[] {
  return recipe.ingredients.filter((i) => !pantry.some((p) => ingredientMatches(p, i.name)) && !(staples && isStaple(i.name))).map((i) => i.name);
}

const QUICK_UNITS = ["개", "g", "ml", "봉", "팩", "모", "단", "캔", "kg", "L"];

/* ───────── 재료 한 줄 ───────── */

function ItemRow({ item, onOpen, onStep }: { item: FridgeItem; onOpen: () => void; onStep: (qty: number) => void }) {
  const stock = formatStock(item);
  // 세는 단위(개, 봉…)는 줄에서 바로 −/+ 한다
  const countable = item.qty != null && !/^(g|kg|ml|mL|L|l|cc|근|컵|큰술|작은술)$/.test(item.unit);
  const step = item.qty != null ? stepFor(item.unit, item.qty) : 1;
  return (
    <li className="stock-row">
      <button type="button" className="stock-main" onClick={onOpen}>
        <span className="stock-name">{item.name}</span>
        <span className="stock-when">{relativeTime(item.addedAt)} 넣음</span>
      </button>
      {countable ? (
        <span className="amount-stepper is-compact" role="group" aria-label={`${item.name} 양`}>
          <button type="button" aria-label={`${item.name} 줄이기`} onClick={() => onStep(Math.round((item.qty! - step) * 1000) / 1000)}>
            <Minus />
          </button>
          <output className="num">{stock}</output>
          <button type="button" aria-label={`${item.name} 늘리기`} onClick={() => onStep(Math.round((item.qty! + step) * 1000) / 1000)}>
            <Plus />
          </button>
        </span>
      ) : (
        <button type="button" className={stock ? "stock-amount" : "stock-amount is-unknown"} onClick={onOpen}>
          {stock || "양 모름"}
        </button>
      )}
    </li>
  );
}

/* ───────── 재료 고치기 ───────── */

function ItemSheet({ item, state, onClose }: { item: FridgeItem | null; state: FridgeState; onClose: () => void }) {
  const setFridge = useSetFridge();
  const toast = useToast();
  // 재료마다 새로 그려서(key) 열 때의 값으로 채운다
  const [draft, setDraft] = useState(() => (item ? { name: item.name, qty: item.qty != null ? String(item.qty) : "", unit: item.unit, fridgeId: item.fridgeId } : null));
  const current = draft;
  const close = onClose;

  const save = useMutation({
    mutationFn: () => {
      const qty = Number(current!.qty);
      return api.updateItem(item!.id, {
        name: current!.name,
        qty: current!.qty.trim() && qty > 0 ? qty : null,
        unit: current!.unit,
        fridgeId: current!.fridgeId,
      });
    },
    onSuccess: (s) => {
      setFridge(s);
      close();
    },
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteItem(item!.id),
    onSuccess: ({ removed, state: s }) => {
      setFridge(s);
      close();
      toast.show(`${removed.name} 뺐어요.`, {
        action: { label: "되돌리기", onClick: () => api.restoreItems([removed]).then(setFridge).catch((e) => toast.error(e)) },
      });
    },
    onError: (e) => toast.error(e),
  });

  const qtyNum = Number(current?.qty);
  const step = stepFor(current?.unit ?? "", qtyNum > 0 ? qtyNum : null);
  const bump = (dir: 1 | -1) =>
    setDraft((d) => (d ? { ...d, qty: String(Math.max(0, Math.round(((Number(d.qty) || 0) + dir * step) * 1000) / 1000) || "") } : d));

  return (
    <Sheet
      open={item != null}
      onClose={close}
      title="재료 고치기"
      footer={
        <div className="btn-row">
          <button type="button" className="btn btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            <Trash2 aria-hidden="true" />
            다 썼어요
          </button>
          <button type="button" className="btn btn-primary" disabled={save.isPending || !current?.name.trim()} onClick={() => save.mutate()}>
            저장
          </button>
        </div>
      }
    >
      {current && (
        <>
          <label className="field">
            <span className="label">이름</span>
            <input className="input" value={current.name} maxLength={30} onChange={(e) => setDraft({ ...current, name: e.target.value })} />
          </label>
          <div className="field">
            <span className="label">남은 양</span>
            <div className="qty-edit">
              <button type="button" className="icon-btn" aria-label="줄이기" onClick={() => bump(-1)}>
                <Minus />
              </button>
              <input
                className="input num"
                inputMode="decimal"
                placeholder="양 모름"
                aria-label="양"
                value={current.qty}
                onChange={(e) => setDraft({ ...current, qty: e.target.value.replace(/[^\d.]/g, "") })}
              />
              <input className="input qty-unit" placeholder="단위" aria-label="단위" maxLength={8} value={current.unit} onChange={(e) => setDraft({ ...current, unit: e.target.value })} />
              <button type="button" className="icon-btn" aria-label="늘리기" onClick={() => bump(1)}>
                <Plus />
              </button>
            </div>
            <div className="chips unit-chips">
              {QUICK_UNITS.map((u) => (
                <button key={u} type="button" className="chip" aria-pressed={current.unit === u} onClick={() => setDraft({ ...current, unit: u })}>
                  {u}
                </button>
              ))}
            </div>
            <span className="help">비워 두면 양 모름으로 둬요. 요리할 때 다 썼는지만 물어볼게요.</span>
          </div>
          {state.fridges.length > 1 && (
            <div className="field">
              <span className="label">넣어 둔 곳</span>
              <div className="chips">
                {state.fridges.map((f) => (
                  <button key={f.id} type="button" className="chip" aria-pressed={current.fridgeId === f.id} onClick={() => setDraft({ ...current, fridgeId: f.id })}>
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

/* ───────── 냉장고 관리 ───────── */

function FridgesSheet({ open, onClose, state }: { open: boolean; onClose: () => void; state: FridgeState }) {
  const setFridge = useSetFridge();
  const toast = useToast();
  const [custom, setCustom] = useState("");
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of state.items) m.set(i.fridgeId, (m.get(i.fridgeId) ?? 0) + 1);
    return m;
  }, [state.items]);

  const add = useMutation({
    mutationFn: (v: { name: string; kind: FridgeKind }) => api.addFridge(v.name, v.kind),
    onSuccess: ({ state: s }) => {
      setFridge(s);
      setCustom("");
    },
    onError: (e) => toast.error(e),
  });
  const rename = useMutation({
    mutationFn: (v: { id: string; name?: string; kind?: FridgeKind }) => api.updateFridge(v.id, { name: v.name, kind: v.kind }),
    onSuccess: setFridge,
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteFridge(id),
    onSuccess: setFridge,
    onError: (e) => toast.error(e),
  });

  const presets = FRIDGE_KINDS.filter((k) => k.kind !== "other" && !state.fridges.some((f) => f.name === k.label));

  return (
    <Sheet open={open} onClose={onClose} title="냉장고 관리">
      <p className="sheet-lead">냉장고, 냉동실, 김치냉장고처럼 나눠 두면 어디에 뭐가 있는지 한눈에 보여요. 레시피는 모든 냉장고 재료를 합쳐서 찾아요.</p>
      <ul className="fridge-edit-list">
        {state.fridges.map((f) => (
          <li key={f.id}>
            <input
              className="input"
              defaultValue={f.name}
              maxLength={20}
              aria-label="냉장고 이름"
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== f.name && rename.mutate({ id: f.id, name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <span className="help num">{counts.get(f.id) ?? 0}가지</span>
            <button
              type="button"
              className="icon-btn"
              aria-label={`${f.name} 지우기`}
              disabled={state.fridges.length <= 1 || remove.isPending}
              onClick={() => {
                const n = counts.get(f.id) ?? 0;
                if (n === 0 || window.confirm(`${f.name}${josa(f.name, "과")} 안에 든 재료 ${n}가지를 지울까요?`)) remove.mutate(f.id);
              }}
            >
              <Trash2 />
            </button>
          </li>
        ))}
      </ul>
      <p className="label sheet-label">냉장고 더하기</p>
      {presets.length > 0 && (
        <div className="chips" style={{ marginBottom: 12 }}>
          {presets.map((p) => (
            <button key={p.kind} type="button" className="chip" disabled={add.isPending} onClick={() => add.mutate({ name: p.label, kind: p.kind })}>
              <Plus aria-hidden="true" />
              {p.label}
            </button>
          ))}
        </div>
      )}
      <form
        className="inline-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (custom.trim()) add.mutate({ name: custom, kind: "other" });
        }}
      >
        <input className="input" value={custom} maxLength={20} placeholder="직접 이름 짓기 (예: 본가 냉장고)" onChange={(e) => setCustom(e.target.value)} />
        <button type="submit" className="btn" disabled={!custom.trim() || add.isPending}>
          더하기
        </button>
      </form>
    </Sheet>
  );
}

/* ───────── 화면 ───────── */

export function Fridge() {
  useDocumentTitle("냉장고");
  const fridge = useFridge();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "find" ? "find" : "items";
  const setTab = (t: "items" | "find") => setParams(t === "find" ? { tab: "find" } : {}, { replace: true });

  return (
    <div className="page">
      <div className="page-head">
        <h1>냉장고</h1>
      </div>
      <div className="tabs" role="tablist" aria-label="냉장고 보기">
        <button type="button" role="tab" aria-selected={tab === "items"} onClick={() => setTab("items")}>
          재료{fridge.data ? ` ${fridge.data.items.length}` : ""}
        </button>
        <button type="button" role="tab" aria-selected={tab === "find"} onClick={() => setTab("find")}>
          요리 찾기
        </button>
      </div>
      {fridge.isPending ? (
        <div className="skeleton" style={{ height: 220 }} />
      ) : fridge.isError || !fridge.data ? (
        <p className="help">냉장고를 불러오지 못했어요. 다시 열어 주세요.</p>
      ) : tab === "items" ? (
        <Stock state={fridge.data} onFind={() => setTab("find")} />
      ) : (
        <Find state={fridge.data} />
      )}
    </div>
  );
}

function Stock({ state, onFind }: { state: FridgeState; onFind: () => void }) {
  const setFridge = useSetFridge();
  const toast = useToast();
  const [filter, setFilter] = useState<string>("all");
  const [target, setTarget] = useState<string>(state.fridges[0].id);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<FridgeItem | null>(null);
  const [manage, setManage] = useState(false);
  const into = state.fridges.some((f) => f.id === target) ? target : state.fridges[0].id;

  const add = useMutation({
    mutationFn: (drafts: ReturnType<typeof parseQuickAdd>) => api.addItems(into, drafts),
    onSuccess: (s) => {
      setFridge(s);
      setText("");
    },
    onError: (e) => toast.error(e),
  });
  const step = useMutation({
    mutationFn: async (v: { item: FridgeItem; qty: number }): Promise<{ state: FridgeState; removed: FridgeItem | null }> =>
      v.qty <= 0 ? api.deleteItem(v.item.id).then((r) => ({ state: r.state, removed: r.removed })) : api.updateItem(v.item.id, { qty: v.qty }).then((s) => ({ state: s, removed: null })),
    onSuccess: ({ state: s, removed }) => {
      setFridge(s);
      if (removed) {
        toast.show(`${removed.name} 다 써서 뺐어요.`, {
          action: { label: "되돌리기", onClick: () => api.restoreItems([removed]).then(setFridge).catch((e) => toast.error(e)) },
        });
      }
    },
    onError: (e) => toast.error(e),
  });

  // '바로 만들 수 있는 요리' 개수를 미리 알려 준다
  const names = pantryNames(state);
  const matches = useQuery({
    queryKey: ["match", names.join("|"), state.staples],
    queryFn: () => api.matchPantry(names, state.staples),
    enabled: names.length > 0,
    staleTime: 30_000,
  });
  const ready = matches.data?.filter((m) => m.missing.length === 0).length ?? 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const drafts = parseQuickAdd(text);
    if (drafts.length) add.mutate(drafts);
  };
  const quick = COMMON_INGREDIENTS.slice(0, 18);
  const shown = state.fridges.filter((f) => filter === "all" || f.id === filter);
  const multi = state.fridges.length > 1;

  return (
    <>
      <form className="quick-add" onSubmit={submit}>
        <div className="quick-add-row">
          <input
            className="input"
            value={text}
            maxLength={400}
            placeholder="예: 달걀 10개, 우유 1L, 대파"
            aria-label="넣을 재료"
            enterKeyHint="done"
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={!text.trim() || add.isPending}>
            넣기
          </button>
        </div>
        <p className="help">쉼표로 여러 개를 한 번에 넣을 수 있어요. 양은 몰라도 괜찮아요.</p>
        {multi && (
          <div className="chips into-chips" role="radiogroup" aria-label="넣을 곳">
            <span className="help">넣을 곳</span>
            {state.fridges.map((f) => (
              <button key={f.id} type="button" className="chip" role="radio" aria-checked={into === f.id} aria-pressed={into === f.id} onClick={() => setTarget(f.id)}>
                {f.name}
              </button>
            ))}
          </div>
        )}
      </form>

      {state.items.length === 0 ? (
        <div className="fridge-empty">
          <h2>냉장고가 비어 있어요</h2>
          <p>자주 쓰는 재료를 눌러서 바로 넣어 보세요. 양은 나중에 적어도 돼요.</p>
          <div className="chips">
            {quick.map((name) => (
              <button key={name} type="button" className="chip" disabled={add.isPending} onClick={() => add.mutate([{ name, qty: null, unit: "" }])}>
                <Plus aria-hidden="true" />
                {name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {ready > 0 && (
            <button type="button" className="ready-card" onClick={onFind}>
              <ChefHat aria-hidden="true" />
              <span>
                지금 바로 만들 수 있는 요리 <b className="num">{ready}개</b>
              </span>
              <span className="ready-go">요리 찾기</span>
            </button>
          )}
          <div className="stock-head">
            {multi ? (
              <div className="chips is-scroll" role="tablist" aria-label="냉장고 고르기">
                <button type="button" className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                  전체 {state.items.length}
                </button>
                {state.fridges.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="chip"
                    aria-pressed={filter === f.id}
                    onClick={() => {
                      setFilter(f.id);
                      // 한 냉장고를 보고 있으면 거기에 넣는 게 자연스럽다
                      setTarget(f.id);
                    }}
                  >
                    {f.name} {state.items.filter((i) => i.fridgeId === f.id).length}
                  </button>
                ))}
              </div>
            ) : (
              <span />
            )}
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setManage(true)}>
              <Settings2 aria-hidden="true" />
              냉장고 관리
            </button>
          </div>
          {shown.map((f: FridgeT) => {
            const items = state.items.filter((i) => i.fridgeId === f.id);
            if (!items.length && filter === "all" && multi) return null;
            return (
              <section key={f.id} className="stock-group" aria-label={f.name}>
                {multi && filter === "all" && (
                  <h2 className="stock-group-title">
                    {f.name} <span className="num">{items.length}</span>
                  </h2>
                )}
                {items.length ? (
                  <ul className="stock-list">
                    {items.map((item) => (
                      <ItemRow key={item.id} item={item} onOpen={() => setEditing(item)} onStep={(qty) => step.mutate({ item, qty })} />
                    ))}
                  </ul>
                ) : (
                  <p className="help">{f.name}에 넣은 재료가 없어요.</p>
                )}
              </section>
            );
          })}
        </>
      )}
      {state.items.length === 0 && (
        <div style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setManage(true)}>
            <Settings2 aria-hidden="true" />
            냉장고 관리
          </button>
        </div>
      )}

      <ItemSheet key={editing?.id ?? "none"} item={editing} state={state} onClose={() => setEditing(null)} />
      <FridgesSheet open={manage} onClose={() => setManage(false)} state={state} />
    </>
  );
}

/* ───────── 요리 찾기 ───────── */

function Find({ state }: { state: FridgeState }) {
  const me = useUser();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const setFridge = useSetFridge();
  const [off, setOff] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<RecipeContent | null>(null);
  const included = useMemo(() => new Set(state.fridges.filter((f) => !off.has(f.id)).map((f) => f.id)), [state.fridges, off]);
  const list = pantryNames(state, included);
  const staples = state.staples;

  const matches = useQuery({
    queryKey: ["match", list.join("|"), staples],
    queryFn: () => api.matchPantry(list, staples),
    enabled: list.length > 0,
    placeholderData: (prev) => prev,
  });
  const { data: recipes } = useRecipes();

  const settings = useMutation({
    mutationFn: (v: boolean) => api.fridgeSettings(v),
    onSuccess: setFridge,
    onError: (e) => toast.error(e),
  });
  const ai = useMutation({
    mutationFn: () => api.recommend(list, note.trim(), staples),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
    onError: (e) => toast.error(e),
  });
  const save = useMutation({
    mutationFn: (content: RecipeContent) => api.createRecipe({ content, sourceType: "ai" }),
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ["recipes"] });
      toast.show("내 레시피에 저장했어요.", { action: { label: "열기", onClick: () => navigate(`/r/${id}`) } });
      setPreview(null);
    },
    onError: (e) => toast.error(e),
  });

  const ready = matches.data?.filter((m) => m.missing.length === 0) ?? [];
  const almost = matches.data?.filter((m) => m.missing.length > 0 && m.missing.length <= 2) ?? [];
  const more = matches.data?.filter((m) => m.missing.length > 2) ?? [];
  const aiLeft = me.limits ? Math.max(0, me.limits.ai - me.usage.ai) : null;

  return (
    <>
      <div className="find-box">
        {state.fridges.length > 1 && (
          <div className="chips" aria-label="찾을 때 쓸 냉장고">
            {state.fridges.map((f) => (
              <button
                key={f.id}
                type="button"
                className="chip"
                aria-pressed={!off.has(f.id)}
                onClick={() =>
                  setOff((s) => {
                    const n = new Set(s);
                    if (n.has(f.id)) n.delete(f.id);
                    else n.add(f.id);
                    return n;
                  })
                }
              >
                {f.name}
              </button>
            ))}
          </div>
        )}
        <label className="switch">
          <input type="checkbox" checked={staples} disabled={settings.isPending} onChange={(e) => settings.mutate(e.target.checked)} />
          소금, 간장 같은 기본 양념은 있다고 보기
        </label>
        <p className="help">{list.length ? `재료 ${list.length}가지로 찾고 있어요.` : "고른 냉장고에 재료가 없어요."}</p>
      </div>

      {list.length === 0 ? (
        <div className="fridge-empty">
          <h2>재료를 먼저 넣어 주세요</h2>
          <p>냉장고에 있는 재료로 내 레시피에서 만들 수 있는 요리를 찾아 드려요.</p>
          <Link to="/fridge" className="btn btn-primary">
            재료 넣으러 가기
          </Link>
        </div>
      ) : (
        <>
          <section className="section" aria-labelledby="mine-title">
            <div className="section-head">
              <h2 id="mine-title">내 레시피에서</h2>
              {matches.data && <span className="section-hint">{matches.data.length}개</span>}
            </div>
            {matches.isPending ? (
              <div className="skeleton" style={{ height: 100 }} />
            ) : !recipes?.length && !matches.data?.length ? (
              <p className="help">아직 저장한 레시피가 없어요. 아래에서 AI 추천을 받아 보세요.</p>
            ) : matches.data && matches.data.length === 0 ? (
              <p className="help">이 재료를 쓰는 레시피가 없어요. 아래에서 새 요리를 추천받아 보세요.</p>
            ) : (
              <>
                {ready.length > 0 && (
                  <>
                    <p className="group-title">지금 바로 만들 수 있어요</p>
                    <div className="match-list">
                      {ready.map((m) => (
                        <MatchRow key={m.recipe.id} m={m} />
                      ))}
                    </div>
                  </>
                )}
                {almost.length > 0 && (
                  <>
                    <p className="group-title">재료가 조금 모자라요</p>
                    <div className="match-list">
                      {almost.map((m) => (
                        <MatchRow key={m.recipe.id} m={m} />
                      ))}
                    </div>
                  </>
                )}
                {more.length > 0 && (
                  <details style={{ marginTop: 12 }} open={ready.length + almost.length === 0}>
                    <summary className="group-title" style={{ cursor: "pointer" }}>
                      재료가 더 필요해요 ({more.length})
                    </summary>
                    <div className="match-list">
                      {more.map((m) => (
                        <MatchRow key={m.recipe.id} m={m} />
                      ))}
                    </div>
                  </details>
                )}
              </>
            )}
          </section>

          <section className="section" aria-labelledby="ai-title">
            <div className="section-head">
              <h2 id="ai-title">새 요리 추천</h2>
              {aiLeft !== null && <span className="section-hint">오늘 AI {aiLeft}번 남음</span>}
            </div>
            <label className="field">
              <span className="sr-only">원하는 것</span>
              <input className="input" value={note} maxLength={100} placeholder="원하는 것 (선택, 예: 15분 안에, 아이 반찬)" onChange={(e) => setNote(e.target.value)} />
            </label>
            <button type="button" className="btn btn-primary btn-block" disabled={ai.isPending || aiLeft === 0} onClick={() => ai.mutate()}>
              <Sparkles aria-hidden="true" />
              {ai.isPending ? "요리를 고르고 있어요…" : ai.data ? "다른 요리 추천받기" : "이 재료로 추천받기"}
            </button>
            {ai.data && (
              <div className="idea-list">
                {ai.data.map((r, i) => {
                  const need = neededFor(r, list, staples);
                  return (
                    <button type="button" className="idea" key={`${r.title}-${i}`} onClick={() => setPreview(r)}>
                      <h3>{r.title}</h3>
                      <p>{r.description}</p>
                      <p className="need">{need.length ? `더 필요: ${need.join(", ")}` : "지금 있는 재료로 만들 수 있어요"}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      <Sheet
        open={preview != null}
        onClose={() => setPreview(null)}
        title={preview?.title ?? ""}
        footer={
          <button type="button" className="btn btn-primary btn-block" disabled={save.isPending} onClick={() => preview && save.mutate(preview)}>
            <BookmarkPlus aria-hidden="true" />
            {save.isPending ? "저장하는 중…" : "내 레시피에 저장"}
          </button>
        }
      >
        {preview && (
          <>
            {preview.description && (
              <p className="recipe-desc" style={{ marginTop: 0 }}>
                {preview.description}
              </p>
            )}
            <div className="section" style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 18, marginBottom: 8 }}>재료</h3>
              <ul className="ing-list">
                {preview.ingredients.map((ing, i) => (
                  <li className="ing" key={i}>
                    <button type="button" tabIndex={-1} style={{ cursor: "default", minHeight: 44 }}>
                      <span className="ing-name">
                        {ing.name}
                        {displayNote(ing.note) && <span className="ing-note">{displayNote(ing.note)}</span>}
                      </span>
                      <span className="ing-amount">{amountText(ing)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="section" style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 18, marginBottom: 10 }}>만드는 법</h3>
              <ol className="steps">
                {preview.steps.map((s, i) => (
                  <li key={i}>
                    <span>
                      <TermText text={s} />
                    </span>
                  </li>
                ))}
              </ol>
              <a className="source-link" href={youtubeSearchUrl(`${preview.title} 만들기`)} target="_blank" rel="noreferrer noopener">
                <YouTubeIcon />
                만드는 영상 찾아보기
              </a>
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}
