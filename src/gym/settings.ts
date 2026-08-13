import { existsSync } from 'node:fs';
import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config, gymBin } from '../config.ts';

const ENV_PATH = resolve(config.gym.root, 'env.yaml');
const DATA_DESIGNER_PYTHON = resolve(
  config.gym.root,
  'recursive_workspace/.data-designer-venv/bin/python',
);

const SETTING_KEYS = [
  'policy_base_url',
  'policy_api_key',
  'policy_model_name',
  'judge_base_url',
  'judge_api_key',
  'judge_model_name',
  'analysis_base_url',
  'analysis_api_key',
  'analysis_model_name',
  'generation_base_url',
  'generation_api_key',
  'generation_model_name',
  'generation_backend',
  'nvidia_data_designer_base_url',
  'nvidia_data_designer_model',
  'nvidia_api_key',
  'prime_api_key',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];
export type SettingInput = Partial<Record<SettingKey, string>>;
type SavedSettings = Record<string, string>;

export type PublicSettings = {
  policy_base_url: string;
  policy_model_name: string;
  has_policy_key: boolean;
  judge_base_url: string;
  judge_model_name: string;
  has_judge_key: boolean;
  analysis_base_url: string;
  analysis_model_name: string;
  has_analysis_key: boolean;
  generation_base_url: string;
  generation_model_name: string;
  generation_backend: 'data_designer' | 'frontier';
  has_generation_key: boolean;
  has_nvidia_key: boolean;
  has_prime_key: boolean;
  status: {
    env_file: 'ready' | 'missing';
    gym_cli: 'ready' | 'missing';
    data_designer: 'ready' | 'missing';
    prime_cli: 'ready' | 'not installed';
  };
};

export type ApiTestResult = {
  id: string;
  label: string;
  status: 'ok' | 'error' | 'skipped';
  latency_ms: number | null;
  detail: string;
};

async function readSaved(): Promise<SavedSettings> {
  let text = '';
  try {
    text = await readFile(ENV_PATH, 'utf8');
  } catch {
    return {};
  }
  const values: SavedSettings = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (!key || !raw) continue;
    const value = raw.trim();
    values[key] =
      value.length >= 2 && value.startsWith('"') && value.endsWith('"')
        ? value.slice(1, -1).replaceAll('\\"', '"').replaceAll('\\\\', '\\')
        : value.replace(/^'(.*)'$/, '$1');
  }
  return values;
}

function publicSettings(values: SavedSettings): PublicSettings {
  return {
    policy_base_url: values.policy_base_url || 'https://openrouter.ai/api/v1',
    policy_model_name: values.policy_model_name || '',
    has_policy_key: Boolean(values.policy_api_key),
    judge_base_url: values.judge_base_url || 'https://openrouter.ai/api/v1',
    judge_model_name: values.judge_model_name || '',
    has_judge_key: Boolean(values.judge_api_key),
    analysis_base_url: values.analysis_base_url || values.judge_base_url || 'https://openrouter.ai/api/v1',
    analysis_model_name: values.analysis_model_name || values.judge_model_name || '',
    has_analysis_key: Boolean(values.analysis_api_key || values.judge_api_key),
    generation_base_url:
      values.generation_base_url || values.nvidia_data_designer_base_url || values.policy_base_url || 'https://openrouter.ai/api/v1',
    generation_model_name:
      values.generation_model_name || values.nvidia_data_designer_model || values.policy_model_name || '',
    generation_backend: values.generation_backend === 'frontier' ? 'frontier' : 'data_designer',
    has_generation_key: Boolean(values.generation_api_key || values.nvidia_api_key || values.policy_api_key),
    has_nvidia_key: Boolean(values.nvidia_api_key),
    has_prime_key: Boolean(values.prime_api_key),
    status: {
      env_file: existsSync(ENV_PATH) ? 'ready' : 'missing',
      gym_cli: existsSync(gymBin()) ? 'ready' : 'missing',
      data_designer: existsSync(DATA_DESIGNER_PYTHON) ? 'ready' : 'missing',
      prime_cli: ['/usr/local/bin/prime', '/usr/bin/prime'].some(existsSync)
        ? 'ready'
        : 'not installed',
    },
  };
}

export async function read(): Promise<PublicSettings> {
  return publicSettings(await readSaved());
}

export async function save(input: SettingInput): Promise<PublicSettings> {
  const values = await readSaved();
  for (const key of SETTING_KEYS) {
    const value = input[key]?.trim();
    if (value) values[key] = value;
  }

  const tempPath = `${ENV_PATH}.${process.pid}.tmp`;
  const text = Object.entries(values)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');
  try {
    await writeFile(tempPath, `${text}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(tempPath, 0o600);
    await rename(tempPath, ENV_PATH);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
  return publicSettings(values);
}

function pick(values: SettingInput, saved: SavedSettings, ...keys: string[]) {
  for (const key of keys) {
    const candidate = values[key as SettingKey]?.trim() || saved[key]?.trim();
    if (candidate) return candidate;
  }
  return '';
}

async function testProvider(
  id: string,
  label: string,
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<ApiTestResult> {
  if (!apiKey) return { id, label, status: 'skipped', latency_ms: null, detail: 'API key is not configured.' };
  if (!model) return { id, label, status: 'skipped', latency_ms: null, detail: 'Model is not configured.' };
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 8 }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      return { id, label, status: 'error', latency_ms: Math.round(performance.now() - started), detail: `HTTP ${response.status}` };
    }
    const result = (await response.json()) as { choices?: unknown[] };
    if (!Array.isArray(result.choices) || result.choices.length === 0) throw new Error('Provider returned no completion choices.');
    return { id, label, status: 'ok', latency_ms: Math.round(performance.now() - started), detail: `${model} responded.` };
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 180) : 'Connection failed.';
    return { id, label, status: 'error', latency_ms: Math.round(performance.now() - started), detail };
  }
}

export async function test(input: SettingInput) {
  const saved = await readSaved();
  const results = await Promise.all([
    testProvider('policy', 'Model under test router', pick(input, saved, 'policy_base_url') || 'https://openrouter.ai/api/v1', pick(input, saved, 'policy_api_key'), pick(input, saved, 'policy_model_name')),
    testProvider('judge', 'Benchmark judge', pick(input, saved, 'judge_base_url') || 'https://openrouter.ai/api/v1', pick(input, saved, 'judge_api_key'), pick(input, saved, 'judge_model_name')),
    testProvider('analysis', 'Failure analyst', pick(input, saved, 'analysis_base_url', 'judge_base_url') || 'https://openrouter.ai/api/v1', pick(input, saved, 'analysis_api_key', 'judge_api_key'), pick(input, saved, 'analysis_model_name', 'judge_model_name')),
    testProvider('generation', 'Frontier synthetic data generation API', pick(input, saved, 'generation_base_url', 'nvidia_data_designer_base_url', 'policy_base_url') || 'https://openrouter.ai/api/v1', pick(input, saved, 'generation_api_key', 'nvidia_api_key', 'policy_api_key'), pick(input, saved, 'generation_model_name', 'nvidia_data_designer_model', 'policy_model_name')),
  ]);
  return {
    results,
    summary: {
      ok: results.filter((result) => result.status === 'ok').length,
      error: results.filter((result) => result.status === 'error').length,
      skipped: results.filter((result) => result.status === 'skipped').length,
    },
  };
}
