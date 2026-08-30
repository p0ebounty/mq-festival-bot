import { listTasks, listTaskWorks } from '@/lib/queries';
import { TasksView } from './view';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const [tasks, works] = await Promise.all([listTasks(), listTaskWorks()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Задания</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Картинка и цель, что из неё получить. Победителя выбирают глазами —
          сравнивать имеет смысл работы по одному и тому же заданию.
        </p>
      </div>
      <TasksView
        tasks={tasks.map((t) => ({
          id: t.id,
          title: t.title,
          taskText: t.taskText,
          mediaId: t.mediaId,
          isActive: t.isActive,
          timesIssued: t.timesIssued,
          works: t.works,
        }))}
        works={works.map((w) => ({
          id: w.id,
          taskId: w.taskId,
          taskText: w.taskText,
          taskTitle: w.taskTitle,
          userPrompt: w.userPrompt,
          createdAt: w.createdAt.toISOString(),
          mediaId: w.mediaId,
          userId: w.userId,
          firstName: w.firstName,
          username: w.username,
        }))}
      />
    </div>
  );
}
