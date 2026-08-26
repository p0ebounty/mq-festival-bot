import type { Metadata } from 'next';
import { ROUTES, type ImageTask } from '@mq/core';
import { settingsService } from '@/lib/db';
import { SettingsView } from './settings-view';

const TASK_LABELS: Record<ImageTask, string> = {
  restyle_photo: 'Фото → профессия',
  transform_world: 'Мир → новый мир',
  text_to_image: 'Картинка по тексту',
};

export const metadata: Metadata = { title: 'Настройки — MQ Bot' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const settings = await settingsService.getAllForAdmin();
  const map = Object.fromEntries(settings.map((s) => [s.key, s]));

  // Маршруты картинок живут в коде (ADR 0006) — сюда отдаём только для показа.
  const routes = (Object.keys(ROUTES) as ImageTask[]).map((task) => ({
    task,
    label: TASK_LABELS[task],
    chain: ROUTES[task].map((m) => ({
      id: m.id,
      label: m.label,
      cost: m.costUsd.standard,
      notes: m.notes,
    })),
  }));

  return <SettingsView initial={map} routes={routes} />;
}
