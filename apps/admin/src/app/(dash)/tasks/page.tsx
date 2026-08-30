import { listTasks } from '@/lib/queries';
import { TasksTable } from './table';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const rows = await listTasks();
  const works = rows.reduce((n, t) => n + t.works, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Задания</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Картинка и цель, что из неё получить. Работ прислано: {works}.
          Победителя выбирают глазами — откройте задание и сравните работы.
        </p>
      </div>
      <TasksTable
        rows={rows.map((t) => ({
          id: t.id,
          title: t.title,
          taskText: t.taskText,
          mediaId: t.mediaId,
          isActive: t.isActive,
          timesIssued: t.timesIssued,
          works: t.works,
        }))}
      />
    </div>
  );
}
