import { BookOpen, Heart, Plus, Refrigerator, Shield, User } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router";
import { useUser } from "../lib/hooks";

export function TabBar() {
  const { pathname, search } = useLocation();
  const favOn = pathname === "/" && new URLSearchParams(search).get("filter") === "fav";
  return (
    <nav className="tabbar" aria-label="주요 메뉴">
      <Link to="/" className={`tab ${pathname === "/" && !favOn ? "active" : ""}`} aria-current={pathname === "/" && !favOn ? "page" : undefined}>
        <BookOpen aria-hidden="true" />
        레시피
      </Link>
      <NavLink to="/fridge" className="tab">
        <Refrigerator aria-hidden="true" />
        냉장고
      </NavLink>
      <Link to="/add" className="tab-add" aria-label="레시피 추가">
        <Plus aria-hidden="true" />
      </Link>
      <Link to="/?filter=fav" className={`tab ${favOn ? "active" : ""}`} aria-current={favOn ? "page" : undefined}>
        <Heart aria-hidden="true" />
        즐겨찾기
      </Link>
      <NavLink to="/me" className="tab">
        <User aria-hidden="true" />내 정보
      </NavLink>
    </nav>
  );
}

export function Sidebar() {
  const me = useUser();
  const { pathname, search } = useLocation();
  const favOn = pathname === "/" && new URLSearchParams(search).get("filter") === "fav";
  return (
    <aside className="sidebar" aria-label="주요 메뉴">
      <Link to="/" className="brand">
        <img src="/icons/logo-96.png" alt="" />
        <span>레시피GT</span>
      </Link>
      <Link to="/add" className="btn btn-primary">
        <Plus aria-hidden="true" />
        레시피 추가
      </Link>
      <Link to="/" className={`side-link ${pathname === "/" && !favOn ? "active" : ""}`}>
        <BookOpen aria-hidden="true" />
        레시피
      </Link>
      <Link to="/?filter=fav" className={`side-link ${favOn ? "active" : ""}`}>
        <Heart aria-hidden="true" />
        즐겨찾기
      </Link>
      <NavLink to="/fridge" className="side-link">
        <Refrigerator aria-hidden="true" />
        냉장고
      </NavLink>
      <NavLink to="/me" className="side-link">
        <User aria-hidden="true" />내 정보
      </NavLink>
      {me.user.role === "admin" && (
        <NavLink to="/admin" className="side-link">
          <Shield aria-hidden="true" />
          관리
        </NavLink>
      )}
    </aside>
  );
}
