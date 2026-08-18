/**
 * "What do I actually have?" — the Settings inventory.
 *
 * Every row is assembled from a count or a byte total that was measured, never
 * from an assumption about what a working install looks like. Two consequences
 * are deliberate:
 *
 *  - A thing that does not exist still gets a row, saying so and saying what it
 *    would contain. Absence is the answer to most of the confusion here.
 *  - Storage totals arrive as an argument rather than being re-measured. The
 *    Settings page already walks those directories once for the storage panel,
 *    and the gym checkout is gigabytes; walking it twice per page load to tell
 *    the same truth twice would be a poor trade.
 */
import type { AlignmentReport } from '../benchmarks/model.ts';
import type { BucketUsage } from '../../gym/storage.ts';
import type { Holding } from './model.ts';
import * as repo from './repo.ts';

export type { Holding, HoldingGroup } from './model.ts';
export { HOLDING_GROUPS } from './model.ts';

const num = (value: number) => value.toLocaleString('en-US');

const size = (bytes: number) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} bytes`;
};

/** A bucket by id, or a zeroed stand-in so a caller never branches on absence. */
const bucketOf = (buckets: BucketUsage[], id: string): BucketUsage =>
  buckets.find((bucket) => bucket.id === id) ??
  { id, label: id, path: '', owner: 'gym', note: '', resolved: false, bytes: 0, entries: [] };

export async function report(buckets: BucketUsage[], alignment: AlignmentReport): Promise<Holding[]> {
  const [counts, paths, models] = await Promise.all([repo.counts(), repo.resultPaths(), repo.modelsTested()]);

  const snapshots = bucketOf(buckets, 'snapshots');
  const recordings = bucketOf(buckets, 'run-artifacts');
  const transcripts = bucketOf(buckets, 'harbor-jobs');
  const prepared = bucketOf(buckets, 'prepared-assets');

  const runnable = alignment.catalogs.reduce((total, catalog) => total + catalog.runnableCount, 0);
  const blocked = alignment.catalogs.reduce((total, catalog) => total + catalog.missingCount, 0);
  // A recording written before the gym moved into this repo still has its old
  // absolute path on the result row, and that folder is not in the bucket the
  // storage panel walks. Saying "1 run, 0 folders" without explaining the gap
  // reads as data loss; it is a move.
  const strandedPaths = paths.filter((path) => !path.startsWith(recordings.path));

  return [
    {
      id: 'benchmarks',
      group: 'questions',
      label: 'Question sets you have imported',
      alsoCalled: 'benchmarks, catalogs, BMS-…',
      state: counts.benchmarks ? 'have' : 'none',
      amount: counts.benchmarks
        ? `${num(counts.benchmarks)} set${counts.benchmarks === 1 ? '' : 's'}, ${num(counts.tasks)} questions, ${num(counts.criteria)} marking points`
        : 'none yet',
      where: counts.benchmarks ? `${snapshots.path} — ${size(snapshots.bytes)}, plus rows in data/lab.db` : '',
      contains:
        'The wording of every question, the files that come with it, and every individual thing a good answer is checked for.',
      missing:
        'Any answers. No model has been shown a word of this yet — importing costs nothing but download time.',
    },
    {
      id: 'runnable',
      group: 'questions',
      label: 'Questions the gym can actually set up and mark',
      alsoCalled: 'runnable tasks, the gym’s prepared copy',
      state: !alignment.gym.resolved ? 'none' : blocked ? 'partial' : 'have',
      amount: !alignment.gym.resolved
        ? 'not prepared yet'
        : blocked
          ? `${num(runnable)} of your ${num(runnable + blocked)} — ${num(blocked)} cannot run`
          : `all ${num(runnable)}`,
      where: prepared.resolved ? `${prepared.path.split('\n')[0]} — ${size(prepared.bytes)}` : '',
      contains:
        'The gym’s own frozen copy of the same repository, unpacked into the form it needs to run a question: starting files, tools, and marking rules.',
      missing:
        'The questions that were added to the repository after the version the gym froze. Those exist in your list but nowhere the gym can reach, and picking one fails the run instantly.',
    },
    {
      id: 'runs',
      group: 'attempts',
      label: 'Times you pressed run',
      alsoCalled: 'benchmark runs, BR-…',
      state: counts.runs ? 'have' : 'none',
      amount: counts.runs
        ? `${num(counts.runs)} run${counts.runs === 1 ? '' : 's'}${models.length ? `, model tested: ${models.join(', ')}` : ''}`
        : 'none yet',
      where: counts.runs ? 'data/lab.db' : '',
      contains: 'Which question set, which model, which settings, when it started, and how it ended.',
      missing: 'Anything the model said. A run row is the receipt, not the recording.',
    },
    {
      id: 'attempts',
      group: 'attempts',
      label: 'Single attempts at a single question',
      alsoCalled: 'rollouts, trials, task results, TR-…',
      state: counts.attempts ? 'have' : 'none',
      amount: counts.attempts ? `${num(counts.attempts)} attempt${counts.attempts === 1 ? '' : 's'}` : 'none yet',
      where: counts.attempts ? 'data/lab.db' : '',
      contains:
        'One row per attempt: which question, which repeat, whether it passed, its score out of 1, and the error text when it broke.',
      missing:
        'The conversation itself. The row points at the recording; it does not hold it.',
    },
    {
      id: 'recordings',
      group: 'attempts',
      label: 'Recording files the gym wrote',
      alsoCalled: 'rollouts.jsonl, run artifacts',
      state: recordings.entries.length ? 'have' : strandedPaths.length ? 'partial' : 'none',
      amount: recordings.entries.length
        ? `${num(recordings.entries.length)} run folder${recordings.entries.length === 1 ? '' : 's'} — ${size(recordings.bytes)}`
        : strandedPaths.length
          ? `${num(strandedPaths.length)} recorded before the gym moved into this repo, still in the old folder`
          : 'none yet',
      where: strandedPaths.length ? strandedPaths.join('\n') : recordings.resolved ? recordings.path : '',
      contains:
        'One line per attempt: the full exchange between the model and the question, the final answer, and the marks. This is the only complete copy of what happened.',
      missing:
        'A spare copy. Only the scores are lifted into the database, so deleting a run folder permanently loses the wording of what the model actually said.',
    },
    {
      id: 'graded',
      group: 'attempts',
      label: 'Marks with a reason attached',
      alsoCalled: 'criterion results, CR-…',
      state: counts.gradedCriteria ? 'have' : 'none',
      amount: counts.gradedCriteria ? `${num(counts.gradedCriteria)} marks` : 'none yet',
      where: counts.gradedCriteria ? 'data/lab.db' : '',
      contains:
        'For one attempt and one marking point: pass or fail, and the sentence the marking model wrote explaining it. Sorting mistakes into topics reads these and nothing else.',
      missing:
        counts.attempts && !counts.gradedCriteria
          ? 'Everything — your attempt broke before any marking happened, so there is nothing to categorise yet.'
          : 'Any judgement of the answer as a whole. Each row is one narrow check.',
    },
    {
      id: 'transcripts',
      group: 'attempts',
      label: 'Blow-by-blow working files',
      alsoCalled: 'Harbor trials, trajectories, transcripts',
      state: transcripts.resolved && transcripts.bytes ? 'have' : 'none',
      amount: transcripts.resolved ? (transcripts.bytes ? size(transcripts.bytes) : 'none yet') : 'not readable until the gym is running',
      where: transcripts.resolved ? transcripts.path : '',
      contains:
        'Every step of every attempt as it happened: each message, each tool the model reached for, each file it touched, and the marking model’s notes.',
      missing:
        'A short version. Nothing anywhere summarises these, and they are by far the largest files the gym produces — the first thing worth deleting once a run has been categorised.',
    },
    {
      id: 'failure-maps',
      group: 'lessons',
      label: 'Mistakes sorted into topics',
      alsoCalled: 'failure maps, topics, FM-… / TP-…',
      state: counts.failureMaps ? 'have' : 'none',
      amount: counts.failureMaps
        ? `${num(counts.failureMaps)} map${counts.failureMaps === 1 ? '' : 's'}, ${num(counts.topics)} topics, ${num(counts.failureItems)} sorted mistakes`
        : 'none yet',
      where: counts.failureMaps ? 'data/lab.db' : '',
      contains:
        'Each failed mark filed under a named weakness, so "it scored 62%" becomes "it cannot cite a source it was not handed".',
      missing:
        'Anything at all until a run has produced marks with reasons attached. This stage reads those reasons and nothing else — it never re-reads the questions.',
    },
    {
      id: 'forge',
      group: 'lessons',
      label: 'Practice material written for the weak topics',
      alsoCalled: 'data forge runs, synthetic data, DF-… / DOC-…',
      state: counts.forgeRuns ? 'have' : 'none',
      amount: counts.forgeRuns ? `${num(counts.forgeRuns)} batches, ${num(counts.documents)} pieces` : 'none yet',
      where: counts.forgeRuns ? 'data/lab.db' : '',
      contains:
        'New questions generated from the name and description of a weak topic only — deliberately never from the original question, so the new material cannot be a copy of the test.',
      missing:
        'Any improvement to a model. This is the raw material you would hand to a separate training program later.',
    },
    {
      id: 'environments',
      group: 'lessons',
      label: 'Practice sets packaged so a model can be trained on them',
      alsoCalled: 'environments, ENV-…',
      state: counts.environments ? 'have' : 'none',
      amount: counts.environments ? `${num(counts.environments)} packaged` : 'none yet',
      where: counts.environments ? 'data/lab.db' : '',
      contains: 'Generated questions plus the marking rule that decides whether an answer to them is right.',
      missing: 'The training itself, which happens on rented machines running a different program.',
    },
    {
      id: 'checkpoints',
      group: 'training',
      label: 'Saved copies of a model',
      alsoCalled: 'checkpoints, weights',
      state: 'none',
      amount: 'none, and this app never makes one',
      where: '',
      contains: '',
      missing:
        'A checkpoint is a saved snapshot of the numbers inside a model, taken partway through training it. Producing one means training, which needs rented graphics cards and a different NVIDIA program (NeMo-RL). Nothing here changes a model — this app only asks models questions and keeps what came back. Every mention of "checkpoint" in the gym’s documentation is about that other program.',
    },
    {
      id: 'model-files',
      group: 'training',
      label: 'A model on your own disk',
      alsoCalled: 'local model, vLLM, self-hosted weights',
      state: 'none',
      amount: models.length ? `none — ${models.join(', ')} is rented over the internet` : 'none',
      where: '',
      contains: '',
      missing:
        'Your model is reached through a paid web address, so no part of it is stored on this machine and no graphics card is needed. The gym only needs one if you ever choose to run a model locally.',
    },
    {
      id: 'gym-copy',
      group: 'training',
      label: 'The gym’s own program files',
      alsoCalled: 'the checkout, GYM_ROOT',
      state: 'have',
      amount: 'downloaded, with several gigabytes of prepared question data',
      where: '',
      contains:
        'NVIDIA’s public code, plus everything it has downloaded and unpacked to be able to run your questions. The storage panel below breaks this down folder by folder.',
      missing:
        'None of your work. Replacing this folder with a fresh download loses nothing you have imported, run, or scored — those live in data/lab.db and the folders above.',
    },
  ];
}
