// 브라우저와 Worker가 주고받는 데이터 형식

export type Role = "admin" | "friend" | "member";
export type UserStatus = "active" | "limited" | "blocked";
export type QuotaKind = "ai" | "import" | "video" | "upload" | "save";

export interface Limits {
  /** 하루 AI 기능(대체 재료, 맛 조정, 추천, 글 정리) 횟수 */
  ai: number;
  /** 하루 링크 가져오기 횟수 */
  import: number;
  /** 하루 영상 직접 분석 횟수 */
  video: number;
  /** 하루 사진 올리기 횟수 */
  upload: number;
  /** 하루 레시피 저장·수정 횟수 (DB 용량 보호) */
  save: number;
  /** 저장할 수 있는 레시피 수 */
  recipes: number;
  /** 1분에 보낼 수 있는 AI 요청 수 */
  burstPerMin: number;
  /** 분석할 수 있는 영상 최대 길이(분) */
  videoMaxMinutes: number;
}

export interface Policy {
  member: Limits;
  limited: Limits;
  global: {
    /** 하루 전체 AI 호출 예산(무료 한도에 맞춰 설정) */
    aiDaily: number;
    /** 일반 가입자가 함께 쓸 수 있는 몫(0~1). 나머지는 지인 몫으로 남겨 둔다 */
    memberShare: number;
    /** 하루 전체 영상 분석 예산(분) */
    videoMinutes: number;
    memberVideoShare: number;
  };
  abuse: {
    /** 하루에 한도 초과로 거절된 요청이 이만큼 쌓이면 자동으로 '제한' */
    limitAfterDenials: number;
    /** 이만큼 쌓이면 자동 차단 */
    blockAfterDenials: number;
  };
}

export interface PublicUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  statusReason: string | null;
  /** 이메일 인증을 마쳤는지 */
  emailVerified: boolean;
  createdAt: number;
}

export interface MeResponse {
  user: PublicUser;
  /** 지인·관리자는 true */
  unlimited: boolean;
  limits: Limits | null;
  usage: Record<QuotaKind, number>;
  /** 사용량이 초기화되는 시각 */
  resetAt: number;
}

export interface AppConfig {
  appName: string;
  turnstileSiteKey: string;
  instaHelper: boolean;
  aiReady: boolean;
  /** 가입 후 이메일 인증을 받아야 하는지 (메일 발송이 설정됐을 때) */
  emailVerification: boolean;
  /** 비밀번호 찾기 메일을 보낼 수 있는지 */
  passwordReset: boolean;
  /** 메일 보내는 주소(이름 없이 주소만). 스팸함에서 찾기 쉽게 화면에 보여 준다. 메일을 안 보내면 "" */
  mailSender: string;
}

export type ImportStage = "start" | "cache" | "meta" | "description" | "comment" | "video" | "caption" | "page" | "text" | "image" | "save";

export type ImportEvent =
  | { type: "stage"; stage: ImportStage; label: string }
  | { type: "exists"; recipeId: string }
  | { type: "need_caption"; message: string }
  | { type: "done"; recipeId: string; cached: boolean }
  | { type: "error"; code: string; message: string };

export interface ApiErrorBody {
  error: { code: string; message: string; resetAt?: number };
}

export interface SubstituteOption {
  name: string;
  qty: number | null;
  unit: string;
  note: string;
}

export interface SubstituteItem {
  missing: string;
  options: SubstituteOption[];
  canSkip: boolean;
  skipNote: string;
}

export interface SubstituteResult {
  items: SubstituteItem[];
  tip: string;
}

export interface AdminUserRow extends PublicUser {
  lastSeenAt: number | null;
  recipeCount: number;
  today: Partial<Record<QuotaKind | "denied", number>>;
}

export interface AdminOverview {
  users: AdminUserRow[];
  global: Record<string, number>;
  policy: Policy;
  events: { id: number; userId: number | null; userName: string | null; kind: string; detail: string; createdAt: number }[];
  /** 아직 가입하지 않은 이메일에 미리 정해 둔 권한 */
  grants: { email: string; role: Role; createdAt: number }[];
  providers: { mail: "gmail" | "resend" | "mock" | "off"; gemini: boolean; groq: boolean; workersAi: boolean; openrouter: boolean; youtubeApi: boolean; instaHelper: boolean; turnstile: boolean; mock: boolean };
}
