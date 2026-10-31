import { Navigate, useSearchParams } from "react-router";
import { findUrl } from "../../shared/links";

/** 휴대폰 '공유하기'로 들어온 링크를 레시피 추가 화면으로 넘긴다. */
export function Share() {
  const [params] = useSearchParams();
  const joined = [params.get("url"), params.get("text"), params.get("title")].filter(Boolean).join(" ");
  const link = findUrl(joined);
  if (link) return <Navigate to={`/add?link=${encodeURIComponent(link)}&auto=1`} replace />;
  return <Navigate to={joined ? `/add?link=${encodeURIComponent(joined)}` : "/add"} replace />;
}
