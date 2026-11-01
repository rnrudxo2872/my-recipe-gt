import { ArrowDown, ChevronRight, Clock, NotebookPen, Refrigerator, Repeat2, Sparkles, Users, X } from "lucide-react";
import { Link } from "react-router";
import { YouTubeIcon } from "../components/Icons";
import { useDocumentTitle } from "../lib/hooks";

const FEATURES = [
  {
    icon: Sparkles,
    tone: "coral",
    title: "링크로 레시피 정리",
    body: "유튜브나 인스타 링크를 붙여넣으면 사진 아래에 재료와 순서를 정리해 둬요. 설명란에 없으면 영상을 직접 보고 정리해요.",
  },
  {
    icon: Repeat2,
    tone: "pink",
    title: "없는 재료는 대신할 것으로",
    body: "집에 없는 재료를 누르면 대신 쓸 재료와 양을 알려 줘요. 고른 대로 레시피에 바로 반영돼요.",
  },
  {
    icon: Refrigerator,
    tone: "blue",
    title: "냉장고 재료로 찾기",
    body: "남은 재료를 넣으면 저장한 레시피 중 바로 만들 수 있는 것부터 보여 주고, 새 요리도 추천해 줘요.",
  },
  {
    icon: NotebookPen,
    tone: "green",
    title: "내 입맛 버전 저장",
    body: "원본은 그대로 두고 덜 맵게, 더 간단하게 고친 내 버전을 따로 저장해요. 언제든 원본으로 되돌릴 수 있어요.",
  },
];

export function Landing() {
  useDocumentTitle(undefined);
  return (
    <div className="landing">
      <header className="landing-top">
        <div className="landing-wrap landing-top-inner">
          <span className="brand">
            <img src="/icons/logo-96.png" alt="" />
            <span>레시퐁</span>
          </span>
          <Link to="/login" className="btn btn-quiet btn-sm">
            로그인
          </Link>
        </div>
      </header>

      <section className="landing-wrap landing-hero">
        <div className="landing-copy">
          <h1>
            링크만 붙여넣으면
            <br />
            레시피 카드 완성
          </h1>
          <p className="landing-lead">요리 영상을 보고 받아 적지 마세요. 사진 한 장 아래 재료와 순서를 정리해 두고, 내 입맛대로 고쳐 쓰면 돼요.</p>
          <div className="landing-cta">
            <Link to="/signup" className="btn btn-primary btn-lg">
              시작하기
            </Link>
            <Link to="/login" className="btn btn-lg">
              로그인
            </Link>
          </div>
        </div>

        {/* 링크가 레시피 카드로 바뀌는 장면 */}
        <div className="demo" aria-hidden="true">
          <div className="demo-link">
            <span className="demo-link-icon">
              <YouTubeIcon />
            </span>
            <span className="demo-link-text">
              <small>유튜브 링크 정리 중…</small>
              <b>youtube.com/shorts/김치볶음밥</b>
            </span>
            <span className="demo-spin" />
          </div>
          <div className="demo-arrow">
            <ArrowDown />
          </div>
          <div className="demo-card">
            <div className="demo-photo">
              <span className="demo-photo-mark">
                <img src="/icons/logo-96.png" alt="" />
              </span>
              <span className="demo-badge">
                <i />
                정리 완료
              </span>
            </div>
            <div className="demo-body">
              <h3>스팸 김치볶음밥</h3>
              <div className="demo-ings">
                <span className="chip">신김치 1컵</span>
                <span className="chip">밥 2공기</span>
                <span className="chip is-missing">
                  스팸 100g
                  <X />
                </span>
                <span className="chip">대파 ½대</span>
                <span className="chip">달걀 2개</span>
              </div>
              <div className="demo-foot">
                <span className="card-meta">
                  <span>
                    <Clock /> 15분
                  </span>
                  <span>
                    <Users /> 2인분
                  </span>
                </span>
                <span className="demo-more">
                  레시피 보기
                  <ChevronRight />
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-features" aria-label="할 수 있는 일">
        <div className="landing-wrap features">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <div className={`feature-icon tone-${f.tone}`}>
                <f.icon aria-hidden="true" />
              </div>
              <div>
                <h2>{f.title}</h2>
                <p>{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-wrap landing-final">
        <h2>지금 바로 레시피를 정리해 보세요</h2>
        <Link to="/signup" className="btn btn-primary btn-xl">
          레시퐁 시작하기
        </Link>
      </section>

      <footer className="landing-footer">
        <div className="landing-wrap landing-footer-inner">
          <span className="landing-footer-brand">레시퐁</span>
          <span>누구나 가입할 수 있어요. 일반 계정은 하루 사용량이 정해져 있어요.</span>
        </div>
      </footer>
    </div>
  );
}
