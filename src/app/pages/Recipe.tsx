import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  Camera,
  Check,
  ChefHat,
  CircleCheck,
  Clock,
  Ellipsis,
  ExternalLink,
  Gauge,
  Heart,
  History,
  Minus,
  Pencil,
  Plus,
  Repeat2,
  Share2,
  Sparkles,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { SubstituteResult } from "../../shared/api";
import { formatAmount, formatQty, recipeToText, type Ingredient, type RecipeContent, type RecipeDetail, type RecipeVersion } from "../../shared/recipe";
import { InstagramIcon, YouTubeIcon } from "../components/Icons";
import { RecipeImage } from "../components/RecipeImage";
import { Sheet } from "../components/Sheet";
import { ApiError, api } from "../lib/api";
import { useAiLeft, useDocumentTitle, useRecipe, useRecipeSummary } from "../lib/hooks";
import { compressImage } from "../lib/image";
import { relativeTime, replaceIngredientName } from "../lib/text";
import { useToast } from "../lib/toast";

const FACTORS = [0.5, 1, 1.5, 2, 3];

/** 원래 분량 기준 배수. 인분을 알면 인분으로, 모르면 배수로 조절한다. */
function useScale(base: number | null) {
  const [target, setTarget] = useState<number | null>(null);
  const [factorIdx, setFactorIdx] = useState(1);
  if (base) {
    const current = target ?? base;
    return {
      factor: current / base,
      label: `${current}인분`,
      canDown: current > 1,
      canUp: current < 20,
      down: () => setTarget(Math.max(1, current - 1)),
      up: () => setTarget(Math.min(20, current + 1)),
    };
  }
  const factor = FACTORS[factorIdx];
  return {
    factor,
    label: factor === 1 ? "기본 양" : `${formatQty(factor)}배`,
    canDown: factorIdx > 0,
    canUp: factorIdx < FACTORS.length - 1,
    down: () => setFactorIdx((i) => Math.max(0, i - 1)),
    up: () => setFactorIdx((i) => Math.min(FACTORS.length - 1, i + 1)),
  };
}

function SourceLink({ recipe }: { recipe: RecipeDetail }) {
  if (!recipe.sourceUrl) return null;
  const label = recipe.sourceType === "youtube" ? "유튜브에서 영상 보기" : recipe.sourceType === "instagram" ? "인스타그램에서 보기" : "원본 페이지 보기";
  return (
    <a className="source-link" href={recipe.sourceUrl} target="_blank" rel="noreferrer noopener">
      {recipe.sourceType === "youtube" ? <YouTubeIcon /> : recipe.sourceType === "instagram" ? <InstagramIcon /> : <ExternalLink aria-hidden="true" />}
      {label}
    </a>
  );
}

function IngredientList(props: { ingredients: Ingredient[]; factor: number; missing: Set<number>; onToggle: (i: number) => void }) {
  let lastGroup = "";
  return (
    <ul className="ing-list">
      {props.ingredients.map((ing, i) => {
        const groupHead = ing.group !== lastGroup && ing.group;
        lastGroup = ing.group;
        const isMissing = props.missing.has(i);
        return (
          <Fragment key={i}>
            {groupHead && (
              <li className="ing-group" aria-hidden="true">
                {ing.group}
              </li>
            )}
            <li className={`ing ${isMissing ? "is-missing" : ""}`}>
              <button type="button" aria-pressed={isMissing} onClick={() => props.onToggle(i)}>
                <span className="ing-mark" aria-hidden="true">
                  {isMissing ? <Minus /> : <Check />}
                </span>
                <span className="ing-name">
                  <span className="hl">{ing.name}</span>
                  {isMissing && <span className="ing-missing-label">없음</span>}
                  {ing.note && <span className="ing-note">{ing.note}</span>}
                  {ing.group && <span className="sr-only">({ing.group})</span>}
                </span>
                <span className="ing-amount">{formatAmount(ing, props.factor)}</span>
              </button>
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}

export function RecipePage() {
  const { id } = useParams();
  const summary = useRecipeSummary(id);
  const { data: recipe, isPending, isError, error } = useRecipe(id);
  useDocumentTitle(recipe?.title ?? summary?.title);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [missing, setMissing] = useState<Set<number>>(new Set());
  const [sheet, setSheet] = useState<null | "subs" | "tweak" | "versions" | "menu" | "delete">(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scale = useScale(recipe?.content.servings ?? null);
  const aiLeft = useAiLeft();

  const setDetail = (r: RecipeDetail) => {
    qc.setQueryData(["recipe", r.id], r);
    qc.invalidateQueries({ queryKey: ["recipes"] });
    qc.invalidateQueries({ queryKey: ["versions", r.id] });
  };

  const favorite = useMutation({
    mutationFn: (fav: boolean) => api.patchRecipe(id!, { favorite: fav }),
    onMutate: (fav) => {
      if (recipe) qc.setQueryData(["recipe", id], { ...recipe, favorite: fav });
    },
    onSuccess: setDetail,
    onError: (e) => toast.error(e),
  });

  const photo = useMutation({
    mutationFn: async (file: File) => api.patchRecipe(id!, { image: await api.uploadImage(await compressImage(file)) }),
    onSuccess: (r) => {
      setDetail(r);
      toast.show("사진을 바꿨어요.");
    },
    onError: (e) => toast.error(e),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteRecipe(id!),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["recipe", id] });
      qc.invalidateQueries({ queryKey: ["recipes"] });
      toast.show("레시피를 지웠어요.");
      navigate("/", { replace: true });
    },
    onError: (e) => toast.error(e),
  });

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="page">
        <div className="empty">
          <h2>{notFound ? "레시피를 찾을 수 없어요" : "레시피를 불러오지 못했어요"}</h2>
          <p>{notFound ? "이미 지웠거나 다른 계정의 레시피예요." : "인터넷 연결을 확인해 주세요."}</p>
          <Link to="/" className="btn">
            내 레시피로 가기
          </Link>
        </div>
      </div>
    );
  }

  const title = recipe?.title ?? summary?.title ?? "";
  const image = recipe?.image ?? summary?.image ?? null;
  const content = recipe?.content;
  const missingNames = content ? [...missing].sort((a, b) => a - b).map((i) => content.ingredients[i]?.name).filter(Boolean) : [];

  async function share() {
    if (!recipe) return;
    const text = recipeToText(recipe.content, recipe.sourceUrl);
    setSheet(null);
    try {
      if (navigator.share) {
        await navigator.share({ title: recipe.title, text });
        return;
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.show("레시피를 글로 복사했어요. 메신저에 붙여넣으면 돼요.");
    } catch {
      toast.show("복사하지 못했어요.", { tone: "error" });
    }
  }

  return (
    <article className="detail">
      <div className="hero">
        <RecipeImage src={image} title={title || "?"} eager />
        <div className="hero-bar">
          <button type="button" className="icon-btn on-photo" aria-label="뒤로" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}>
            <ArrowLeft />
          </button>
          {recipe && (
            <div className="right">
              <button
                type="button"
                className={`icon-btn on-photo ${recipe.favorite ? "is-fav" : ""}`}
                aria-label={recipe.favorite ? "즐겨찾기 빼기" : "즐겨찾기"}
                aria-pressed={recipe.favorite}
                onClick={() => favorite.mutate(!recipe.favorite)}
              >
                <Heart />
              </button>
              <button type="button" className="icon-btn on-photo" aria-label="더 보기" onClick={() => setSheet("menu")}>
                <Ellipsis />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="sheet-body">
        <h1 className="recipe-title">{title}</h1>
        {isPending || !recipe || !content ? (
          <div aria-busy="true" aria-label="레시피 불러오는 중">
            <div className="skeleton" style={{ height: 18, marginTop: 14, width: "90%" }} />
            <div className="skeleton" style={{ height: 18, marginTop: 8, width: "60%" }} />
            <div className="skeleton" style={{ height: 220, marginTop: 28 }} />
          </div>
        ) : (
          <>
            {content.description && <p className="recipe-desc">{content.description}</p>}
            <div className="meta-row">
              {content.timeMinutes && (
                <span className="meta-pill">
                  <Clock aria-hidden="true" />
                  {content.timeMinutes}분
                </span>
              )}
              <span className="meta-pill stepper" role="group" aria-label="분량 조절">
                <Users aria-hidden="true" style={{ marginLeft: 8 }} />
                <button type="button" onClick={scale.down} disabled={!scale.canDown} aria-label="분량 줄이기">
                  <Minus />
                </button>
                <output aria-live="polite">{scale.label}</output>
                <button type="button" onClick={scale.up} disabled={!scale.canUp} aria-label="분량 늘리기">
                  <Plus />
                </button>
              </span>
              {content.difficulty && (
                <span className="meta-pill">
                  <Gauge aria-hidden="true" />
                  {content.difficulty}
                </span>
              )}
            </div>
            <SourceLink recipe={recipe} />

            <section className="section" aria-labelledby="ing-title">
              <div className="section-head">
                <h2 id="ing-title">재료</h2>
                <span className="section-hint">{missing.size ? `없는 재료 ${missing.size}개` : "집에 없는 재료를 눌러 주세요"}</span>
              </div>
              {content.ingredients.length ? (
                <IngredientList
                  ingredients={content.ingredients}
                  factor={scale.factor}
                  missing={missing}
                  onToggle={(i) =>
                    setMissing((m) => {
                      const next = new Set(m);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                />
              ) : (
                <p className="help">적힌 재료가 없어요.</p>
              )}
            </section>

            <section className="section" aria-labelledby="step-title">
              <div className="section-head">
                <h2 id="step-title">만드는 법</h2>
              </div>
              {content.steps.length ? (
                <ol className="steps">
                  {content.steps.map((s, i) => (
                    <li key={i}>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="help">적힌 순서가 없어요.</p>
              )}
            </section>

            {content.tips.length > 0 && (
              <section className="section" aria-labelledby="tip-title">
                <div className="section-head">
                  <h2 id="tip-title">팁</h2>
                </div>
                <ul className="tips">
                  {content.tips.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </section>
            )}

            {content.tags.length > 0 && (
              <div className="tags">
                {content.tags.map((t) => (
                  <span className="tag" key={t}>
                    #{t}
                  </span>
                ))}
              </div>
            )}

            <div className="detail-actions">
              <Link to={`/r/${recipe.id}/cook${scale.factor !== 1 ? `?x=${scale.factor}` : ""}`} className="btn btn-primary">
                <ChefHat aria-hidden="true" />
                요리 시작
              </Link>
              <button type="button" className="btn" onClick={() => setSheet("tweak")}>
                <Sparkles aria-hidden="true" />
                입맛대로 바꾸기
              </button>
              <Link to={`/r/${recipe.id}/edit`} className="btn">
                <Pencil aria-hidden="true" />
                직접 수정
              </Link>
            </div>
            <button type="button" className="version-link" onClick={() => setSheet("versions")}>
              <History aria-hidden="true" />
              {recipe.versionCount > 1 ? `버전 기록 ${recipe.versionCount}개 · 원본으로 되돌리기` : "버전 기록"}
            </button>
          </>
        )}
      </div>

      {missing.size > 0 && sheet === null && (
        <div className="missing-bar" role="region" aria-label="없는 재료">
          <p>
            없는 재료 {missing.size}개
            {aiLeft !== null && <span className="bar-sub">{aiLeft > 0 ? `오늘 AI ${aiLeft}번 남음` : "오늘 AI를 다 썼어요. 자정에 다시 채워져요."}</span>}
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            // 같은 재료로 이미 받아 둔 결과는 AI를 다시 부르지 않으니 횟수를 다 써도 열 수 있다.
            disabled={aiLeft === 0 && !(recipe && qc.getQueryData(["subs", recipe.id, recipe.updatedAt, missingNames.join("|")]))}
            onClick={() => setSheet("subs")}
          >
            <Repeat2 aria-hidden="true" />
            대체 재료 찾기
          </button>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && photo.mutate(e.target.files[0])} />

      {recipe && (
        <>
          <SubstituteSheet
            open={sheet === "subs"}
            onClose={() => setSheet(null)}
            recipe={recipe}
            missing={missingNames}
            onApplied={(r) => {
              setDetail(r);
              setMissing(new Set());
              setSheet(null);
              toast.show("대체 재료를 반영한 새 버전을 저장했어요.");
            }}
          />
          <TweakSheet
            open={sheet === "tweak"}
            onClose={() => setSheet(null)}
            recipe={recipe}
            onSaved={(r) => {
              setDetail(r);
              setMissing(new Set());
              setSheet(null);
              toast.show("내 입맛 버전을 저장했어요. 버전 기록에서 원본으로 되돌릴 수 있어요.");
            }}
          />
          <VersionsSheet
            open={sheet === "versions"}
            onClose={() => setSheet(null)}
            recipe={recipe}
            onRestored={(r) => {
              setDetail(r);
              setMissing(new Set());
              setSheet(null);
              toast.show("선택한 버전으로 되돌렸어요.");
            }}
          />
          <Sheet open={sheet === "menu"} onClose={() => setSheet(null)} title="레시피 메뉴">
            <div className="menu-list">
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setSheet(null);
                  fileRef.current?.click();
                }}
              >
                <Camera aria-hidden="true" />
                {photo.isPending ? "사진 올리는 중…" : "사진 바꾸기"}
              </button>
              <button type="button" className="menu-item" onClick={share}>
                <Share2 aria-hidden="true" />
                글로 공유하기
              </button>
              {recipe.sourceUrl && (
                <a className="menu-item" href={recipe.sourceUrl} target="_blank" rel="noreferrer noopener" onClick={() => setSheet(null)}>
                  <ExternalLink aria-hidden="true" />
                  원본 열기
                </a>
              )}
              <button type="button" className="menu-item is-danger" onClick={() => setSheet("delete")}>
                <Trash2 aria-hidden="true" />
                레시피 지우기
              </button>
            </div>
          </Sheet>
          <Sheet
            open={sheet === "delete"}
            onClose={() => setSheet(null)}
            title="레시피를 지울까요?"
            footer={
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => setSheet(null)}>
                  그대로 두기
                </button>
                <button type="button" className="btn btn-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
                  <Trash2 aria-hidden="true" />
                  {remove.isPending ? "지우는 중…" : "지우기"}
                </button>
              </div>
            }
          >
            <p>'{recipe.title}'와 버전 기록이 모두 지워져요. 되돌릴 수 없어요.</p>
          </Sheet>
        </>
      )}
    </article>
  );
}

/* ───────── 대체 재료 ───────── */

type Choice = number | "skip" | null;

export function applySubstitutes(content: RecipeContent, result: SubstituteResult, choices: Record<string, Choice>) {
  let ingredients = [...content.ingredients];
  let steps = [...content.steps];
  const tips = [...content.tips];
  const notes: string[] = [];
  for (const item of result.items) {
    const choice = choices[item.missing];
    if (choice == null) continue;
    let idx = ingredients.findIndex((i) => i.name === item.missing);
    if (idx < 0) idx = ingredients.findIndex((i) => i.name.includes(item.missing) || item.missing.includes(i.name));
    if (idx < 0) continue;
    const orig = ingredients[idx];
    if (choice === "skip") {
      ingredients = ingredients.filter((_, i) => i !== idx);
      if (item.skipNote) tips.push(`${orig.name} 없이: ${item.skipNote}`);
      notes.push(`${orig.name} 뺌`);
    } else {
      const opt = item.options[choice];
      if (!opt) continue;
      ingredients[idx] = { ...orig, name: opt.name, qty: opt.qty, unit: opt.unit || (opt.qty == null ? "약간" : ""), note: `${orig.name} 대신` };
      steps = steps.map((s) => replaceIngredientName(s, orig.name, opt.name));
      if (opt.note) tips.push(`${opt.name}: ${opt.note}`);
      notes.push(`${orig.name} → ${opt.name}`);
    }
  }
  return { content: { ...content, ingredients, steps, tips: tips.slice(-20) }, note: notes.join(", ").slice(0, 80) };
}

function AiWait({ text }: { text: string }) {
  return (
    <div className="ai-wait" aria-live="polite" aria-busy="true">
      <img src="/icons/logo-96.png" alt="" />
      <p>{text}</p>
    </div>
  );
}

function SubstituteSheet(props: { open: boolean; onClose: () => void; recipe: RecipeDetail; missing: string[]; onApplied: (r: RecipeDetail) => void }) {
  const { open, recipe, missing } = props;
  const toast = useToast();
  const qc = useQueryClient();
  const key = missing.join("|");
  const query = useQuery({
    queryKey: ["subs", recipe.id, recipe.updatedAt, key],
    queryFn: () => api.substitutes(recipe.id, missing),
    enabled: open && missing.length > 0,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const result = query.data;

  // AI를 한 번 썼으니 남은 횟수를 새로 받는다.
  useEffect(() => {
    if (query.dataUpdatedAt) qc.invalidateQueries({ queryKey: ["me"] });
  }, [query.dataUpdatedAt, qc]);

  // 결과가 오면 첫 번째 추천을 골라 둔다.
  const effective = useMemo(() => {
    const out: Record<string, Choice> = {};
    for (const item of result?.items ?? []) out[item.missing] = item.missing in choices ? choices[item.missing] : item.options.length ? 0 : item.canSkip ? "skip" : null;
    return out;
  }, [result, choices]);

  const apply = useMutation({
    mutationFn: () => {
      const { content, note } = applySubstitutes(recipe.content, result!, effective);
      return api.saveRecipe(recipe.id, content, note || "재료 바꿈", "substitute");
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["me"] });
      props.onApplied(r);
    },
    onError: (e) => toast.error(e),
  });

  const anyChosen = Object.values(effective).some((c) => c != null);

  return (
    <Sheet
      open={open}
      onClose={props.onClose}
      title="대체 재료"
      footer={
        result && result.items.length > 0 ? (
          <button type="button" className="btn btn-primary btn-block" disabled={!anyChosen || apply.isPending} onClick={() => apply.mutate()}>
            <Repeat2 aria-hidden="true" />
            {apply.isPending ? "저장하는 중…" : "고른 대로 새 버전 저장"}
          </button>
        ) : undefined
      }
    >
      {query.isPending ? (
        <AiWait text={`${missing.join(", ")} 대신 쓸 재료를 찾고 있어요`} />
      ) : query.isError ? (
        <div className="empty">
          <h2>대체 재료를 찾지 못했어요</h2>
          <p>{query.error instanceof Error ? query.error.message : "다시 시도해 주세요."}</p>
          <button type="button" className="btn" onClick={() => query.refetch()}>
            다시 찾기
          </button>
        </div>
      ) : result && result.items.length > 0 ? (
        <>
          {result.items.map((item) => (
            <fieldset className="option-group" key={item.missing} style={{ border: "none", padding: 0, margin: "0 0 22px" }}>
              <legend style={{ padding: 0 }}>
                <h3>{item.missing} 대신</h3>
              </legend>
              {item.options.map((op, i) => (
                <label className="option" key={i}>
                  <input type="radio" name={`sub-${item.missing}`} checked={effective[item.missing] === i} onChange={() => setChoices((c) => ({ ...c, [item.missing]: i }))} />
                  <span>
                    <span className="option-title">
                      {op.name}
                      <span className="amount">{formatAmount(op)}</span>
                    </span>
                    {op.note && <span className="option-note" style={{ display: "block" }}>{op.note}</span>}
                  </span>
                </label>
              ))}
              {item.canSkip && (
                <label className="option">
                  <input type="radio" name={`sub-${item.missing}`} checked={effective[item.missing] === "skip"} onChange={() => setChoices((c) => ({ ...c, [item.missing]: "skip" }))} />
                  <span>
                    <span className="option-title">빼고 만들기</span>
                    {item.skipNote && <span className="option-note" style={{ display: "block" }}>{item.skipNote}</span>}
                  </span>
                </label>
              )}
              <label className="option">
                <input type="radio" name={`sub-${item.missing}`} checked={effective[item.missing] === null} onChange={() => setChoices((c) => ({ ...c, [item.missing]: null }))} />
                <span className="option-title">그대로 두기</span>
              </label>
            </fieldset>
          ))}
          {result.tip && (
            <p className="notice">
              <Sparkles aria-hidden="true" />
              {result.tip}
            </p>
          )}
        </>
      ) : (
        <div className="empty">
          <h2>추천할 대체 재료가 없어요</h2>
          <p>다른 재료를 골라 보세요.</p>
        </div>
      )}
    </Sheet>
  );
}

/* ───────── 입맛대로 바꾸기 ───────── */

const PRESETS = ["더 맵게", "덜 맵게", "덜 짜게", "덜 달게", "더 건강하게", "더 간단하게", "1인분으로", "4인분으로", "아이도 먹게"];

function TweakSheet(props: { open: boolean; onClose: () => void; recipe: RecipeDetail; onSaved: (r: RecipeDetail) => void }) {
  const { recipe } = props;
  const toast = useToast();
  const qc = useQueryClient();
  const [instruction, setInstruction] = useState("");
  const [showFull, setShowFull] = useState(false);
  const aiLeft = useAiLeft();
  const tweak = useMutation({
    mutationFn: (text: string) => api.tweak(recipe.id, text),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  const save = useMutation({
    mutationFn: () => api.saveRecipe(recipe.id, tweak.data!.content, instruction.trim() || "AI로 맛 조정", "ai"),
    onSuccess: (r) => {
      tweak.reset();
      setInstruction("");
      props.onSaved(r);
    },
    onError: (e) => toast.error(e),
  });

  // 레시피가 다른 방법으로 바뀌면 옛 내용 기준 결과는 버린다(저장하면 바뀐 내용을 덮어쓰게 되므로).
  const { reset } = tweak;
  useEffect(() => {
    reset();
  }, [recipe.updatedAt, reset]);

  const before = new Set(recipe.content.ingredients.map((i) => `${i.name} ${formatAmount(i)}`));

  // 닫아도 받은 결과는 남겨 둔다. 다시 열면 AI를 또 부르지 않고 이어서 저장할 수 있다.
  function close() {
    setShowFull(false);
    props.onClose();
  }

  let body;
  let footer;
  if (tweak.isPending) {
    body = <AiWait text={`'${instruction}' 요청대로 레시피를 고치고 있어요`} />;
  } else if (tweak.data) {
    const next = tweak.data.content;
    body = (
      <>
        <p className="card-sub" style={{ margin: "0 0 12px" }}>
          요청: {instruction}
        </p>
        {tweak.data.changes.length > 0 && (
          <ul className="change-list">
            {tweak.data.changes.map((c, i) => (
              <li key={i}>
                <CircleCheck aria-hidden="true" />
                {c}
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn btn-soft btn-sm" onClick={() => setShowFull((v) => !v)} aria-expanded={showFull}>
          {showFull ? "바뀐 레시피 접기" : "바뀐 레시피 전체 보기"}
        </button>
        {showFull && (
          <div className="preview-box" style={{ marginTop: 12 }}>
            <h4>{next.title}</h4>
            <h4>재료</h4>
            <ul>
              {next.ingredients.map((i, idx) => {
                const line = `${i.name} ${formatAmount(i)}`;
                return (
                  <li key={idx} className={before.has(line) ? "" : "is-changed"}>
                    {line}
                    {i.note ? ` (${i.note})` : ""}
                  </li>
                );
              })}
            </ul>
            <h4>만드는 법</h4>
            <ol>
              {next.steps.map((s, idx) => (
                <li key={idx} className={recipe.content.steps.includes(s) ? "" : "is-changed"}>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        )}
      </>
    );
    footer = (
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => tweak.reset()}>
          다시 고르기
        </button>
        <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "저장하는 중…" : "새 버전으로 저장"}
        </button>
      </div>
    );
  } else {
    body = (
      <>
        {tweak.isError && (
          <p className="form-error" role="alert">
            {tweak.error instanceof Error ? tweak.error.message : "바꾸지 못했어요. 다시 시도해 주세요."}
          </p>
        )}
        <p className="card-sub" style={{ margin: "0 0 14px" }}>
          원본은 그대로 남고, 바꾼 레시피는 새 버전으로 저장돼요.
        </p>
        <div className="chips" role="group" aria-label="자주 쓰는 요청">
          {PRESETS.map((p) => (
            <button key={p} type="button" className="chip" aria-pressed={instruction === p} onClick={() => setInstruction(p)}>
              {p}
            </button>
          ))}
        </div>
        <label className="field" style={{ marginTop: 16 }}>
          <span className="label">직접 적기</span>
          <input className="input" value={instruction} maxLength={200} placeholder="예: 버터 대신 올리브유로, 에어프라이어로" onChange={(e) => setInstruction(e.target.value)} />
        </label>
        {aiLeft !== null && (
          <p className="help">{aiLeft > 0 ? `오늘 AI ${aiLeft}번 남았어요.` : "오늘 AI를 다 썼어요. 자정에 다시 채워져요. 직접 수정은 언제든 할 수 있어요."}</p>
        )}
      </>
    );
    footer = (
      <button type="button" className="btn btn-primary btn-block" disabled={!instruction.trim() || aiLeft === 0} onClick={() => tweak.mutate(instruction.trim())}>
        <Sparkles aria-hidden="true" />
        이렇게 바꿔 보기
      </button>
    );
  }

  return (
    <Sheet open={props.open} onClose={close} title="입맛대로 바꾸기" footer={footer}>
      {body}
    </Sheet>
  );
}

/* ───────── 버전 기록 ───────── */

const KIND: Record<RecipeVersion["kind"], { label: string; icon: typeof BookOpen }> = {
  original: { label: "원본", icon: BookOpen },
  edit: { label: "직접 수정", icon: Pencil },
  ai: { label: "AI 조정", icon: Sparkles },
  substitute: { label: "재료 바꿈", icon: Repeat2 },
  restore: { label: "되돌림", icon: Undo2 },
};

function VersionsSheet(props: { open: boolean; onClose: () => void; recipe: RecipeDetail; onRestored: (r: RecipeDetail) => void }) {
  const { recipe } = props;
  const toast = useToast();
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useQuery({ queryKey: ["versions", recipe.id], queryFn: () => api.versions(recipe.id), enabled: props.open });
  const detail = useQuery({
    queryKey: ["version", recipe.id, openId],
    queryFn: () => api.version(recipe.id, openId!),
    enabled: props.open && openId != null,
    staleTime: Infinity,
  });
  const restore = useMutation({
    mutationFn: (vid: number) => api.restoreVersion(recipe.id, vid),
    onSuccess: (r) => {
      setOpenId(null);
      props.onRestored(r);
    },
    onError: (e) => toast.error(e),
  });

  return (
    <Sheet open={props.open} onClose={props.onClose} title="버전 기록">
      {list.isPending ? (
        <AiWait text="버전 기록을 불러오고 있어요" />
      ) : list.isError ? (
        <p className="form-error">버전 기록을 불러오지 못했어요.</p>
      ) : (
        <div>
          {list.data.map((v, idx) => {
            const k = KIND[v.kind] ?? KIND.edit;
            const isOpen = openId === v.id;
            return (
              <div className="version-row" key={v.id}>
                <button type="button" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : v.id)}>
                  <span className="version-kind">
                    <k.icon aria-hidden="true" />
                  </span>
                  <span className="grow">
                    <span className="version-note" style={{ display: "block" }}>
                      {v.note || k.label}
                    </span>
                    <span className="version-time">
                      {k.label}, {relativeTime(v.createdAt)}
                    </span>
                  </span>
                  {idx === 0 && <span className="badge is-admin">지금 버전</span>}
                </button>
                {isOpen && (
                  <div className="version-preview">
                    {detail.isPending ? (
                      <div className="skeleton" style={{ height: 80 }} />
                    ) : detail.data ? (
                      <div className="preview-box">
                        <h4>{detail.data.content.title}</h4>
                        <ul>
                          {detail.data.content.ingredients.map((i, n) => (
                            <li key={n}>
                              {i.name} {formatAmount(i)}
                            </li>
                          ))}
                        </ul>
                        {idx !== 0 && (
                          <button type="button" className="btn btn-primary btn-sm" disabled={restore.isPending} onClick={() => restore.mutate(v.id)}>
                            <Undo2 aria-hidden="true" />
                            {restore.isPending ? "되돌리는 중…" : "이 버전으로 되돌리기"}
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
