import { Link } from "react-router-dom";

import { useAuth } from "../lib/auth-context";
import { normalizeSupportedLocale, readStoredLocale, type SupportedLocale } from "../lib/locales";

type AdminToolCopy = {
  href: string;
  label: string;
  description: string;
};

type AdminHomeCopy = {
  eyebrow: string;
  title: string;
  intro: string;
  toolsAriaLabel: string;
  tools: AdminToolCopy[];
};

export const ADMIN_HOME_COPY: Record<SupportedLocale, AdminHomeCopy> = {
  "en-US": {
    eyebrow: "internal tools",
    title: "Admin inspection",
    intro:
      "Developer-only surfaces for understanding how captures become WAKA signals, context graph state, and generated top-of-mind notes.",
    toolsAriaLabel: "Admin tools",
    tools: [
      {
        href: "/admin/meaning-graph",
        label: "Context graph",
        description:
          "Inspect promoted context nodes, packet-backed evidence, and relationship edges.",
      },
      {
        href: "/admin/wow-status",
        label: "Top-of-mind pipeline status",
        description:
          "Review classifier, embedding, background job, and generated note diagnostics.",
      },
    ],
  },
  "ko-KR": {
    eyebrow: "관리자 도구",
    title: "관리자 점검",
    intro:
      "저장한 신호가 맥락 그래프 상태와 생성된 마음속 노트로 이어지는 흐름을 살펴보는 내부 전용 화면입니다.",
    toolsAriaLabel: "관리자 도구",
    tools: [
      {
        href: "/admin/meaning-graph",
        label: "맥락 그래프",
        description: "승격된 맥락 노드, 패킷 기반 근거, 관계 연결을 점검합니다.",
      },
      {
        href: "/admin/wow-status",
        label: "마음속 노트 처리 상태",
        description: "분류기, 임베딩, 백그라운드 작업, 생성된 노트 진단을 확인합니다.",
      },
    ],
  },
};

export default function AdminHomePage(): JSX.Element {
  const { user } = useAuth();
  const locale = normalizeSupportedLocale(user?.preferredLocale ?? readStoredLocale());
  const copy = ADMIN_HOME_COPY[locale];

  return (
    <main className="admin-page" data-locale={locale}>
      <header className="admin-page-header">
        <span>{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{copy.intro}</p>
      </header>

      <section className="admin-tool-grid" aria-label={copy.toolsAriaLabel}>
        {copy.tools.map((tool) => (
          <Link key={tool.href} to={tool.href} className="admin-tool-card">
            <span>{tool.label}</span>
            <p>{tool.description}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
