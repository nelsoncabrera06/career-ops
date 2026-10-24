import { Suspense } from "react";
import { pipelineSummary, careerOpsRoot } from "@/lib/career-ops";
import { readAllNotes } from "@/lib/job-notes.mjs";
import { PipelineView } from "@/components/pipeline-view";

export const dynamic = "force-dynamic"; // always read fresh local files

export default function PipelinePage() {
  const { inbox, applications, companyGroups } = pipelineSummary();
  // Which rows carry a personal note (data/job-notes.json). Read here, on the
  // server, so the client component stays a pure renderer and the list view
  // never fetches per row.
  const notedIds = Object.keys(readAllNotes(careerOpsRoot()));
  return (
    <Suspense>
      <PipelineView
        applications={applications}
        inbox={inbox}
        companyGroups={companyGroups}
        notedIds={notedIds}
      />
    </Suspense>
  );
}
