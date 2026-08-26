import type { Metadata } from 'next';
import { settingsService } from '@/lib/db';
import { SettingsView } from './settings-view';

export const metadata: Metadata = { title: 'Настройки — MQ Bot' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const settings = await settingsService.getAllForAdmin();
  const map = Object.fromEntries(settings.map((s) => [s.key, s]));
  return <SettingsView initial={map} />;
}
