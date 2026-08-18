/**
 * Every word this app or the gym puts in front of you, in plain language.
 *
 * Two rules for anything added here:
 *
 *  1. **Define it without using another undefined word.** If an entry needs
 *     "rollout" to make sense, "rollout" is defined above it, not below.
 *  2. **Say what it is in *this* installation.** A definition that could have
 *     been copied from anyone's documentation leaves the reader still guessing
 *     which of their own folders it was talking about, so every entry that can
 *     name a real value here does.
 *
 * This is content, not logic. It takes measured values in and returns text; it
 * reads nothing and decides nothing.
 */

/** The live values a definition can point at, so nothing is left abstract. */
export type GlossaryContext = {
  gymRoot: string;
  headUrl: string;
  /** Config key of the running resources server, e.g. `legal_agent_bench`. */
  resourcesServer: string;
  /** Component name of the running agent, e.g. `harbor_agent`. */
  agent: string;
  policyModel: string;
  judgeModel: string;
  benchmarkName: string;
  taskCount: number;
  criteriaCount: number;
  runnableCount: number;
  blockedCount: number;
  blockedFamilies: string[];
  yourRevision: string;
  gymRevision: string;
};

export type Entry = {
  term: string;
  /** Other names for the same thing, so a word met elsewhere still lands. */
  also?: string;
  /** What it actually is. No assumed vocabulary. */
  plain: string;
  /** The same thing, stated with this installation's own values. */
  yours?: string;
};

export type Section = { id: string; title: string; blurb: string; entries: Entry[] };

const n = (value: number) => value.toLocaleString('en-US');
const short = (sha: string) => (sha ? sha.slice(0, 10) : 'not known yet');
const list = (items: string[]) => (items.length ? items.join(' and ') : 'none');

/** The two programs, and the wiring between them. */
function programs(ctx: GlossaryContext): Section {
  return {
    id: 'words-programs',
    title: 'The two programs on your computer',
    blurb:
      'Almost every confusing word belongs to one of two programs. Knowing which one owns a word tells you which folder it is talking about.',
    entries: [
      {
        term: 'The lab',
        also: 'this app, recursive_lab',
        plain:
          'The website you are looking at. It keeps your list of questions, starts test runs, stores every score, and is where mistakes get sorted and practice material gets written. It grades nothing itself.',
        yours: 'Runs on your machine at 127.0.0.1:8767. Everything it owns lives in data/lab.db and the data folder.',
      },
      {
        term: 'NeMo Gym',
        also: 'the gym',
        plain:
          'A separate program from NVIDIA that sits in a folder inside this project. It is the thing that actually puts a question to a model, lets the model work, and marks the result. The lab asks it to do all of that.',
        yours: `Its folder is ${ctx.gymRoot}. Deleting that folder would not touch anything you have imported or run.`,
      },
      {
        term: 'Checkout',
        also: 'copy of the gym, GYM_ROOT',
        plain:
          'Nothing more than a downloaded folder of the gym’s program files. "We got a new checkout" means that folder was replaced with a fresh download of NVIDIA’s public code.',
        yours:
          'Your results, settings and imported questions are outside that folder, so replacing it loses none of them. What it does reset is the gym’s own prepared copy of the questions, which it rebuilds the next time it starts.',
      },
      {
        term: 'Head server',
        also: 'head URL, the address in your settings',
        plain:
          'When the gym is switched on it starts several small programs at once, each listening on its own numbered door. Those door numbers are picked fresh every time, so they are useless to remember. The head server is the receptionist: one address that never changes, which knows where all the others ended up today.',
        yours: `${ctx.headUrl}. It is the only gym address this app is allowed to remember; it asks the receptionist for the rest.`,
      },
      {
        term: 'Resources server',
        also: 'adapter',
        plain:
          'The part of the gym that understands one particular set of questions. It sets each question up, hands the model whatever tools that question needs, and marks the answer at the end.',
        yours: ctx.resourcesServer
          ? `${ctx.resourcesServer} — the one that knows how to run ${ctx.benchmarkName}.`
          : 'Not running right now. Start the gym below to see which one comes up.',
      },
      {
        term: 'Agent server',
        also: 'harness, agent',
        plain:
          'The part that plays the role of the person using the model: it reads the question out, sends it to the model, carries out whatever the model asks for, sends back the outcome, and stops when the model says it is done.',
        yours: ctx.agent ? `${ctx.agent}.` : 'Not running right now.',
      },
      {
        term: 'Model server',
        also: 'policy model, the model under test',
        plain:
          'A thin adapter that hides where the model actually lives, so the rest of the gym does not care whether it is on your machine or someone else’s.',
        yours: ctx.policyModel
          ? `Set to ${ctx.policyModel}, reached over the internet through a paid address. Nothing about the model is stored here.`
          : 'No model chosen yet — set one in the credentials section on this page.',
      },
      {
        term: 'Environment',
        plain:
          'In the gym’s writing this means one complete package: a set of questions, the tools they need, and the rules for marking them. It does not mean environment variables or a Python setup.',
        yours:
          'Careful: this app’s own "Env Lab" tab uses the word for something different — the practice packages you generate later. Same word, two meanings, and only the gym’s documentation uses the first.',
      },
    ],
  };
}

/** Words that appear while a run is happening. */
function running(ctx: GlossaryContext): Section {
  return {
    id: 'words-running',
    title: 'Words you see while a run happens',
    blurb: 'These stack: a question set holds questions, a question holds marking points, a run makes attempts at questions.',
    entries: [
      {
        term: 'Benchmark',
        also: 'question set, catalog',
        plain: 'A whole collection of questions written by someone else and published, so that different models can be compared fairly on the same work.',
        yours: `${ctx.benchmarkName} — ${n(ctx.taskCount)} questions.`,
      },
      {
        term: 'Task',
        also: 'question, instance',
        plain:
          'One single job for the model: the wording, any files it starts with, and the list of things a correct answer has to do. Names look like family__tasks__012.',
        yours: 'The part of the name before the first double underscore is just a grouping — the gym calls it a family.',
      },
      {
        term: 'Criterion',
        also: 'criteria (plural), marking point, rubric item',
        plain:
          'One specific thing an answer is checked for — "mentions the filing deadline", "does not invent a case name". A question is marked by going through its list one at a time, so a score is a fraction, not an opinion.',
        yours: `${n(ctx.criteriaCount)} marking points across ${n(ctx.taskCount)} questions — roughly ${Math.round(ctx.criteriaCount / Math.max(ctx.taskCount, 1))} checks per question.`,
      },
      {
        term: 'Split',
        also: 'dataset, validation, test',
        plain: 'Which slice of a question set you are using. Just a label on a group of questions; nothing technical happens because of it.',
        yours: 'Yours are all labelled validation.',
      },
      {
        term: 'Run',
        also: 'benchmark run, BR-…',
        plain: 'One press of the run button: one model, one set of chosen questions, one set of settings. Everything produced afterwards hangs off it.',
      },
      {
        term: 'Rollout',
        also: 'trial, attempt',
        plain:
          'One complete attempt by the model at one question — from the moment it is shown the question to the moment it stops, including everything it did in between. This is the word that trips everyone up: it is a recording of an attempt, not a score and not a training step.',
        yours:
          'Ten questions attempted twice each is twenty rollouts. The gym writes one line per rollout into a file called rollouts.jsonl, and the lab reads that file to know how far along the run is.',
      },
      {
        term: 'Repeats',
        also: 'num-repeats',
        plain:
          'How many times each question is attempted. Models are not consistent, so attempting once tells you less than attempting five times. More repeats means a steadier number and a larger bill.',
      },
      {
        term: 'Turn',
        plain:
          'One back-and-forth inside a single attempt: the model says something or asks to use a tool, gets a response, and goes again. A hard limit stops a model that would otherwise loop forever.',
        yours: 'Your runs allow up to 60 turns per attempt.',
      },
      {
        term: 'Transcript',
        also: 'trajectory, Harbor trial folder',
        plain: 'The written record of every turn in one attempt — each message, each tool used, each file touched.',
        yours: 'These are the biggest files the gym produces and the first worth deleting once a run has been categorised.',
      },
      {
        term: 'Judge',
        also: 'LLM judge, grader',
        plain:
          'A second model whose only job is to read a finished attempt and decide, for each marking point, pass or fail — and write a sentence saying why. That sentence is what makes sorting mistakes into topics possible later.',
        yours: ctx.judgeModel ? `${ctx.judgeModel}.` : 'Not set yet — set it in the credentials section on this page.',
      },
      {
        term: 'Verifier',
        plain:
          'Marking that needs no opinion at all: the answer either matches, or the test either passes. Cheaper and more reliable than a judge, but only possible when there is one right answer.',
      },
      {
        term: 'Reward',
        also: 'score',
        plain:
          'A single number between 0 and 1 for one attempt, usually the fraction of marking points it passed. It is called reward because it is the number a training program would later use to decide which behaviour to encourage. Here it is only a score.',
      },
      {
        term: 'Pass rate',
        plain: 'The share of questions that came out passing across a whole run. The headline number.',
      },
      {
        term: 'Concurrency',
        plain: 'How many attempts are allowed to be in flight at the same time. Higher finishes sooner and hits rate limits sooner.',
      },
    ],
  };
}

/** Why there are two copies of the same repository, and what a pin is. */
function copies(ctx: GlossaryContext): Section {
  return {
    id: 'words-copies',
    title: 'Why there are two copies of your questions',
    blurb:
      'This is the "your copy vs the gym’s copy" confusion. Nobody designed it this way on purpose; it falls out of two programs each freezing the same public repository at a different moment.',
    entries: [
      {
        term: 'Commit',
        also: 'revision, sha',
        plain:
          'A public repository changes over time. A commit is one exact frozen version of it, named by a long code. Quoting a commit is how you say "this precise version" instead of "whatever is there today".',
      },
      {
        term: 'Pinned',
        plain:
          'Frozen at one exact commit and staying there. Nothing in this setup follows "latest" automatically, which is deliberate: a question set that changed under you would make yesterday’s scores meaningless.',
      },
      {
        term: 'Your copy',
        also: 'the import, the snapshot, the catalog',
        plain:
          'When you imported the question set, the lab downloaded the repository as it stood that day and copied the questions into its own database. This is the copy you browse, filter and choose from.',
        yours: `${ctx.benchmarkName}, frozen at ${short(ctx.yourRevision)}.`,
      },
      {
        term: 'The gym’s copy',
        also: 'prepared assets',
        plain:
          'The gym ships with its own pinned version of the same repository, and when it starts it unpacks that version into the form it needs to actually run a question. This is the copy that does the work.',
        yours: `Frozen at ${short(ctx.gymRevision)} — an older moment than your import.`,
      },
      {
        term: 'Runnable',
        plain:
          'A question that exists in both copies can be run. A question that exists only in yours cannot: the gym has never heard of it, and the run stops immediately saying it found zero questions to run.',
        yours: ctx.blockedCount
          ? `${n(ctx.runnableCount)} of your questions are runnable. ${n(ctx.blockedCount)} are not — everything in ${list(ctx.blockedFamilies)}. Choose from the other families, or import the source again pinned at ${short(ctx.gymRevision)} so both copies match.`
          : `All ${n(ctx.runnableCount)} of your questions are runnable.`,
      },
      {
        term: 'Drift',
        plain:
          'The gap between the two copies. It is not damage and there is nothing to repair; it only matters when you pick a question that lives on one side of the gap.',
      },
    ],
  };
}

/** Training words — every one of which describes something not done here. */
function training(): Section {
  return {
    id: 'words-training',
    title: 'Training words — none of this happens here',
    blurb:
      'These words are all over the gym’s documentation, which is why they seem relevant. They belong to a separate program that runs on rented graphics cards. This app produces the material that program would eat; it never runs it.',
    entries: [
      {
        term: 'Weights',
        plain:
          'The numbers inside a model — billions of them — that make it behave the way it does. "A model" and "its weights" mean the same thing in practice.',
        yours: 'Yours are on a company’s servers, reached over the internet. None are on this machine.',
      },
      {
        term: 'Checkpoint',
        plain:
          'A saved copy of all of a model’s numbers at one moment during training, so that training can be resumed or rolled back to a version that behaved better. They are enormous — tens to hundreds of gigabytes each.',
        yours:
          'You have none, and nothing in this app can produce one. Making a checkpoint requires training a model, which requires rented graphics cards and a different program (NeMo-RL). Every mention of "checkpoint" in the gym’s documentation is about that program, not this one.',
      },
      {
        term: 'Training',
        also: 'fine-tuning, post-training',
        plain: 'The process of actually changing a model’s numbers so it behaves differently afterwards. Expensive, slow, and done on rented machines.',
      },
      {
        term: 'RL',
        also: 'reinforcement learning, GRPO',
        plain:
          'One way of training: let a model attempt tasks, score each attempt, and nudge it towards whatever scored higher. It is the reason attempts are recorded and scored the way they are here — scored attempts are exactly the raw material RL consumes.',
      },
      {
        term: 'Synthetic data',
        plain:
          'Practice questions written by a model instead of by a person. The point of this app: find out what your model gets wrong, name those weaknesses, then generate fresh questions aimed at them.',
      },
      {
        term: 'Inference provider',
        plain:
          'Renting a model by the request over the internet, rather than running one yourself. No hardware, no downloads, billed per use.',
        yours: 'This is how your model is set up, which is why nothing here needs a graphics card.',
      },
      {
        term: 'vLLM',
        plain: 'The program people use to serve a model on their own graphics cards. The gym supports it; you are not using it.',
      },
    ],
  };
}

export function sections(ctx: GlossaryContext): Section[] {
  return [programs(ctx), running(ctx), copies(ctx), training()];
}
