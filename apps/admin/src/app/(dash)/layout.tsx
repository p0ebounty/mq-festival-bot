import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getCurrentAdmin } from '@/lib/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { LogoutButton } from '@/components/logout-button';
import { AppSidebar } from '@/components/app-sidebar';
import { LiveUpdates } from '@/components/live-updates';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { env } from '@/lib/env';

export default async function DashLayout({ children }: LayoutProps<'/'>) {
  // Значение не рисуем: имя администратора в шапке ничего не сообщало,
  // аккаунт всё равно один. Проверка входа при этом обязательна.
  if (!(await getCurrentAdmin())) redirect('/login');

  // Состояние меню читаем на сервере: иначе при загрузке страницы оно на
  // мгновение раскрывается и тут же схлопывается.
  const store = await cookies();
  const defaultOpen = store.get('sidebar_state')?.value !== 'false';

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar env={env.APP_ENV} />

      <SidebarInset className="min-w-0">
        <header className="bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b px-4 backdrop-blur">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <div className="ml-auto flex items-center gap-3">
            <LiveUpdates />
            <ThemeToggle />
            <Separator orientation="vertical" className="h-5" />
            <LogoutButton />
          </div>
        </header>

        <main className="w-full min-w-0 flex-1 px-6 py-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
