import { ArrowDown, NotebookPen, Refrigerator, Repeat2, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { YouTubeIcon } from "../components/Icons";
import { useDocumentTitle } from "../lib/hooks";

const FEATURES = [
  {
    icon: Sparkles,
    title: "링크로 레시피 정리",
    body: "유튜브나 인스타 링크를 붙여넣으면 사진 아래에 재료와 순서를 정리해 둬요. 설명란에 없으면 영상을 직접 보고 정리해요.",
  },
  {
    icon: Repeat2,
    title: "없는 재료는 대신할 것으로",
    body: "집에 없는 재료를 누르면 대신 쓸 재료와 양을 알려 줘요. 고른 대로 레시피에 바로 반영돼요.",
  },
  {
    icon: Refrigerator,
    title: "냉장고 재료로 찾기",
    body: "남은 재료를 넣으면 저장한 레시피 중 바로 만들 수 있는 것부터 보여 주고, 새 요리도 추천해 줘요.",
  },
  {
    icon: NotebookPen,
    title: "내 입맛 버전 저장",
    body: "원본은 그대로 두고 덜 맵게, 더 간단하게 고친 내 버전을 따로 저장해요. 언제든 원본으로 되돌릴 수 있어요.",
  },
];

export function Landing() {
  useDocumentTitle(undefined);
  return (
    <div className="landing">
      <header className="landing-top">
        <span className="brand">
          <img src="/icons/logo-96.png" alt="" />
          <span>레시퐁</span>
        </span>
        <Link to="/login" className="btn btn-quiet btn-sm">
          로그인
        </Link>
      </header>

      <section className="landing-hero">
        <div>
          <h1>
            링크만 붙여넣으면
            <br />
            레시피 카드 완성
          </h1>
          <p className="landing-lead">요리 영상을 보고 받아 적지 마세요. 사진 한 장 아래 재료와 순서를 정리해 두고, 내 입맛대로 고쳐 쓰면 돼요.</p>
          <div className="landing-cta">
            <Link to="/signup" className="btn btn-primary">
              시작하기
            </Link>
            <Link to="/login" className="btn">
              로그인
            </Link>
          </div>
        </div>

        <div className="demo" aria-hidden="true">
          <div className="demo-link">
            <YouTubeIcon />
            youtube.com/shorts/김치볶음밥
          </div>
          <div className="demo-arrow">
            <ArrowDown />
          </div>
          <div className="demo-card">
            <div className="demo-photo">
              <img src="/icons/logo-96.png" alt="" />
            </div>
            <div className="demo-body">
              <h3>스팸 김치볶음밥</h3>
              <div className="demo-ings">
                <span>신김치 1컵</span>
                <span>밥 2공기</span>
                <span className="is-missing">스팸 100g</span>
                <span>대파 ½대</span>
                <span>달걀 2개</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="features" aria-label="할 수 있는 일">
        {FEATURES.map((f) => (
          <div className="feature" key={f.title}>
            <div className="feature-icon">
              <f.icon aria-hidden="true" />
            </div>
            <div>
              <h2>{f.title}</h2>
              <p>{f.body}</p>
            </div>
          </div>
        ))}
      </section>

      <p className="landing-foot">누구나 가입할 수 있어요. 일반 계정은 하루 사용량이 정해져 있어요.</p>
    </div>
  );
}
