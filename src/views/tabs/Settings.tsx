import type { Children } from '@kitajs/html';
import type { PublicSettings } from '../../gym/settings.ts';
import { Badge } from '../ui/Badge.tsx';
import { Btn } from '../ui/Btn.tsx';
import { Field } from '../ui/Field.tsx';
import { Panel } from '../ui/Panel.tsx';

type ProviderProps = {
  title: string;
  baseName?: string;
  baseUrl?: string;
  keyName: string;
  modelName?: string;
  model?: string;
  hasKey: boolean;
  note?: string;
  children?: Children;
};

function Provider({ title, baseName, baseUrl, keyName, modelName, model, hasKey, note, children }: ProviderProps) {
  return (
    <fieldset class="m-settings-group">
      <legend>{title}</legend>
      {baseName ? <Field label="OpenAI-compatible base URL"><input name={baseName} value={baseUrl ?? ''} autocomplete="url" /></Field> : null}
      <Field label="API key" note="Blank keeps the saved key; the key is never returned to the browser.">
        <input name={keyName} type="password" placeholder="Blank keeps current key" autocomplete="new-password" />
      </Field>
      {modelName ? <Field label="Model"><input name={modelName} value={model ?? ''} autocomplete="off" /></Field> : null}
      {note ? <p class="m-note">{note}</p> : null}
      <div class="m-setting-state"><span>Saved credential</span><Badge state={hasKey ? 'ready' : 'pending'}>{hasKey ? 'saved' : 'missing'}</Badge></div>
      {children}
    </fieldset>
  );
}

export function Settings({ settings }: { settings: PublicSettings }) {
  return (
    <>
      <div class="m-title">
        <h2>Provider and platform settings</h2>
        <p>Secrets remain in the repository’s gitignored <code>env.yaml</code> and are never returned to the browser.</p>
      </div>

      <Panel title="Appearance" code="this browser">
        <div class="m-appearance-grid">
          <Field label="Theme">
            <div class="m-segmented" role="group" aria-label="Theme">
              <button type="button" data-set-theme="dark" aria-pressed="false">Dark</button>
              <button type="button" data-set-theme="light" aria-pressed="false">Light</button>
            </div>
          </Field>
          <Field label="Density">
            <div class="m-segmented" role="group" aria-label="Density">
              <button type="button" data-set-density="comfort" aria-pressed="false">Comfort</button>
              <button type="button" data-set-density="compact" aria-pressed="false">Compact</button>
            </div>
          </Field>
        </div>
        <p class="m-note">Appearance is saved locally in this browser and survives HTMX navigation.</p>
      </Panel>

      <form id="settings-form" data-settings-form>
        <Panel title="Endpoints and credentials (OpenAI format)" code="local secret store">
          <div class="m-settings-grid">
            <Provider title="Model under test router" baseName="policy_base_url" baseUrl={settings.policy_base_url} keyName="policy_api_key" modelName="policy_model_name" model={settings.policy_model_name} hasKey={settings.has_policy_key} />
            <Provider title="Benchmark judge" baseName="judge_base_url" baseUrl={settings.judge_base_url} keyName="judge_api_key" modelName="judge_model_name" model={settings.judge_model_name} hasKey={settings.has_judge_key} />
            <Provider title="Failure analyst" baseName="analysis_base_url" baseUrl={settings.analysis_base_url} keyName="analysis_api_key" modelName="analysis_model_name" model={settings.analysis_model_name} hasKey={settings.has_analysis_key} note="Blank key and model fall back to the benchmark judge settings." />
            <Provider title="Frontier synthetic data generation API" baseName="generation_base_url" baseUrl={settings.generation_base_url} keyName="generation_api_key" modelName="generation_model_name" model={settings.generation_model_name} hasKey={settings.has_generation_key} note="Shared by the recommended NVIDIA Data Designer path and the direct frontier fallback.">
              <Field label="Generation backend">
                <select name="generation_backend">
                  <option value="data_designer" selected={settings.generation_backend === 'data_designer'}>NVIDIA Data Designer</option>
                  <option value="frontier" selected={settings.generation_backend === 'frontier'}>Direct frontier model</option>
                </select>
              </Field>
              <div class="m-setting-state"><span>Data Designer credential</span><Badge state={settings.has_nvidia_key ? 'ready' : 'pending'}>{settings.has_nvidia_key ? 'saved' : 'missing'}</Badge></div>
            </Provider>
            <Provider title="Prime Intellect" keyName="prime_api_key" hasKey={settings.has_prime_key} note="Used for optional publishing and cluster dispatch." />
          </div>
          <div class="m-actions">
            <Btn type="submit">Save settings</Btn>
            <Btn type="button" class="secondary" data-settings-test>Test APIs</Btn>
          </div>
          <p class="m-note">Tests use current form values without saving them. Model tests send one eight-token completion and may incur minimal provider usage.</p>
          <div id="settings-test-results" class="m-api-results" aria-live="polite" />
        </Panel>
      </form>

      <Panel title="Platform preflight" code="local">
        <div class="m-status-list">
          <div><span>Secret store</span><Badge state={settings.status.env_file}>{settings.status.env_file}</Badge></div>
          <div><span>NeMo Gym CLI</span><Badge state={settings.status.gym_cli}>{settings.status.gym_cli}</Badge></div>
          <div><span>Data Designer</span><Badge state={settings.status.data_designer}>{settings.status.data_designer}</Badge></div>
          <div><span>Prime CLI</span><Badge state={settings.status.prime_cli === 'ready' ? 'ready' : 'pending'}>{settings.status.prime_cli}</Badge></div>
        </div>
      </Panel>
    </>
  );
}
