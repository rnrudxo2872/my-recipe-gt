import { useEffect, useState } from "react";

/** 레시피 사진. 사진이 없거나 깨지면 요리 이름 첫 글자로 채운 그림을 보여 준다. */
export function RecipeImage({ src, title, eager }: { src: string | null; title: string; eager?: boolean }) {
  const [current, setCurrent] = useState(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCurrent(src);
    setFailed(false);
  }, [src]);

  if (!current || failed) {
    return (
      <div className="thumb-placeholder" aria-hidden="true">
        {title.trim().charAt(0) || "?"}
      </div>
    );
  }
  return (
    <img
      src={current}
      alt=""
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => {
        // 유튜브 고화질 썸네일이 없는 영상은 기본 썸네일로
        const yt = current.match(/^https:\/\/i\.ytimg\.com\/vi\/([^/]+)\/(maxresdefault|hq720)\.jpg$/);
        if (yt) setCurrent(`https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg`);
        else setFailed(true);
      }}
    />
  );
}
