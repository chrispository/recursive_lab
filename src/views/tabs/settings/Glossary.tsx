/**
 * The plain-English dictionary panel.
 *
 * Static content, deliberately outside the `#settings-gym` fragment: it never
 * changes when you start the gym or delete a folder, so it should not be
 * re-sent on every swap of that region. The live values it quotes come in as
 * props from whoever renders the page.
 *
 * Wording lives in `glossary.ts`; this file only lays it out.
 */
import type { AlignmentReport, BenchmarkCatalog } from '../../../domain/benchmarks/model.ts';
import type { GymHealth } from '../../../gym/head.ts';
import type { PublicSettings } from '../../../gym/settings.ts';
import { config } from '../../../config.ts';
import { Panel } from '../../ui/Panel.tsx';
import { sections, type Entry, type Section } from './glossary.ts';

function Term({ entry }: { entry: Entry }) {
  return (
    <div class="m-dict-entry">
      <dt>
        <span class="m-dict-term">{entry.term}</span>
        {entry.also ? <span class="m-dict-also">also called {entry.also}</span> : null}
      </dt>
      <dd>
        <p>{entry.plain}</p>
        {entry.yours ? <p class="m-dict-yours"><span>Here</span> {entry.yours}</p> : null}
      </dd>
    </div>
  );
}

function Chapter({ section }: { section: Section }) {
  return (
    <section class="m-dict-section" id={section.id}>
      <h4>{section.title}</h4>
      <p class="m-note">{section.blurb}</p>
      <dl class="m-dict">
        {section.entries.map((entry) => <Term entry={entry} />)}
      </dl>
    </section>
  );
}

export function Glossary(
  { settings, health, alignment, catalogs }: {
    settings: PublicSettings;
    health: GymHealth;
    alignment: AlignmentReport;
    catalogs: BenchmarkCatalog[];
  },
) {
  const resources = health.servers.find((server) => server.serverType === 'resources_servers' && server.healthy);
  const agent = health.servers.find((server) => server.serverType === 'responses_api_agents' && server.healthy);
  // One benchmark is the common case and the one worth naming; with several
  // imported, the first is the example the definitions are written against.
  const first = alignment.catalogs[0] ?? null;
  const catalog = catalogs.find((row) => row.benchmarkCode === first?.benchmarkCode) ?? catalogs[0] ?? null;

  const chapters = sections({
    gymRoot: config.gym.root,
    headUrl: health.headUrl,
    resourcesServer: resources?.processName ?? '',
    agent: agent?.name ?? '',
    policyModel: settings.policy_model_name,
    judgeModel: settings.judge_model_name,
    benchmarkName: first?.name ?? catalog?.name ?? 'your question set',
    taskCount: first?.taskCount ?? catalog?.taskCount ?? 0,
    criteriaCount: catalog?.criterionCount ?? 0,
    runnableCount: first?.runnableCount ?? 0,
    blockedCount: first?.missingCount ?? 0,
    blockedFamilies: first?.missingFamilies ?? [],
    yourRevision: first?.catalogRevision ?? catalog?.revision ?? '',
    gymRevision: alignment.gym.revision,
  });

  return (
    <Panel id="settings-dictionary" class="m-prose" title="What all these words mean" code="read this first">
      <p class="m-note">
        Nothing below is jargon you are expected to already know. Each word is defined without using another word
        from this list that has not been defined yet, and where a definition can point at something real on your
        machine, it does.
      </p>
      <nav class="m-dict-jump" aria-label="Dictionary sections">
        {chapters.map((section) => <a href={`#${section.id}`}>{section.title}</a>)}
      </nav>
      {chapters.map((section) => <Chapter section={section} />)}
    </Panel>
  );
}
