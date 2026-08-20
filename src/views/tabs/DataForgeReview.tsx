import type { DataForgeSummary, DocumentRow } from '../../domain/data_forge/model.ts';
import type { BenchmarkRunSummary } from '../../domain/runs/model.ts';
import type { BenchmarkRunProgress } from '../../domain/progress/model.ts';
import { reviewComplete } from '../../domain/progress/model.ts';
import { Cap } from '../ui/Cap.tsx';
import { FocusedReviewInbox } from '../ui/FocusedReviewInbox.tsx';
import { TableBox } from '../ui/TableBox.tsx';
import { Tally } from '../ui/Tally.tsx';
import { Handoff } from '../layout/Handoff.tsx';
import { RunContext } from '../layout/RunContext.tsx';

export function DataForgeReview({
  benchmarkRun,
  progress,
  availableRuns,
  dataForge,
  documents,
}: {
  benchmarkRun: BenchmarkRunSummary | null;
  progress: BenchmarkRunProgress | null;
  availableRuns: BenchmarkRunSummary[];
  dataForge: DataForgeSummary | null;
  documents: DocumentRow[];
}) {
  const approved = documents.filter((document) => document.noveltyStatus === 'passed' && document.reviewStatus === 'approved').length;
  const blocked = documents.filter((document) => document.noveltyStatus === 'rejected' || document.reviewStatus === 'rejected').length;
  const complete = reviewComplete(progress);

  return (
    <>
      <div class="m-title">
        <h2>Review training documents</h2>
        <p>Read each novel artifact and make the human approval decision before it can become an environment taskset.</p>
      </div>
      <RunContext
        benchmarkRun={benchmarkRun}
        availableRuns={availableRuns}
        failureTopics={progress?.topicCount}
      />

      <TableBox>
        <Cap title="Review gate" code={complete ? 'READY FOR ENV LAB' : 'HUMAN REVIEW REQUIRED'}>
          <Tally items={[
            { value: dataForge?.requestedDocuments ?? 0, label: 'requested' },
            { value: dataForge?.novelDocuments ?? 0, label: 'novel', hot: true },
            { value: approved, label: 'approved' },
            { value: dataForge?.pendingReview ?? 0, label: 'needs review' },
            { value: blocked, label: 'blocked' },
          ]} />
        </Cap>
        <p class="m-forge-review-note">
          {complete
            ? 'Every requested slot is novel and approved. Env Lab can now build the local packages.'
            : dataForge
            ? 'Novelty failures are permanently ineligible. Every remaining novel document needs an approval decision before Env Lab unlocks.'
            : 'Start a Data Forge run to create the documents that will appear in this queue.'}
        </p>
      </TableBox>

      <FocusedReviewInbox
        benchmarkRunId={benchmarkRun?.benchmarkRunId ?? null}
        dataForge={dataForge}
        documents={documents}
      />

      <Handoff stage="forge-review" benchmarkRun={benchmarkRun} progress={progress} />
    </>
  );
}
