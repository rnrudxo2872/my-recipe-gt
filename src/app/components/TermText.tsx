import { Fragment, useEffect, useMemo, useState } from "react";
import { splitTerms, youtubeSearchUrl, type CookingTerm } from "../../shared/glossary";
import { YouTubeIcon } from "./Icons";
import { Sheet } from "./Sheet";

const EVENT = "recipong:term";

/** 레시피 글. '송송 썬', '투명해질 때까지' 같은 요리 용어는 눌러서 뜻을 볼 수 있다. */
export function TermText({ text }: { text: string }) {
  const parts = useMemo(() => splitTerms(text), [text]);
  return (
    <>
      {parts.map((p, i) =>
        p.term ? (
          <button
            key={i}
            type="button"
            className="term"
            aria-haspopup="dialog"
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(new CustomEvent<CookingTerm>(EVENT, { detail: p.term }));
            }}
          >
            {p.text}
          </button>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

/** 용어 풀이 창. 앱에 하나만 둔다. */
export function TermSheetHost() {
  const [term, setTerm] = useState<CookingTerm | null>(null);
  useEffect(() => {
    const on = (e: Event) => setTerm((e as CustomEvent<CookingTerm>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return (
    <Sheet
      open={term != null}
      onClose={() => setTerm(null)}
      title={term?.term ?? ""}
      footer={
        term && (
          <a className="btn btn-block" href={youtubeSearchUrl(term.search)} target="_blank" rel="noreferrer noopener">
            <YouTubeIcon />
            영상으로 보기
          </a>
        )
      }
    >
      {term && (
        <>
          <p className="term-explain">{term.explain}</p>
          <p className="help">유튜브에서 '{term.search}' 검색 결과를 열어요.</p>
        </>
      )}
    </Sheet>
  );
}
