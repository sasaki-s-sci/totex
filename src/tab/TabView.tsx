import { CliView } from "./CliView";
import { FileTab } from "./FileTab";
import type { Tab } from "./tab";

type Props = {
  tab: Tab;
  shown: boolean;
  follow: boolean;
  onEnded: (tab: Tab) => void;
};

export function TabView({ tab, shown, follow, onEnded }: Props) {
  if (tab.kind === "terminal") {
    return (
      <CliView session={tab.session} shown={shown} follow={follow} onEnded={() => onEnded(tab)} />
    );
  }
  return <FileTab tab={tab} />;
}
