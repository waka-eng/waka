import { AuthenticatedAppPageOutlet } from "../../../src/shell/authenticated-app-page-outlet.tsx";
import { WorkspaceHomeScreen } from "../../../src/home/workspace-home-screen.tsx";

export default function DashboardPage() {
  return (
    <AuthenticatedAppPageOutlet>
      <WorkspaceHomeScreen />
    </AuthenticatedAppPageOutlet>
  );
}
