/** The on-demand settings page in the node shape React Flow expects. */

import type { NodeProps } from "@xyflow/react";
import type { SettingsFlowNode } from "../../lib/graph";
import { settingsPart } from "../../parts";

export function SettingsNodePart(props: NodeProps<SettingsFlowNode>) {
  const SettingsNode = settingsPart.use();
  return SettingsNode ? <SettingsNode {...props} /> : null;
}
