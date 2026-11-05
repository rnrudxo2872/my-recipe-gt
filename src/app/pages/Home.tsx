import { Clock, Heart, Link2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CATEGORIES, OTHER_CATEGORY_LABEL, type Category, type RecipeSummary, type SourceType } from "../../shared/recipe";
import { SOURCE_LABEL, SourceIcon } from "../components/Icons";
import { RecipeImage } from "../components/RecipeImage";
import { useDocumentTitle, useRecipes } from "../lib/hooks";

// 주소(?filter=)에 쓰는 이름
const CATEGORY_KEY: Record<Category, string> = { 한식: "korean", 중식: "chinese", 양식: "western", 일식: "japanese", 브런치: "brunch", 디저트: "dessert" };

// 요리 종류로 나눠 본다. 한 레시피가 여러 종류면 그 칸마다 보이고, 아무 종류도 없으면 '기타'에 모인다.
const FILTERS: { key: string; label: string; match: (r: RecipeSummary) => boolean }[] = [
  { key: "all", label: "전체", match: () => true },
  { key: "fav", label: "즐겨찾기", match: (r) => r.favorite },
  ...CATEGORIES.map((c) => ({ key: CATEGORY_KEY[c], label: c, match: (r: RecipeSummary) => r.categories.includes(c) })),
  { key: "etc", label: OTHER_CATEGORY_LABEL, match: (r) => r.categories.length === 0 },
];

export function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  return (
    <Link to={`/r/${recipe.id}`} className="recipe-card">
      <div className="thumb">
        <RecipeImage src={recipe.image} title={recipe.title} />
        <span className="thumb-source">
          <SourceIcon type={recipe.sourceType as SourceType} />
          {SOURCE_LABEL[recipe.sourceType]}
        </span>
        {recipe.favorite && (
          <span className="thumb-fav" aria-label="즐겨찾기">
            <Heart />
          </span>
        )}
      </div>
      <h3>{recipe.title}</h3>
      {(recipe.timeMinutes || recipe.servings) && (
        <div className="card-meta">
          {recipe.timeMinutes && (
            <span>
              <Clock aria-hidden="true" />
              {recipe.timeMinutes}분
            </span>
          )}
          {recipe.servings && <span>{recipe.servings}인분</span>}
        </div>
      )}
    </Link>
  );
}

export function Home() {
  useDocumentTitle(undefined);
  const { data, isPending, isError, refetch } = useRecipes();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const filterKey = params.get("filter") ?? "all";
  const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];

  // 저장한 레시피에 있는 요리 종류만 필터로 보여 준다.
  const visibleFilters = useMemo(() => FILTERS.filter((f) => f.key === "all" || f.key === filterKey || data?.some(f.match)), [data, filterKey]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((r) => filter.match(r) && (!q || r.title.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q))));
  }, [data, filter, query]);

  return (
    <div className="page is-wide">
      <div className="home-head">
        <h1 className="sr-only">내 레시피</h1>
        <span className="brand">
          <img src="/icons/logo-96.png" alt="" />
          <span>레시퐁</span>
        </span>
      </div>

      {isPending ? (
        <div className="recipe-grid" aria-busy="true" aria-label="레시피 불러오는 중">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>
              <div className="skeleton" style={{ aspectRatio: "4/3", borderRadius: 20 }} />
              <div className="skeleton" style={{ height: 18, marginTop: 10, width: "70%" }} />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="empty">
          <h2>레시피를 불러오지 못했어요</h2>
          <p>인터넷 연결을 확인해 주세요.</p>
          <button type="button" className="btn" onClick={() => refetch()}>
            다시 불러오기
          </button>
        </div>
      ) : data.length === 0 ? (
        <div className="empty">
          <img src="/icons/logo-96.png" alt="" />
          <h2>아직 저장한 레시피가 없어요</h2>
          <p>유튜브나 인스타 링크를 붙여넣으면 사진과 재료, 순서를 한 장으로 정리해 드려요.</p>
          <Link to="/add" className="btn btn-primary">
            <Link2 aria-hidden="true" />
            링크로 첫 레시피 만들기
          </Link>
          <Link to="/new" className="link-btn" style={{ marginTop: 8 }}>
            직접 적어서 만들기
          </Link>
        </div>
      ) : (
        <>
          <div className="home-tools">
            <label className="search">
              <Search aria-hidden="true" />
              <span className="sr-only">레시피 찾기</span>
              <input className="input" type="search" placeholder="요리 이름이나 태그로 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            {visibleFilters.length > 1 && (
              <div className="chips is-scroll" role="group" aria-label="요리 종류">
                {visibleFilters.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className="chip"
                    aria-pressed={f.key === filter.key}
                    onClick={() => setParams(f.key === "all" ? {} : { filter: f.key }, { replace: true })}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {list.length === 0 ? (
            <div className="empty">
              <h2>{query ? `'${query}'에 맞는 레시피가 없어요` : `${filter.label} 레시피가 없어요`}</h2>
              <p>{filter.key === "fav" ? "레시피 화면에서 하트를 누르면 여기에 모여요." : "다른 이름으로 찾아보세요."}</p>
            </div>
          ) : (
            <div className="recipe-grid">
              {list.map((r) => (
                <RecipeCard key={r.id} recipe={r} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
