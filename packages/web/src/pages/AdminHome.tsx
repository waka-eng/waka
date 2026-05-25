import { Link } from "react-router-dom";

const ADMIN_TOOLS = [
  {
    href: "/admin/meaning-graph",
    label: "Meaning graph",
    description:
      "Inspect promoted meaning nodes, packet-backed evidence, and relationship edges.",
  },
  {
    href: "/admin/wow-status",
    label: "WOW pipeline status",
    description:
      "Review classifier, embedding, background job, and generated WOW moment diagnostics.",
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
          signals, meaning graph state, and generated moments.
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
