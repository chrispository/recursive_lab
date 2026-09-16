import { Icon } from '../../ui/Icon.tsx';

/** Outside the polling region so help stays open while a check runs. */
export function EnvLabPrimer() {
  return (
    <details class="m-evidence m-env-primer">
      <summary>
        <span class="m-evidence-toggle" aria-hidden="true"><Icon name="chevron" /></span>
        <span class="m-evidence-title">New to reinforcement learning? Start here</span>
      </summary>
      <div class="m-evidence-body m-env-primer-body">
        <div class="m-env-primer-block">
          <h4>What you are making</h4>
          <p>An environment is a set of tasks plus a grader. The policy model attempts a task;
            a separate judge checks its answer against specific targets. The fraction satisfied
            is its reward, from 0 to 1. One attempt is called a rollout.</p>
          <p>During training, the trainer uses rewards to update the policy’s weights.
            Here, you are checking whether the tasks and grader produce useful feedback for that policy.</p>
        </div>
        <div class="m-env-primer-block">
          <h4>Three steps before export</h4>
          <ol class="m-env-primer-steps">
            <li><strong>Build packages.</strong> Save approved documents as tasks and a grader, one package per topic. No model calls. Rebuilding saves a new revision and requires fresh checks; previous files remain available.</li>
            <li><strong>Check it runs.</strong> Make two attempts per task. A completed check means the package, policy and judge worked; low reward is still a valid result.</li>
            <li><strong>Check training signal.</strong> Make four attempts on the same tasks. Look for some success, differences between attempts, and room to improve.</li>
          </ol>
          <p>These are screening rules, not proof that training will improve the model. Small tasksets provide limited evidence.</p>
        </div>
        <div class="m-env-primer-block">
          <h4>Why three task splits?</h4>
          <p><strong>Train</strong> supplies future training updates. <strong>Canary</strong> is a small quick-check set.
            <strong> Heldout</strong> is reserved for measuring performance without training on it.
            Both local checks currently run all populated splits; the export trains only on the training split.</p>
        </div>
        <div class="m-env-primer-block">
          <h4>Cost and handoff</h4>
          <p>Each attempt makes one policy call plus one judge call per verifier target, before retries.
            Concurrent attempts controls how many can run together; judge targets can also run in parallel.</p>
          <p>A fresh validation records the package, policy and judge used. Rerunning a check clears export readiness
            until validation passes again. Preparing an export saves a downloadable package and launch instructions;
            it does not send data or start a cluster job.</p>
        </div>
      </div>
    </details>
  );
}
