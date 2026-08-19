/**
 * Gym environment controls and disk usage, for the Settings tab.
 *
 * Root of the `settings-gym` fragment: renders its own `id` and is swapped
 * `outerHTML` onto it, so a start/stop/delete response replaces this whole
 * region idempotently. `GET /ui/settings/gym` returns it; the POSTs below
 * return the same region after acting.
 */
import type { GymHealth } from '../../../gym/head.ts';
import type { BucketUsage } from '../../../gym/storage.ts';
import { config } from '../../../config.ts';
import { Badge } from '../../ui/Badge.tsx';
import { Btn } from '../../ui/Btn.tsx';
import { Panel } from '../../ui/Panel.tsx';

const GYM_ROOT = config.gym.root;

const formatBytes = (bytes: number) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

export function GymPanel(
  props: {
    health: GymHealth;
    headPid: number | null;
    buckets: BucketUsage[];
    defaultResourcesServer: string;
    defaultModelType: string;
    notice: string;
  },
) {
  const { health, headPid, buckets, defaultResourcesServer, defaultModelType, notice } = props;
  const servers = health.servers.filter((server) => server.healthy);
  const resources = health.servers.find((server) => server.serverType === 'resources_servers' && server.healthy);
  const model = health.servers.find((server) => server.serverType === 'responses_api_models' && server.healthy);
  return (
    <section id="settings-gym" hx-get="/ui/settings/gym" hx-swap="outerHTML">
      <Panel title="NeMo Gym environment" code={health.headUrl}>
        <div class="m-status-list">
          <div><span>Head server</span><Badge state={health.reachable ? 'ready' : 'pending'}>{health.reachable ? 'reachable' : 'stopped'}</Badge></div>
          <div><span>Checkout</span><code class="m-storage-path">{GYM_ROOT}</code></div>
          <div><span>Resources server</span>{resources ? <span><code class="m-storage-path">{resources.processName}</code></span> : <span class="m-storage-path is-unset">not running</span>}</div>
          <div><span>Model type</span>{model ? <span><code class="m-storage-path">{model.name}</code></span> : <span class="m-storage-path is-unset">not running</span>}</div>
          <div><span>Listener pid</span><code class="m-storage-path">{headPid ?? '—'}</code></div>
          <div><span>Healthy servers</span><span>{health.reachable ? `${servers.length} / ${health.servers.length}` : '—'}</span></div>
        </div>
        {health.error ? <p class="m-note">{health.error}</p> : null}
        {notice ? <p class="m-note" role="status">{notice}</p> : null}
        <div class="m-actions">
          {health.reachable ? (
            <button
              type="button"
              class="secondary"
              hx-post="/ui/settings/gym/stop"
              hx-target="#settings-gym"
              hx-swap="outerHTML"
              hx-confirm="Stop the gym head server and every child it started?"
            >
              Stop gym
            </button>
          ) : (
            <form hx-post="/ui/settings/gym/start" hx-target="#settings-gym" hx-swap="outerHTML" class="m-inline-form">
              <input name="resourcesServer" value={defaultResourcesServer} placeholder="resources-server name" required aria-label="Resources server" />
              <input name="modelType" value={defaultModelType} placeholder="model-type name" aria-label="Model type" />
              <Btn type="submit">Start gym</Btn>
            </form>
          )}
        </div>
        <p class="m-note">
          Stop sends the same SIGINT ladder `gym env start` uses on Ctrl-C, so child servers shut down
          gracefully. Start runs detached from the gym checkout at GYM_ROOT; its log lands in{' '}
          <code>results/lab/gym-env-start.log</code> inside the checkout.
        </p>
      </Panel>

      <Panel title="Gym and lab storage" code="delete">
        <div class="m-storage-list">
          {buckets.map((bucket) => (
            <div class="m-storage-row">
              <span class="m-storage-label">{bucket.label} <Badge state={bucket.owner === 'lab' ? 'ready' : 'pending'}>{bucket.owner}</Badge></span>
              {bucket.resolved
                ? bucket.paths.map((path) => <code class="m-storage-path">{path}</code>)
                : <span class="m-storage-path is-unset">not resolved</span>}
              <span class="m-storage-note">{bucket.resolved ? `${bucket.note} — ${formatBytes(bucket.bytes)}` : 'Start NeMo Gym to resolve this path.'}</span>
              {bucket.resolved
                ? (
                  <button
                    type="button"
                    class="secondary"
                    hx-post="/ui/settings/gym/clear"
                    hx-vals={JSON.stringify({ bucket: bucket.id })}
                    hx-target="#settings-gym"
                    hx-swap="outerHTML"
                    hx-confirm={`Delete the contents of ${bucket.label}? This cannot be undone.`}
                  >
                    Clear
                  </button>
                )
                : null}
              {bucket.resolved && bucket.entries.length > 0
                ? (
                  <details class="m-storage-entries">
                    <summary>{bucket.entries.length} entries</summary>
                    {bucket.entries.map((entry) => (
                      <div class="m-storage-row">
                        <code class="m-storage-path">{entry.name}</code>
                        <span class="m-storage-note">{formatBytes(entry.bytes)}</span>
                        <button
                          type="button"
                          class="secondary"
                          hx-post="/ui/settings/gym/clear"
                          hx-vals={JSON.stringify({ bucket: bucket.id, target: entry.name })}
                          hx-target="#settings-gym"
                          hx-swap="outerHTML"
                          hx-confirm={`Delete ${entry.name} (${formatBytes(entry.bytes)}) permanently?`}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </details>
                )
                : null}
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}
