import { useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardPaste, FileText, ImagePlus, LoaderCircle, PenLine, Share2, TriangleAlert, Video, Wand } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { ImportStage } from "../../shared/api";
import { detectSource } from "../../shared/links";
import { InstagramIcon, YouTubeIcon } from "../components/Icons";
import { ApiError, api, runImport } from "../lib/api";
import { useDocumentTitle, useUser } from "../lib/hooks";
import { compressImage } from "../lib/image";
import { useToast } from "../lib/toast";

type State =
  | { kind: "idle" }
  | { kind: "running"; startedAt: number }
  | { kind: "need_caption"; message: string }
  | { kind: "exists"; recipeId: string }
  | { kind: "error"; message: string };

function Detected({ text }: { text: string }) {
  const source = useMemo(() => detectSource(text), [text]);
  if (!text.trim()) return null;
  if (!source) {
    return (
      <span className="detected">
        <FileText aria-hidden="true" />글
      </span>
    );
  }
  return (
    <span className="detected">
      {source.type === "youtube" ? <YouTubeIcon /> : source.type === "instagram" ? <InstagramIcon /> : <FileText aria-hidden="true" />}
      {source.type === "youtube" ? "유튜브 영상" : source.type === "instagram" ? "인스타그램" : "웹페이지"}
    </span>
  );
}

export function Add() {
  useDocumentTitle("레시피 추가");
  const [params] = useSearchParams();
  const me = useUser();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [input, setInput] = useState(params.get("link") ?? "");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [stages, setStages] = useState<{ stage: ImportStage; label: string }[]>([]);
  const [caption, setCaption] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const autoStarted = useRef(false);
  const source = useMemo(() => detectSource(input), [input]);

  const canPaste = typeof navigator !== "undefined" && Boolean(navigator.clipboard?.readText);
  const remaining = me.limits ? Math.max(0, me.limits.import - me.usage.import) : null;

  useEffect(() => {
    if (state.kind !== "running") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [state.kind]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function start(opts: { force?: boolean; withCaption?: boolean } = {}) {
    const text = input.trim();
    if (!text) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStages([]);
    setState({ kind: "running", startedAt: Date.now() });
    setNow(Date.now());
    const body = source
      ? { link: text, caption: opts.withCaption ? caption.trim() : undefined, image: photo ?? undefined, force: opts.force }
      : { text, image: photo ?? undefined };
    try {
      await runImport(
        body,
        (e) => {
          if (e.type === "stage") setStages((s) => [...s, { stage: e.stage, label: e.label }]);
          else if (e.type === "done") {
            qc.invalidateQueries({ queryKey: ["recipes"] });
            qc.invalidateQueries({ queryKey: ["me"] });
            toast.show(e.cached ? "이미 정리된 레시피를 바로 가져왔어요." : "레시피를 저장했어요.");
            navigate(`/r/${e.recipeId}`, { replace: true });
          } else if (e.type === "exists") setState({ kind: "exists", recipeId: e.recipeId });
          else if (e.type === "need_caption") {
            qc.invalidateQueries({ queryKey: ["me"] });
            setState({ kind: "need_caption", message: e.message });
          } else if (e.type === "error") {
            qc.invalidateQueries({ queryKey: ["me"] });
            setState({ kind: "error", message: e.message });
          }
        },
        controller.signal,
      );
    } catch (err) {
      setState({ kind: "error", message: err instanceof ApiError ? err.message : "가져오지 못했어요. 다시 시도해 주세요." });
    }
  }

  // 공유하기로 들어왔으면 바로 시작한다.
  useEffect(() => {
    if (params.get("auto") === "1" && input.trim() && !autoStarted.current) {
      autoStarted.current = true;
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setInput(text.trim());
      else toast.show("클립보드가 비어 있어요.");
    } catch {
      toast.show("붙여넣기 권한이 없어요. 입력 칸을 길게 눌러 붙여넣어 주세요.");
    }
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      setPhoto(await api.uploadImage(await compressImage(file)));
    } catch (err) {
      toast.error(err);
    } finally {
      setUploading(false);
    }
  }

  if (state.kind === "running") {
    const elapsed = Math.floor((now - state.startedAt) / 1000);
    const all = [{ stage: "start" as ImportStage, label: "링크를 보내고 있어요" }, ...stages.filter((s) => s.stage !== "start")];
    return (
      <div className="page">
        <div className="progress-card" aria-live="polite">
          <h2>레시피를 정리하고 있어요</h2>
          <p className="help">다른 화면으로 가도 저장은 계속돼요. 끝나면 레시피 목록에 생겨요.</p>
          <ol className="stage-list">
            {all.map((s, i) => {
              const last = i === all.length - 1;
              return (
                <li key={`${s.stage}-${i}`} className={last ? "is-now" : "is-done"}>
                  <span className="stage-icon">{last ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Check aria-hidden="true" />}</span>
                  {s.label}
                </li>
              );
            })}
          </ol>
          <p className="elapsed num">{elapsed}초 지났어요</p>
        </div>
        <button
          type="button"
          className="btn btn-quiet btn-block"
          style={{ marginTop: 12 }}
          onClick={() => {
            abortRef.current?.abort();
            setState({ kind: "idle" });
          }}
        >
          기다리지 않고 돌아가기
        </button>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>레시피 추가</h1>
      </div>

      {state.kind === "exists" && (
        <div className="card" role="alert">
          <h2>이미 저장한 레시피예요</h2>
          <p className="card-sub">같은 링크로 만든 레시피가 있어요.</p>
          <div className="btn-row">
            <Link to={`/r/${state.recipeId}`} className="btn btn-primary">
              저장한 레시피 열기
            </Link>
            <button type="button" className="btn" onClick={() => start({ force: true })}>
              하나 더 저장
            </button>
          </div>
        </div>
      )}

      {state.kind === "error" && (
        <div className="notice is-warn" role="alert" style={{ marginBottom: 16 }}>
          <TriangleAlert aria-hidden="true" />
          <span>{state.message}</span>
        </div>
      )}

      {state.kind === "need_caption" ? (
        <div className="card">
          <h2>내용을 붙여넣어 주세요</h2>
          <p className="card-sub">{state.message}</p>
          <label className="field">
            <span className="label">설명란, 캡션, 고정 댓글 속 레시피</span>
            <textarea
              className="textarea"
              rows={8}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={"예)\n재료: 김치 1컵, 밥 2공기, 스팸 100g\n1. 팬에 스팸을 볶아요\n2. 김치를 넣고..."}
            />
          </label>
          {source?.type !== "youtube" && (
            <div className="field">
              <span className="label">사진 (선택)</span>
              <div className="photo-pick">
                {photo && <img className="mini" src={photo} alt="올린 사진" />}
                <label className="btn btn-soft btn-sm">
                  <ImagePlus aria-hidden="true" />
                  {uploading ? "올리는 중…" : photo ? "사진 바꾸기" : "사진 올리기"}
                  <input type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
                </label>
              </div>
            </div>
          )}
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={caption.trim().length < 20 || uploading} onClick={() => start({ withCaption: true })}>
              <Wand aria-hidden="true" />이 글로 정리하기
            </button>
          </div>
          <button type="button" className="btn btn-quiet btn-block" style={{ marginTop: 8 }} onClick={() => setState({ kind: "idle" })}>
            다른 링크 넣기
          </button>
        </div>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            <div className="paste-box">
              <label htmlFor="link" className="sr-only">
                링크나 레시피 글
              </label>
              <textarea
                id="link"
                className="textarea"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (state.kind !== "idle") setState({ kind: "idle" });
                }}
                placeholder="유튜브·인스타 링크나 레시피 글을 붙여넣으세요"
                rows={3}
                autoFocus={!input}
              />
              {canPaste && (
                <button type="button" className="btn btn-soft btn-sm paste-btn" onClick={paste}>
                  <ClipboardPaste aria-hidden="true" />
                  붙여넣기
                </button>
              )}
              <Detected text={input} />
            </div>
            <div className="add-actions">
              <button type="submit" className="btn btn-primary btn-block" disabled={!input.trim() || (remaining !== null && remaining <= 0)}>
                <Wand aria-hidden="true" />
                레시피 만들기
              </button>
              {remaining !== null && (
                <p className="usage-hint">{remaining > 0 ? `오늘 링크 가져오기 ${remaining}번 남았어요` : "오늘 링크 가져오기를 다 썼어요. 자정에 다시 채워져요."}</p>
              )}
            </div>
          </form>

          <div className="or">또는</div>
          <div className="alt-actions">
            <Link to="/new" className="btn">
              <PenLine aria-hidden="true" />
              직접 작성하기
            </Link>
          </div>

          <ul className="how-list">
            <li>
              <Video aria-hidden="true" />
              유튜브는 설명란부터 확인하고, 레시피가 없으면 영상을 직접 보고 정리해요.
            </li>
            <li>
              <InstagramIcon />
              인스타그램은 캡션에서 레시피를 찾아요. 못 가져오면 캡션을 붙여넣으면 돼요.
            </li>
            <li>
              <Share2 aria-hidden="true" />
              휴대폰에서 앱을 설치하면 유튜브·인스타 앱의 공유하기에서 바로 보낼 수 있어요.
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
