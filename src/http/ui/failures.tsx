import { Elysia } from 'elysia';
import * as failureMaps from '../../domain/failure_maps/service.ts';
import * as jobs from '../../domain/jobs/service.ts';
import * as progress from '../../domain/progress/service.ts';
import { Badge } from '../../views/ui/Badge.tsx';
import { FailureAnalysisStatus } from '../../views/tabs/Failures.tsx';
import { benchmarkRunIdOf, errorMessage } from '../request.ts';

function errorStatus(text: string) {
  return <div id="failure-analysis-status" class="m-analysis-status"><Badge state="failed">unable to start</Badge><span>{text}</span></div>;
}

export const failuresUi = new Elysia({ name: 'failures-ui' })
  .post('/ui/failures/map', async ({ body }) => {
    const benchmarkRunId = benchmarkRunIdOf(body);
    try {
      const started = await failureMaps.start({ benchmarkRunId });
      const job = await jobs.get(started.jobId);
      return <FailureAnalysisStatus runId={benchmarkRunId} job={job} progress={await progress.byBenchmarkRun(benchmarkRunId)} />;
    } catch (error) {
      return errorStatus(errorMessage(error));
    }
  })
  .get('/ui/failures/status', async ({ query }) => {
    const benchmarkRunId = Number(query.run);
    if (!Number.isInteger(benchmarkRunId) || benchmarkRunId < 1) return errorStatus('Select a benchmark run.');
    const rows = await jobs.listByBenchmarkRun(benchmarkRunId);
    const job = [...rows].reverse().find((item) => item.kind === 'failure_map') ?? null;
    return (
      <FailureAnalysisStatus
        runId={benchmarkRunId}
        job={job}
        progress={await progress.byBenchmarkRun(benchmarkRunId)}
        refreshWhenReady
      />
    );
  });
