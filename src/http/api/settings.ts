import { Elysia } from 'elysia';
import * as settings from '../../gym/settings.ts';
import { recordBody } from '../request.ts';

function inputOf(body: unknown): settings.SettingInput {
  const source = recordBody(body);
  const input: settings.SettingInput = {};
  for (const key of settings.SETTING_KEYS) {
    if (typeof source[key] === 'string') input[key] = source[key];
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
