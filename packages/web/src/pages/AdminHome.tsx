import { Link } from "react-router-dom";

const ADMIN_TOOLS = [
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
];

export default function AdminHomePage(): JSX.Element {
  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <span>internal tools</span>
        <h1>Admin inspection</h1>
        <p>
          Developer-only surfaces for understanding how captures become WAKA
          signals, context graph state, and generated top-of-mind notes.
        </p>
      </header>

      <section className="admin-tool-grid" aria-label="Admin tools">
        {ADMIN_TOOLS.map((tool) => (
          <Link key={tool.href} to={tool.href} className="admin-tool-card">
            <span>{tool.label}</span>
            <p>{tool.description}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
