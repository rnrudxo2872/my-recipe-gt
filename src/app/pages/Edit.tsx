import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Camera, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { DIFFICULTIES, formatQty, normalizeRecipe, parseAmount, type Difficulty, type Ingredient, type RecipeContent } from "../../shared/recipe";
import { ChipInput } from "../components/ChipInput";
import { ApiError, api } from "../lib/api";
import { useDocumentTitle, useRecipe } from "../lib/hooks";
import { compressImage } from "../lib/image";
import { useToast } from "../lib/toast";

type IngRow = { key: number; kind: "item"; name: string; amount: string; note: string } | { key: number; kind: "group"; name: string };

let seq = 1;
const nextKey = () => seq++;

function amountText(i: Ingredient): string {
  return i.qty == null ? i.unit : `${formatQty(i.qty)}${i.unit}`;
}

function toRows(ingredients: Ingredient[]): IngRow[] {
  const rows: IngRow[] = [];
  let group = "";
  for (const i of ingredients) {
    if (i.group !== group) {
      group = i.group;
      if (group) rows.push({ key: nextKey(), kind: "group", name: group });
    }
    rows.push({ key: nextKey(), kind: "item", name: i.name, amount: amountText(i), note: i.note });
  }
  return rows;
}

function fromRows(rows: IngRow[]): Ingredient[] {
  const out: Ingredient[] = [];
  let group = "";
  for (const r of rows) {
    if (r.kind === "group") {
      group = r.name.trim();
      continue;
    }
    if (!r.name.trim()) continue;
    const a = parseAmount(r.amount);
    out.push({ name: r.name.trim(), qty: a.qty, unit: a.unit, note: [r.note.trim(), a.range ? `${a.range}${a.unit}` : ""].filter(Boolean).join(", "), group });
  }
  return out;
}

interface Draft {
  title: string;
  description: string;
  servings: string;
  time: string;
  difficulty: Difficulty | null;
  rows: IngRow[];
  steps: { key: number; text: string }[];
  tips: string;
  tags: string[];
  image: string | null;
}

function toDraft(c: RecipeContent | null, image: string | null): Draft {
  return {
    title: c?.title ?? "",
    description: c?.description ?? "",
    servings: c?.servings ? String(c.servings) : "",
    time: c?.timeMinutes ? String(c.timeMinutes) : "",
    difficulty: c?.difficulty ?? null,
    rows: c && c.ingredients.length ? toRows(c.ingredients) : [{ key: nextKey(), kind: "item", name: "", amount: "", note: "" }],
    steps: c && c.steps.length ? c.steps.map((text) => ({ key: nextKey(), text })) : [{ key: nextKey(), text: "" }],
    tips: c?.tips.join("\n") ?? "",
    tags: c?.tags ?? [],
    image,
  };
}

function fromDraft(d: Draft): RecipeContent {
  return normalizeRecipe({
    title: d.title,
    description: d.description,
    servings: d.servings,
    time_minutes: d.time,
    difficulty: d.difficulty,
    ingredients: fromRows(d.rows),
    steps: d.steps.map((s) => s.text),
    tips: d.tips.split("\n"),
    tags: d.tags,
  });
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function Edit() {
  const { id } = useParams();
  const isNew = !id;
  const { data: recipe, isPending } = useRecipe(id);
  useDocumentTitle(isNew ? "직접 작성" : "레시피 수정");
  if (!isNew && (isPending || !recipe)) {
    return (
      <div className="page">
        <div className="skeleton" style={{ aspectRatio: "16/9", borderRadius: 20 }} />
        <div className="skeleton" style={{ height: 48, marginTop: 20 }} />
        <div className="skeleton" style={{ height: 200, marginTop: 20 }} />
      </div>
    );
  }
  return <Editor key={id ?? "new"} id={id} initial={recipe ? toDraft(recipe.content, recipe.image) : toDraft(null, null)} />;
}

function Editor({ id, initial }: { id?: string; initial: Draft }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState<Draft>(initial);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const initialJson = useMemo(() => JSON.stringify({ c: fromDraft(initial), i: initial.image }), [initial]);
  const dirty = JSON.stringify({ c: fromDraft(d), i: d.image }) !== initialJson;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setRow = (key: number, patch: Partial<{ name: string; amount: string; note: string }>) =>
    setD((x) => ({ ...x, rows: x.rows.map((r) => (r.key === key ? ({ ...r, ...patch } as IngRow) : r)) }));

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      set("image", await api.uploadImage(await compressImage(file)));
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
    }
  }

  function cancel() {
    if (dirty && !window.confirm("저장하지 않은 내용이 사라져요. 나갈까요?")) return;
    navigate(id ? `/r/${id}` : "/", { replace: true });
  }

  async function save() {
    const content = fromDraft(d);
    if (!d.title.trim()) {
      setError("요리 이름을 적어 주세요.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (!content.ingredients.length && !content.steps.length) {
      setError("재료나 만드는 법을 하나 이상 적어 주세요.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      let targetId = id;
      if (id) {
        const changedContent = JSON.stringify(content) !== JSON.stringify(fromDraft(initial));
        if (changedContent) await api.saveRecipe(id, content, note.trim() || "직접 수정");
        if (d.image !== initial.image) await api.patchRecipe(id, { image: d.image });
      } else {
        targetId = (await api.createRecipe({ content, image: d.image })).id;
      }
      qc.invalidateQueries({ queryKey: ["recipes"] });
      qc.invalidateQueries({ queryKey: ["recipe", targetId] });
      qc.invalidateQueries({ queryKey: ["versions", targetId] });
      toast.show(id ? "수정한 내용을 저장했어요." : "레시피를 저장했어요.");
      navigate(`/r/${targetId}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했어요. 다시 시도해 주세요.");
      setSaving(false);
    }
  }

  return (
    <>
      <div className="editor-bar">
        <button type="button" className="icon-btn" aria-label="취소" onClick={cancel}>
          <X />
        </button>
        <h1>{id ? "레시피 수정" : "직접 작성"}</h1>
        <button type="button" className="btn btn-primary btn-sm" disabled={saving || uploading || (!dirty && Boolean(id))} onClick={save}>
          {saving ? "저장하는 중…" : "저장"}
        </button>
      </div>
      <div className="page" style={{ paddingTop: 16 }}>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="editor-photo">
          {d.image ? (
            <>
              <img src={d.image} alt="레시피 사진" />
              <div className="photo-actions">
                <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                  <Camera aria-hidden="true" />
                  {uploading ? "올리는 중…" : "사진 바꾸기"}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => set("image", null)}>
                  사진 빼기
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="empty-photo" onClick={() => fileRef.current?.click()}>
              <ImagePlus aria-hidden="true" />
              {uploading ? "사진 올리는 중…" : "완성 사진 넣기"}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
        </div>

        <label className="field">
          <span className="label">요리 이름</span>
          <input className="input" value={d.title} maxLength={80} placeholder="예: 돼지고기 김치찌개" onChange={(e) => set("title", e.target.value)} />
        </label>
        <label className="field">
          <span className="label">한 줄 소개</span>
          <textarea className="textarea" rows={2} value={d.description} maxLength={600} placeholder="어떤 맛인지, 언제 먹으면 좋은지" onChange={(e) => set("description", e.target.value)} />
        </label>
        <div className="grid-3">
          <label className="field">
            <span className="label">인분</span>
            <input className="input num" inputMode="numeric" value={d.servings} placeholder="2" onChange={(e) => set("servings", e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="field">
            <span className="label">시간(분)</span>
            <input className="input num" inputMode="numeric" value={d.time} placeholder="20" onChange={(e) => set("time", e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="field">
            <span className="label">난이도</span>
            <select className="select" value={d.difficulty ?? ""} onChange={(e) => set("difficulty", (e.target.value || null) as Difficulty | null)}>
              <option value="">선택 안 함</option>
              {DIFFICULTIES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section className="editor-section">
          <h2>재료</h2>
          <p className="help" style={{ marginBottom: 10 }}>
            분량은 '2큰술', '200g', '약간'처럼 적어 주세요. 양념장처럼 따로 섞는 재료는 묶음으로 나눌 수 있어요.
          </p>
          <div className="edit-rows">
            {d.rows.map((r, idx) =>
              r.kind === "group" ? (
                <div className="edit-row is-group" key={r.key}>
                  <input className="input" value={r.name} placeholder="묶음 이름 (예: 양념장)" aria-label="묶음 이름" onChange={(e) => setRow(r.key, { name: e.target.value })} />
                  <RowTools
                    onUp={() => set("rows", move(d.rows, idx, idx - 1))}
                    onDown={() => set("rows", move(d.rows, idx, idx + 1))}
                    onRemove={() => set("rows", d.rows.filter((x) => x.key !== r.key))}
                    label={r.name || "묶음"}
                  />
                </div>
              ) : (
                <div className="edit-row" key={r.key}>
                  <div className="cells">
                    <input className="input" value={r.name} placeholder="재료" aria-label="재료 이름" onChange={(e) => setRow(r.key, { name: e.target.value })} />
                    <input className="input" value={r.amount} placeholder="분량" aria-label="분량" onChange={(e) => setRow(r.key, { amount: e.target.value })} />
                    <input className="input note-cell" value={r.note} placeholder="메모 (예: 송송 썬)" aria-label="메모" onChange={(e) => setRow(r.key, { note: e.target.value })} />
                  </div>
                  <RowTools
                    onUp={() => set("rows", move(d.rows, idx, idx - 1))}
                    onDown={() => set("rows", move(d.rows, idx, idx + 1))}
                    onRemove={() => set("rows", d.rows.filter((x) => x.key !== r.key))}
                    label={r.name || "재료"}
                  />
                </div>
              ),
            )}
          </div>
          <div className="add-row">
            <button type="button" className="btn btn-soft btn-sm" onClick={() => set("rows", [...d.rows, { key: nextKey(), kind: "item", name: "", amount: "", note: "" }])}>
              <Plus aria-hidden="true" />
              재료 추가
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => set("rows", [...d.rows, { key: nextKey(), kind: "group", name: "" }])}>
              <Plus aria-hidden="true" />
              묶음 추가
            </button>
          </div>
        </section>

        <section className="editor-section">
          <h2>만드는 법</h2>
          <div className="edit-rows">
            {d.steps.map((s, idx) => (
              <div className="edit-row" key={s.key}>
                <span className="step-num">{idx + 1}</span>
                <textarea
                  className="textarea"
                  rows={2}
                  value={s.text}
                  placeholder={idx === 0 ? "예: 냄비에 기름을 두르고 돼지고기를 중불에서 3분 볶아요." : "다음 단계"}
                  aria-label={`${idx + 1}단계`}
                  onChange={(e) => set("steps", d.steps.map((x) => (x.key === s.key ? { ...x, text: e.target.value } : x)))}
                />
                <RowTools
                  onUp={() => set("steps", move(d.steps, idx, idx - 1))}
                  onDown={() => set("steps", move(d.steps, idx, idx + 1))}
                  onRemove={() => set("steps", d.steps.filter((x) => x.key !== s.key))}
                  label={`${idx + 1}단계`}
                />
              </div>
            ))}
          </div>
          <div className="add-row">
            <button type="button" className="btn btn-soft btn-sm" onClick={() => set("steps", [...d.steps, { key: nextKey(), text: "" }])}>
              <Plus aria-hidden="true" />
              단계 추가
            </button>
          </div>
        </section>

        <section className="editor-section">
          <h2>팁</h2>
          <label className="field">
            <span className="sr-only">팁</span>
            <textarea className="textarea" rows={3} value={d.tips} placeholder="한 줄에 하나씩 적어 주세요" onChange={(e) => set("tips", e.target.value)} />
          </label>
        </section>

        <section className="editor-section">
          <h2>태그</h2>
          <ChipInput values={d.tags} onChange={(v) => set("tags", v)} placeholder="예: 국물요리, 15분" label="태그" max={10} />
        </section>

        {id && (
          <section className="editor-section">
            <label className="field">
              <span className="label">무엇을 바꿨나요? (선택)</span>
              <input className="input" value={note} maxLength={80} placeholder="예: 소금 줄이고 청양고추 추가" onChange={(e) => setNote(e.target.value)} />
              <span className="help">버전 기록에 이 메모로 남아요. 원본은 언제든 되돌릴 수 있어요.</span>
            </label>
          </section>
        )}

        <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 24 }} disabled={saving || uploading || (!dirty && Boolean(id))} onClick={save}>
          {saving ? "저장하는 중…" : id ? "수정한 내용 저장" : "레시피 저장"}
        </button>
      </div>
    </>
  );
}

function RowTools(props: { onUp: () => void; onDown: () => void; onRemove: () => void; label: string }) {
  return (
    <div className="row-tools">
      <button type="button" className="icon-btn" aria-label={`${props.label} 위로`} onClick={props.onUp}>
        <ArrowUp />
      </button>
      <button type="button" className="icon-btn" aria-label={`${props.label} 아래로`} onClick={props.onDown}>
        <ArrowDown />
      </button>
      <button type="button" className="icon-btn" aria-label={`${props.label} 지우기`} onClick={props.onRemove}>
        <Trash2 />
      </button>
    </div>
  );
}
