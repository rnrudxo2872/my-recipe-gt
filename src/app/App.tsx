import { RotateCcw, WifiOff } from "lucide-react";
import { Navigate, Outlet, Route, Routes, useLocation, useMatch } from "react-router";
import { Sidebar, TabBar } from "./components/Nav";
import { useConfig, useMe, useOnline } from "./lib/hooks";
import { Add } from "./pages/Add";
import { Admin } from "./pages/Admin";
import { Cook } from "./pages/Cook";
import { Edit } from "./pages/Edit";
import { Forgot, Reset } from "./pages/Forgot";
import { Fridge } from "./pages/Fridge";
import { Home } from "./pages/Home";
import { Landing } from "./pages/Landing";
import { Login, Signup } from "./pages/Auth";
import { Me } from "./pages/Me";
import { NotFound } from "./pages/NotFound";
import { Plan } from "./pages/Plan";
import { RecipePage } from "./pages/Recipe";
import { Share } from "./pages/Share";
import { VerifyPending, VerifyToken } from "./pages/Verify";

export function Splash() {
  return (
    <div className="splash" aria-busy="true" aria-label="불러오는 중">
      <img src="/icons/logo-96.png" alt="" />
    </div>
  );
}

function Shell() {
  const online = useOnline();
  const editMatch = useMatch("/r/:id/edit");
  const newMatch = useMatch("/new");
  const editing = Boolean(editMatch || newMatch);
  return (
    <div className="app">
      {!online && (
        <div className="offline-bar" role="status">
          <WifiOff size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} aria-hidden="true" />
          인터넷 연결이 끊겼어요. 저장한 화면만 볼 수 있어요.
        </div>
      )}
      <Sidebar />
      <main className="main">
        <Outlet />
      </main>
      {!editing && <TabBar />}
    </div>
  );
}

function LoginRedirect() {
  const location = useLocation();
  const next = location.pathname + location.search;
  return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
}

export function App() {
  const me = useMe();
  const config = useConfig();

  if (me.isPending || config.isPending) return <Splash />;
  if (me.isError) {
    return (
      <div className="empty" style={{ minHeight: "100dvh", justifyContent: "center" }}>
        <img src="/icons/logo-96.png" alt="" />
        <h2>서버에 연결하지 못했어요</h2>
        <p>인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>
        <button type="button" className="btn btn-primary" onClick={() => me.refetch()}>
          <RotateCcw aria-hidden="true" />
          다시 시도
        </button>
      </div>
    );
  }

  if (!me.data) {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/verify" element={<VerifyToken />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/reset" element={<Reset />} />
        <Route path="*" element={<LoginRedirect />} />
      </Routes>
    );
  }

  // 이메일 인증 전에는 인증 화면만 보인다.
  if (!me.data.user.emailVerified && config.data?.emailVerification) {
    return (
      <Routes>
        <Route path="/verify" element={<VerifyToken />} />
        <Route path="/reset" element={<Reset />} />
        <Route path="*" element={<VerifyPending />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/r/:id/cook" element={<Cook />} />
      <Route path="/verify" element={<VerifyToken />} />
      <Route path="/reset" element={<Reset />} />
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="add" element={<Add />} />
        <Route path="share" element={<Share />} />
        <Route path="new" element={<Edit />} />
        <Route path="r/:id" element={<RecipePage />} />
        <Route path="r/:id/edit" element={<Edit />} />
        <Route path="fridge" element={<Fridge />} />
        <Route path="plan" element={<Plan />} />
        <Route path="me" element={<Me />} />
        <Route path="admin" element={me.data.user.role === "admin" ? <Admin /> : <Navigate to="/" replace />} />
        <Route path="login" element={<AfterLogin />} />
        <Route path="signup" element={<AfterLogin />} />
        <Route path="forgot" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

/** 로그인 직후: 원래 가려던 곳(next)으로 보낸다. 외부 주소는 받지 않는다. */
function AfterLogin() {
  const next = new URLSearchParams(useLocation().search).get("next");
  const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return <Navigate to={safe} replace />;
}
