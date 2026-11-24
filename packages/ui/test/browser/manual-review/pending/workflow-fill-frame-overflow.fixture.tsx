import { createRoot } from "react-dom/client";
import type { WorkflowRunState } from "@zcode/shared/zcode-protocol-v4";
import { WorkflowRunPhaseList } from "@/app-shell/WorkflowRunPhaseList.js";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import { buildWorkflowTimeline } from "@/components/workflow-timeline/timeline-model.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import "@/styles.css";

const hole = "hole#a0000001";
const graph: WorkflowCausalityGraphData = {
  steps: [],
  lanes: [],
  participants: [],
  handoffs: [],
  phases: [
    { id: hole, name: "Fill" },
    { id: `${hole}/phase#1`, name: "First section", fill: hole },
    { id: `${hole}/phase#2`, name: "Last section", fill: hole },
  ],
};
const run: WorkflowRunState = {
  runId: "dwfrun-1",
  toolCallId: "tool-wf-1",
  status: "running",
  usage: { spentTokens: 0, nodesUsed: 0 },
  actors: [],
  nodes: [],
  lastEventSequence: 0,
  holes: [{ siteId: hole, ordinal: 1, name: "Fill", state: "filled", filledAt: 1 }],
};

createRoot(document.getElementById("root")!).render(
  <ZCodeIntlProvider initialLocale="en-US">
    <div id="pane" className="flex flex-col" style={{ width: 548, height: 120 }}>
      <WorkflowRunPhaseList
        graph={graph}
        model={buildWorkflowTimeline(graph, run)}
        pendingQuestions={[]}
        run={run}
      />
    </div>
  </ZCodeIntlProvider>,
);
