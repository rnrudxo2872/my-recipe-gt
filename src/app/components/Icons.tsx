import { FileText, Globe, PenLine, Sparkles } from "lucide-react";
import type { SourceType } from "../../shared/recipe";

export function YouTubeIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className} width="24" height="24">
      <rect x="2" y="5" width="20" height="14" rx="4.5" fill="#FF0033" />
      <path d="M10 9.2v5.6l4.8-2.8z" fill="#fff" />
    </svg>
  );
}

export function InstagramIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className} width="24" height="24">
      <defs>
        <linearGradient id="ig" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#FEC053" />
          <stop offset=".5" stopColor="#F2203E" />
          <stop offset="1" stopColor="#7A1FD1" />
        </linearGradient>
      </defs>
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="url(#ig)" />
      <circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="17.2" cy="6.9" r="1.2" fill="#fff" />
    </svg>
  );
}

export const SOURCE_LABEL: Record<SourceType, string> = {
  youtube: "유튜브",
  instagram: "인스타",
  web: "웹",
  text: "글",
  manual: "직접",
  ai: "AI 추천",
};

export function SourceIcon({ type, className }: { type: SourceType; className?: string }) {
  switch (type) {
    case "youtube":
      return <YouTubeIcon className={className} />;
    case "instagram":
      return <InstagramIcon className={className} />;
    case "web":
      return <Globe className={className} aria-hidden="true" />;
    case "text":
      return <FileText className={className} aria-hidden="true" />;
    case "ai":
      return <Sparkles className={className} aria-hidden="true" />;
    default:
      return <PenLine className={className} aria-hidden="true" />;
  }
}
