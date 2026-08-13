import { Elysia } from 'elysia';
import * as settings from '../../gym/settings.ts';

function inputOf(body: unknown): settings.SettingInput {
  if (!body || typeof body !== 'object') return {};
  const source = body as Record<string, unknown>;
  const input: settings.SettingInput = {};
  for (const key of [
    'policy_base_url', 'policy_api_key', 'policy_model_name',
    'judge_base_url', 'judge_api_key', 'judge_model_name',
    'analysis_base_url', 'analysis_api_key', 'analysis_model_name',
    'generation_base_url', 'generation_api_key', 'generation_model_name',
    'generation_backend', 'nvidia_data_designer_base_url',
    'nvidia_data_designer_model', 'nvidia_api_key', 'prime_api_key',
  ] as const) {
    if (typeof source[key] === 'string') input[key] = source[key] as string;
  }
  return input;
}

export const settingsApi = new Elysia({ name: 'settings-api' })
  .get('/api/v1/settings', () => settings.read())
  .post('/api/v1/settings', async ({ body, status }) => {
    try {
      return { ok: true, settings: await settings.save(inputOf(body)) };
    } catch (error) {
      return status(500, { error: error instanceof Error ? error.message : 'Unable to save settings.' });
    }
  })
  .post('/api/v1/settings/test', async ({ body, status }) => {
    try {
      return settings.test(inputOf(body));
    } catch (error) {
      return status(500, { error: error instanceof Error ? error.message : 'Unable to test settings.' });
    }
  });
