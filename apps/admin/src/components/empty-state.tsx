/**
 * Пустое состояние вместо пустого экрана — требование 30-admin-ui.
 * Пустая таблица без объяснения читается как поломка.
 */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="border-border rounded-lg border border-dashed px-6 py-14 text-center">
      <p className="text-foreground font-medium">{title}</p>
      {hint ? <p className="text-muted-foreground mt-1 text-sm">{hint}</p> : null}
    </div>
  );
}
