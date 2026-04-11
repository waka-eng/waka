import { WorkspaceCaptureBar } from "../../src/home/workspace-capture-bar.tsx";
import { WorkspaceHomeShellProvider } from "../../src/home/workspace-home-shell-context.tsx";
import { AuthenticatedAppNavigation } from "../../src/shell/authenticated-app-navigation.tsx";
import { AuthenticatedAppShellProvider } from "../../src/shell/authenticated-app-shell-context.tsx";

type AuthenticatedAppLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function AuthenticatedAppLayout({
  children,
}: AuthenticatedAppLayoutProps) {
  return (
    <AuthenticatedAppShellProvider>
      <WorkspaceHomeShellProvider>
        <div
          data-layout="authenticated-app-shell"
          className="min-h-screen w-full max-w-full overflow-x-hidden bg-[linear-gradient(180deg,_#faf7f1_0%,_#f3ecdf_100%)] text-stone-900"
        >
          <div className="waka-shell-container waka-authenticated-shell-container">
            <div className="waka-authenticated-shell-body">
              <AuthenticatedAppNavigation />
              <WorkspaceCaptureBar />
              <main
                data-layout="authenticated-app-content"
                className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col"
              >
                {children}
              </main>
            </div>
          </div>
        </div>
      </WorkspaceHomeShellProvider>
    </AuthenticatedAppShellProvider>
  );
}
