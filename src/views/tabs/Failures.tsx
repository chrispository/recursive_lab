import type { Progress } from '../../domain/progress/model.ts';
import { isBelowThreshold, type TopicRow } from '../../domain/topics/model.ts';
import { tally, type TopicTally } from '../../domain/topics/service.ts';
import { Bar } from '../ui/Bar.tsx';
import { Badge } from '../ui/Badge.tsx';
import { Cap } from '../ui/Cap.tsx';
import { Field } from '../ui/Field.tsx';
import { Id } from '../ui/Id.tsx';
import { Panel } from '../ui/Panel.tsx';
import { Table } from '../ui/Table.tsx';
import { TableBox } from '../ui/TableBox.tsx';
import { Tally } from '../ui/Tally.tsx';

type FailuresProps = {
  progress: Progress | null;
  topics: TopicRow[];
  uncategorised: number;
};

const formatReward = (value: number | null) => (value === null ? '—' : value.toFixed(3));

export function Failures({ progress, topics, uncategorised }: FailuresProps) {
  const summary = tally(topics, uncategorised);
  const map = progress?.failureMap;

  return (
    <>
      <div class="m-title">
        <h2>Turn misses into capability topics</h2>
        <p>
          The frontier analyst sees failed criteria and judge reasoning — never benchmark source
          documents.
        </p>
      </div>

      <TopicTable summary={summary} topics={topics} />

      <TableBox>
        <Cap title="Failure map ledger" code={map?.entity ? '1 map' : 'no map'} />
        {map?.entity && progress ? (
          <Table>
            <thead>
              <tr>
                <th>Map</th>
                <th>Source run</th>
                <th class="n">Failures</th>
                <th>Status</th>
                <th class="n">Topics</th>
              </tr>
            </thead>
            <tbody>
              <tr data-state="ready">
                <td>
                  <span class="nm">{map.entity}</span>
                  <span class="sub">→ {progress.topicCount} topics</span>
                </td>
                <td>
                  {progress.label} · {progress.model}
                  <span class="sub">{progress.runCode}</span>
                </td>
                <td class="n">{map.count}</td>
                <td><Badge state="ready">mapped</Badge></td>
                <td class="n">{progress.topicCount}</td>
              </tr>
            </tbody>
          </Table>
        ) : (
          <div class="m-empty">No failure map for the current benchmark run.</div>
        )}
      </TableBox>

      <div class="m-split">
        <Panel title="Current run" code="read only">
          <Field label="Benchmark run">
            <div class="m-input">{progress ? `${progress.label} / ${progress.model}` : 'No current run'}</div>
          </Field>
          <Field label="Progress">
            <div class="m-input">
              {progress ? (
                <>
                  <Id value={progress.runCode} />
                  {map?.entity ? <> · <Id value={map.entity} /></> : null}
                </>
              ) : (
                '—'
              )}
            </div>
          </Field>
        </Panel>
        <Panel title="Analysis boundary" code="anti-benchmax">
          <p class="m-note">
            Topic name, description, and verifier strategy are the only inputs exposed to document
            generation. Source tasks and benchmark documents stay outside this surface.
          </p>
          <div class="m-actions">
            <Badge state={progress?.topicCount ? 'ready' : 'pending'}>
              {progress?.topicCount ? 'topics extracted' : 'awaiting analysis'}
            </Badge>
          </div>
        </Panel>
      </div>
    </>
  );
}

function TopicTable({ summary, topics }: { summary: TopicTally; topics: TopicRow[] }) {
  return (
    <TableBox>
      <Cap title="Topics extracted from failed criteria">
        <Tally
          items={[
            { value: summary.topics, label: 'topics' },
            { value: summary.failures, label: 'failures mapped', hot: true },
            { value: summary.uncategorised, label: 'uncategorized' },
            { value: summary.documents, label: 'docs generated' },
          ]}
        />
      </Cap>
      {topics.length ? (
        <Table>
          <thead>
            <tr>
              <th>Topic</th>
              <th>Id</th>
              <th class="n">Fails</th>
              <th class="n">Docs</th>
              <th class="n">Reward</th>
              <th>Verifier</th>
            </tr>
          </thead>
          <tbody>
            {topics.map((topic) => (
              <tr data-hot={topic.slug === summary.hottestSlug ? '1' : undefined}>
                <td>
                  <span class="nm">{topic.name}</span>
                  <span class="sub">{topic.description}</span>
                </td>
                <td><Id value={topic.code} /></td>
                <td class="n">{topic.failureCount}</td>
                <td class="n">{topic.documentCount}</td>
                <td class="n">{formatReward(topic.reward)}</td>
                <td><Bar value={topic.reward} below={isBelowThreshold(topic)} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <div class="m-empty">No topics extracted for the current failure map.</div>
      )}
    </TableBox>
  );
}
