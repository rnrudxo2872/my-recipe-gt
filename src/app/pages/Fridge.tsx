import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { COMMON_INGREDIENTS, ingredientMatches, isStaple } from "../../shared/ingredients";
import { formatAmount, type RecipeContent } from "../../shared/recipe";
import { ChipInput } from "../components/ChipInput";
import { RecipeImage } from "../components/RecipeImage";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { useDocumentTitle, useUser } from "../lib/hooks";
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
  return recipe.ingredients
    .filter((i) => !pantry.some((p) => ingredientMatches(p, i.name)) && !(staples && isStaple(i.name)))
    .map((i) => i.name);
}

export function Fridge() {
  useDocumentTitle("냉장고");
  const me = useUser();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const pantry = useQuery({ queryKey: ["pantry"], queryFn: api.pantry, staleTime: Infinity });
  const [items, setItems] = useState<string[] | null>(null);
  const [staples, setStaples] = useState(true);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<RecipeContent | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (pantry.data && !loaded.current) {
      loaded.current = true;
      setItems(pantry.data.items);
      setStaples(pantry.data.staples);
    }
  }, [pantry.data]);

  // 바꾼 재료는 조금 뒤에 저장해서 다음에 와도 남아 있게 한다.
  useEffect(() => {
    if (!loaded.current || items == null) return;
    const t = window.setTimeout(() => {
      api.savePantry(items, staples).then((d) => qc.setQueryData(["pantry"], d)).catch(() => {});
    }, 600);
    return () => window.clearTimeout(t);
  }, [items, staples, qc]);

  const list = items ?? [];
  const matches = useQuery({
    queryKey: ["match", list.join("|"), staples],
    queryFn: () => api.matchPantry(list, staples),
    enabled: list.length > 0,
    placeholderData: (prev) => prev,
  });

  const recipes = qc.getQueryData<Awaited<ReturnType<typeof api.recipes>>>(["recipes"]);
  const suggestions = useMemo(() => COMMON_INGREDIENTS, []);

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
    <div className="page">
      <div className="page-head">
        <h1>냉장고</h1>
      </div>
      <p className="page-lead">있는 재료를 넣으면 만들 수 있는 요리를 찾아 드려요.</p>

      <div className="pantry-box">
        {pantry.isPending ? (
          <div className="skeleton" style={{ height: 48 }} />
        ) : (
          <ChipInput values={list} onChange={setItems} suggestions={suggestions} placeholder="재료 이름을 넣고 엔터 (예: 김치, 달걀)" label="냉장고 재료" />
        )}
        <div className="pantry-foot">
          <label className="switch">
            <input type="checkbox" checked={staples} onChange={(e) => setStaples(e.target.checked)} />
            소금, 간장 같은 기본 양념은 있다고 보기
          </label>
          {list.length > 0 && (
            <button type="button" className="link-btn" onClick={() => setItems([])}>
              모두 지우기
            </button>
          )}
        </div>
      </div>

      {list.length > 0 && (
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
            {preview.description && <p className="recipe-desc" style={{ marginTop: 0 }}>{preview.description}</p>}
            <div className="section" style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 18, marginBottom: 8 }}>재료</h3>
              <ul className="ing-list">
                {preview.ingredients.map((ing, i) => (
                  <li className="ing" key={i}>
                    <button type="button" tabIndex={-1} style={{ cursor: "default", minHeight: 44 }}>
                      <span className="ing-name">
                        {ing.name}
                        {ing.note && <span className="ing-note">{ing.note}</span>}
                      </span>
                      <span className="ing-amount">{formatAmount(ing)}</span>
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
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
