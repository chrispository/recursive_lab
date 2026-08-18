/**
 * Gym lifecycle at app boot and shutdown.
 *
 * `bun run dev` should bring up the whole machine, gym included, and Ctrl+C
 * should take it back down. The Settings panel's start/stop buttons and this
 * module call the same `lifecycle` functions, so there is exactly one ladder
 * for starting and one for stopping. Two guards keep boot quiet: an
 * already-listening head server means there is nothing to start, and a missing
 * venv means the checkout has not been built yet, which the Settings panel
 * reports better than a boot crash.
 */
import * as lifecycle from './gym/lifecycle.ts';

const RESOURCES_SERVER = 'legal_agent_bench';
const MODEL_TYPE = 'inference_provider';

/** Bring the gym up with the app, unless it is already running or unbuilt. */
export function autostartGym(): void {
  void lifecycle
    .start({ resourcesServer: RESOURCES_SERVER, modelType: MODEL_TYPE })
    .then(({ pid }) => console.log(`gym env start → pid ${pid} (head will be up once prepared)`))
    .catch((error: unknown) =>
      console.log(`gym env start skipped: ${error instanceof Error ? error.message : String(error)}`),
    );
}

/**
 * Take the gym down with the app — the same SIGINT ladder the Settings stop
 * button uses, so child servers and Ray shut down gracefully rather than
 * orphaning when the dev server dies.
 *
 * Synchronous on purpose: it *fires* the ladder (signals out, kill after
 * grace) and lets the process exit immediately; it never blocks shutdown on
 * gym answering. A lingering gym is recoverable, a frontend that ignores
 * Ctrl+C is not.
 */
export function autostopGym(): void {
  try {
    void lifecycle
      .stop(8_000)
      .then(({ stopped, killed }) => {
        if (stopped.length || killed.length) {
          console.log(`gym stopped with the app (${stopped.length} exited, ${killed.length} killed).`);
        }
      })
      .catch(() => undefined);
  } catch {
    // Shutdown must never throw.
  }
}
