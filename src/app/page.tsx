import { AppShell } from "@/components/app-shell";
import { AskWorkspace } from "@/components/ask-workspace";

export default function Home() {
  return (
    <AppShell>
      <AskWorkspace />
    </AppShell>
  );
}
