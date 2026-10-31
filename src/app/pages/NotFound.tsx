import { Link } from "react-router";
import { useDocumentTitle } from "../lib/hooks";

export function NotFound() {
  useDocumentTitle("없는 페이지");
  return (
    <div className="page">
      <div className="empty">
        <img src="/icons/logo-96.png" alt="" />
        <h2>없는 페이지예요</h2>
        <p>주소가 바뀌었거나 지워진 레시피일 수 있어요.</p>
        <Link to="/" className="btn btn-primary">
          내 레시피로 가기
        </Link>
      </div>
    </div>
  );
}
