import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, ChevronLeft, ChevronRight, Plus, ShoppingBasket, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import {
  addDays,
  DAY_RE,
  fromDay,
  slotForNow,
  slotLabel,
  toDay,
  WEEKDAYS,
  weekdayOf,
  weekStart,
  type MealEntry,
  type MealSlot,
  type NeedLine,
} from "../../shared/fridge";
import { parseAmount, type RecipeSummary } from "../../shared/recipe";
import { dateText, SlotChips } from "../components/AddToPlanSheet";
import { AmountStepper } from "../components/AmountStepper";
import { CookedSheet } from "../components/CookedSheet";
import { RecipeImage } from "../components/RecipeImage";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { pantryNames, useFridge, useSetFridge } from "../lib/fridge";
import { useDocumentTitle, useRecipe, useRecipes } from "../lib/hooks";
import { useToast } from "../lib/toast";

function monthFirst(day: string): string {
  return `${day.slice(0, 8)}01`;
}

function monthLast(day: string): string {
  const d = fromDay(monthFirst(day));
  return toDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function shiftMonth(day: string, n: number): string {
  const d = fromDay(monthFirst(day));
  return toDay(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

function usePlanChanged() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["plan"] });
    qc.invalidateQueries({ queryKey: ["plan-needs"] });
  };
}

export function Plan() {
  useDocumentTitle("식단");
  const [params, setParams] = useSearchParams();
  const today = toDay(new Date());
  const focus = DAY_RE.test(params.get("day") ?? "") ? params.get("day")! : today;
  const view = params.get("view") === "month" ? "month" : "week";
  // 주간 보기는 고른 날(기본 오늘)부터 7일. 식단은 앞날을 짜는 것이라 달력 주보다 이쪽이 편하다.
  const from = view === "week" ? focus : weekStart(monthFirst(focus));
  const to = view === "week" ? addDays(from, 6) : addDays(weekStart(monthLast(focus)), 6);
  const plan = useQuery({ queryKey: ["plan", from, to], queryFn: () => api.plan(from, to), placeholderData: (prev) => prev });
  const [adding, setAdding] = useState<string | null>(null);
  const [selected, setSelected] = useState<MealEntry | null>(null);
  const [cooking, setCooking] = useState<MealEntry | null>(null);
  const changed = usePlanChanged();
  const toast = useToast();

  const go = (next: { day?: string; view?: "week" | "month" }) => {
    const p: Record<string, string> = {};
    const v = next.view ?? view;
    const d = next.day ?? focus;
    if (v === "month") p.view = "month";
    if (d !== today) p.day = d;
    setParams(p, { replace: true });
  };

  const byDay = useMemo(() => {
    const m = new Map<string, MealEntry[]>();
    for (const e of plan.data ?? []) m.set(e.day, [...(m.get(e.day) ?? []), e]);
    return m;
  }, [plan.data]);

  const toggle = useMutation({
    mutationFn: (e: MealEntry) => api.updatePlan(e.id, { done: !e.done }),
    onSuccess: changed,
    onError: (e) => toast.error(e),
  });
  // 만들었어요: 레시피면 냉장고에서 뺄 재료를 먼저 보여 준다
  const markDone = (e: MealEntry) => {
    if (e.done || !e.recipeId) toggle.mutate(e);
    else setCooking(e);
  };

  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const fd = fromDay(from);
  const td = fromDay(addDays(from, 6));

  return (
    <div className="page is-wide">
      <div className="page-head">
        <h1>식단</h1>
        <div className="tabs is-compact" role="tablist" aria-label="보기">
          <button type="button" role="tab" aria-selected={view === "week"} onClick={() => go({ view: "week" })}>
            주간
          </button>
          <button type="button" role="tab" aria-selected={view === "month"} onClick={() => go({ view: "month" })}>
            월간
          </button>
        </div>
      </div>

      <div className="plan-nav">
        <button type="button" className="icon-btn" aria-label={view === "week" ? "지난주" : "지난달"} onClick={() => go({ day: view === "week" ? addDays(focus, -7) : shiftMonth(focus, -1) })}>
          <ChevronLeft />
        </button>
        <h2>
          {view === "week"
            ? fd.getMonth() === td.getMonth()
              ? `${fd.getMonth() + 1}월 ${fd.getDate()}일 – ${td.getDate()}일`
              : `${fd.getMonth() + 1}월 ${fd.getDate()}일 – ${td.getMonth() + 1}월 ${td.getDate()}일`
            : `${fromDay(focus).getFullYear()}년 ${fromDay(focus).getMonth() + 1}월`}
        </h2>
        <button type="button" className="icon-btn" aria-label={view === "week" ? "다음 주" : "다음 달"} onClick={() => go({ day: view === "week" ? addDays(focus, 7) : shiftMonth(focus, 1) })}>
          <ChevronRight />
        </button>
        {(view === "week" ? from !== today : monthFirst(focus) !== monthFirst(today)) && (
          <button type="button" className="btn btn-sm" onClick={() => go({ day: today })}>
            {view === "week" ? "오늘부터" : "이번 달"}
          </button>
        )}
      </div>

      {plan.isPending ? (
        <div className="skeleton" style={{ height: 320 }} />
      ) : view === "week" ? (
        <>
          <div className="week-list">
            {days.map((d) => (
              <DayCard
                key={d}
                day={d}
                today={today}
                entries={byDay.get(d) ?? []}
                onAdd={() => setAdding(d)}
                onOpen={setSelected}
                onDone={markDone}
              />
            ))}
          </div>
          <Needs from={from} to={addDays(from, 6)} />
        </>
      ) : (
        <MonthGrid from={from} to={to} month={focus.slice(0, 7)} today={today} byDay={byDay} onPick={(d) => go({ day: d, view: "week" })} />
      )}

      <PickerSheet day={adding} onClose={() => setAdding(null)} />
      <EntrySheet key={selected?.id ?? "none"} entry={selected} onClose={() => setSelected(null)} onDone={(e) => (setSelected(null), markDone(e))} />
      {cooking && <PlanCooked entry={cooking} onClose={() => setCooking(null)} />}
    </div>
  );
}

/* ───────── 하루 ───────── */

function DayCard(props: {
  day: string;
  today: string;
  entries: MealEntry[];
  onAdd: () => void;
  onOpen: (e: MealEntry) => void;
  onDone: (e: MealEntry) => void;
}) {
  const { day, today, entries } = props;
  const d = fromDay(day);
  return (
    <section className={`day-card${day === today ? " is-today" : ""}${day < today ? " is-past" : ""}`} aria-label={`${d.getMonth() + 1}월 ${d.getDate()}일`}>
      <header className="day-head">
        <span className="day-week">{weekdayOf(day)}</span>
        <span className="day-num num">{d.getDate()}</span>
        {day === today && <span className="badge is-today">오늘</span>}
      </header>
      {entries.length > 0 && (
        <ul className="meal-list">
          {entries.map((e) => (
            <li key={e.id} className={e.done ? "meal-row is-done" : "meal-row"}>
              <button type="button" className="meal-main" onClick={() => props.onOpen(e)}>
                <span className="meal-slot">{slotLabel(e.slot)}</span>
                {e.recipeId ? (
                  <span className="meal-thumb">
                    <RecipeImage src={e.image} title={e.title} />
                  </span>
                ) : null}
                <span className="meal-title">{e.title}</span>
                {e.servings && e.recipeId ? <span className="meal-servings num">{e.servings}인분</span> : null}
              </button>
              <button
                type="button"
                className="meal-check"
                aria-pressed={e.done}
                aria-label={e.done ? `${e.title} 안 만든 걸로` : `${e.title} 만들었어요`}
                onClick={() => props.onDone(e)}
              >
                <Check />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="day-add" onClick={props.onAdd}>
        <Plus aria-hidden="true" />
        {entries.length ? "더 넣기" : "메뉴 넣기"}
      </button>
    </section>
  );
}

/* ───────── 달력 ───────── */

function MonthGrid(props: { from: string; to: string; month: string; today: string; byDay: Map<string, MealEntry[]>; onPick: (day: string) => void }) {
  const days: string[] = [];
  for (let d = props.from; d <= props.to; d = addDays(d, 1)) days.push(d);
  return (
    <div className="month">
      <div className="month-head" aria-hidden="true">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="month-grid">
        {days.map((d) => {
          const entries = props.byDay.get(d) ?? [];
          const out = !d.startsWith(props.month);
          return (
            <button
              key={d}
              type="button"
              className={`month-cell${out ? " is-out" : ""}${d === props.today ? " is-today" : ""}`}
              aria-label={`${dateText(d)} 메뉴 ${entries.length}개`}
              onClick={() => props.onPick(d)}
            >
              <span className="month-num num">{fromDay(d).getDate()}</span>
              {entries.slice(0, 2).map((e) => (
                <span key={e.id} className={e.done ? "month-meal is-done" : "month-meal"}>
                  {e.title}
                </span>
              ))}
              {entries.length > 2 && <span className="month-more num">+{entries.length - 2}</span>}
            </button>
          );
        })}
      </div>
      <p className="help" style={{ marginTop: 12 }}>
        날짜를 누르면 그날부터 7일 식단으로 가요.
      </p>
    </div>
  );
}

/* ───────── 메뉴 고르기 ───────── */

const QUICK_TITLES = ["외식", "배달", "남은 음식", "간단히"];

function PickerSheet({ day, onClose }: { day: string | null; onClose: () => void }) {
  const toast = useToast();
  const changed = usePlanChanged();
  const recipes = useRecipes();
  const fridge = useFridge();
  const [slot, setSlot] = useState<MealSlot>("dinner");
  const [q, setQ] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    if (day) {
      setSlot(day === toDay(new Date()) ? slotForNow() : "dinner");
      setQ("");
      setText("");
    }
  }, [day]);

  const names = pantryNames(fridge.data);
  const staples = fridge.data?.staples ?? true;
  const matches = useQuery({
    queryKey: ["match", names.join("|"), staples],
    queryFn: () => api.matchPantry(names, staples),
    enabled: day != null && names.length > 0,
    staleTime: 30_000,
  });
  const missingBy = useMemo(() => new Map((matches.data ?? []).map((m) => [m.recipe.id, m.missing.length])), [matches.data]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = (recipes.data ?? []).filter((r) => !s || r.title.toLowerCase().includes(s) || r.tags.some((t) => t.toLowerCase().includes(s)));
    // 냉장고 재료로 만들 수 있는 것부터
    const rank = (r: RecipeSummary) => missingBy.get(r.id) ?? 99;
    return [...all].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
  }, [recipes.data, q, missingBy]);

  const add = useMutation({
    mutationFn: (body: { recipeId?: string; title?: string }) => api.addPlan({ day: day!, slot, ...body }),
    onSuccess: (entry) => {
      changed();
      onClose();
      toast.show(`${dateText(entry.day)} ${slotLabel(entry.slot)}에 넣었어요.`);
    },
    onError: (e) => toast.error(e),
  });

  const submitText = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) add.mutate({ title: text });
  };

  return (
    <Sheet open={day != null} onClose={onClose} title={day ? `${dateText(day)} (${weekdayOf(day)}) 메뉴` : ""}>
      <SlotChips value={slot} onChange={setSlot} />
      <div className="search" style={{ marginTop: 16 }}>
        <BookOpen aria-hidden="true" />
        <input className="input" value={q} placeholder="내 레시피에서 찾기" aria-label="내 레시피에서 찾기" onChange={(e) => setQ(e.target.value)} />
      </div>
      {recipes.isPending ? (
        <div className="skeleton" style={{ height: 120, marginTop: 12 }} />
      ) : list.length === 0 ? (
        <p className="help" style={{ marginTop: 12 }}>
          {q ? "맞는 레시피가 없어요." : "저장한 레시피가 없어요. 아래에 메뉴를 직접 적어도 돼요."}
        </p>
      ) : (
        <ul className="pick-list">
          {list.slice(0, 40).map((r) => {
            const miss = missingBy.get(r.id);
            return (
              <li key={r.id}>
                <button type="button" className="pick-row" disabled={add.isPending} onClick={() => add.mutate({ recipeId: r.id })}>
                  <span className="pick-thumb">
                    <RecipeImage src={r.image} title={r.title} />
                  </span>
                  <span className="pick-info">
                    <span className="pick-title">{r.title}</span>
                    {miss === 0 ? (
                      <span className="pick-hint is-ready">냉장고 재료로 바로 만들 수 있어요</span>
                    ) : miss != null && miss <= 2 ? (
                      <span className="pick-hint">재료 {miss}가지만 더 있으면 돼요</span>
                    ) : r.timeMinutes ? (
                      <span className="pick-hint">{r.timeMinutes}분</span>
                    ) : null}
                  </span>
                  <Plus aria-hidden="true" className="pick-plus" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="label sheet-label">직접 적기</p>
      <div className="chips" style={{ marginBottom: 10 }}>
        {QUICK_TITLES.map((t) => (
          <button key={t} type="button" className="chip" disabled={add.isPending} onClick={() => add.mutate({ title: t })}>
            {t}
          </button>
        ))}
      </div>
      <form className="inline-add" onSubmit={submitText}>
        <input className="input" value={text} maxLength={40} placeholder="예: 엄마표 미역국" onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn" disabled={!text.trim() || add.isPending}>
          넣기
        </button>
      </form>
    </Sheet>
  );
}

/* ───────── 메뉴 하나 ───────── */

function EntrySheet({ entry, onClose, onDone }: { entry: MealEntry | null; onClose: () => void; onDone: (e: MealEntry) => void }) {
  const toast = useToast();
  const changed = usePlanChanged();
  const [current, setCurrent] = useState(entry);
  const update = useMutation({
    mutationFn: (body: { day?: string; slot?: MealSlot; servings?: number | null }) => api.updatePlan(entry!.id, body),
    onSuccess: (e) => {
      setCurrent(e);
      changed();
    },
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({
    mutationFn: () => api.deletePlan(entry!.id),
    onSuccess: () => {
      changed();
      onClose();
      toast.show("식단에서 뺐어요.");
    },
    onError: (e) => toast.error(e),
  });
  const e = current;
  return (
    <Sheet
      open={entry != null}
      onClose={onClose}
      title={e?.title ?? ""}
      footer={
        e && (
          <div className="btn-row">
            <button type="button" className="btn btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2 aria-hidden="true" />
              식단에서 빼기
            </button>
            <button type="button" className={e.done ? "btn" : "btn btn-primary"} onClick={() => onDone(e)}>
              <Check aria-hidden="true" />
              {e.done ? "안 만든 걸로" : "만들었어요"}
            </button>
          </div>
        )
      }
    >
      {e && (
        <>
          {e.recipeId ? (
            <Link to={`/r/${e.recipeId}`} className="btn btn-block" style={{ marginBottom: 20 }}>
              <BookOpen aria-hidden="true" />
              레시피 보기
            </Link>
          ) : (
            <p className="sheet-lead">직접 적은 메뉴예요.</p>
          )}
          <label className="field">
            <span className="label">날짜</span>
            <input className="input" type="date" value={e.day} onChange={(ev) => DAY_RE.test(ev.target.value) && update.mutate({ day: ev.target.value })} />
          </label>
          <p className="label sheet-label">끼니</p>
          <SlotChips value={e.slot} onChange={(slot) => update.mutate({ slot })} />
          {e.recipeId && e.servings != null && (
            <>
              <p className="label sheet-label">몇 인분</p>
              <AmountStepper value={e.servings} unit="인분" step={1} min={1} max={20} label="인분" onChange={(servings) => update.mutate({ servings })} />
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

/** 식단에서 '만들었어요': 레시피를 받아 냉장고에서 뺄 재료를 보여 준다 */
function PlanCooked({ entry, onClose }: { entry: MealEntry; onClose: () => void }) {
  const { data: recipe } = useRecipe(entry.recipeId ?? undefined);
  const base = recipe?.content.servings ?? null;
  const factor = entry.servings && base ? entry.servings / base : 1;
  return <CookedSheet open onClose={onClose} recipe={recipe} factor={factor} planId={entry.id} />;
}

/* ───────── 장보기 ───────── */

function Needs({ from, to }: { from: string; to: string }) {
  const toast = useToast();
  const fridge = useFridge();
  const setFridge = useSetFridge();
  const needs = useQuery({ queryKey: ["plan-needs", from, to], queryFn: () => api.planNeeds(from, to) });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [into, setInto] = useState<string | null>(null);
  const fridges = fridge.data?.fridges ?? [];
  const target = into && fridges.some((f) => f.id === into) ? into : fridges[0]?.id;

  const add = useMutation({
    mutationFn: (lines: NeedLine[]) =>
      api.addItems(
        target!,
        lines.map((l) => {
          const a = l.amount.includes("+") ? { qty: null, unit: "" } : parseAmount(l.amount);
          return { name: l.name, qty: a.qty, unit: a.qty == null ? "" : a.unit };
        }),
      ),
    onSuccess: (s, lines) => {
      setFridge(s);
      setPicked(new Set());
      toast.show(`${lines.length}가지를 냉장고에 넣었어요.`);
    },
    onError: (e) => toast.error(e),
  });

  const lines = needs.data?.needs ?? [];
  return (
    <section className="section needs" aria-labelledby="needs-title">
      <div className="section-head">
        <h2 id="needs-title">
          <ShoppingBasket aria-hidden="true" />
          장보기
        </h2>
        {lines.length > 0 && <span className="section-hint">{lines.length}가지</span>}
      </div>
      {needs.isPending ? (
        <div className="skeleton" style={{ height: 80 }} />
      ) : !needs.data?.meals ? (
        <p className="help">이 7일 식단에 레시피를 넣으면, 냉장고에 없거나 모자란 재료를 여기에 모아 드려요.</p>
      ) : lines.length === 0 ? (
        <p className="help">이 7일 식단에 필요한 재료가 냉장고에 다 있어요.</p>
      ) : (
        <>
          <p className="help" style={{ marginBottom: 8 }}>
            이 7일 식단에 필요한데 냉장고에 없거나 모자란 재료예요. 산 재료를 골라 냉장고에 넣으세요.
          </p>
          <ul className="need-list">
            {lines.map((l) => (
              <li key={l.name}>
                <label className="need-row">
                  <input
                    type="checkbox"
                    checked={picked.has(l.name)}
                    onChange={(e) =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(l.name);
                        else n.delete(l.name);
                        return n;
                      })
                    }
                  />
                  <span className="need-info">
                    <span className="need-name">
                      {l.name}
                      {l.amount && <span className="need-amount num">{l.short ? `${l.amount} 더` : l.amount}</span>}
                    </span>
                    <span className="need-for">{l.recipes.join(", ")}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {fridges.length > 1 && (
            <div className="chips into-chips" role="radiogroup" aria-label="넣을 곳">
              <span className="help">넣을 곳</span>
              {fridges.map((f) => (
                <button key={f.id} type="button" className="chip" role="radio" aria-checked={target === f.id} aria-pressed={target === f.id} onClick={() => setInto(f.id)}>
                  {f.name}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary btn-block"
            style={{ marginTop: 12 }}
            disabled={picked.size === 0 || add.isPending || !target}
            onClick={() => add.mutate(lines.filter((l) => picked.has(l.name)))}
          >
            {picked.size ? `산 재료 ${picked.size}가지 냉장고에 넣기` : "산 재료를 골라 주세요"}
          </button>
        </>
      )}
    </section>
  );
}
