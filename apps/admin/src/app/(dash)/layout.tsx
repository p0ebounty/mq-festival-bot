import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentAdmin } from '@/lib/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { LogoutButton } from '@/components/logout-button';
import { Nav } from '@/components/nav';
import { LiveUpdates } from '@/components/live-updates';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { env } from '@/lib/env';

export default async function DashLayout({ children }: LayoutProps<'/'>) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/login');

  return (
    <div className="flex min-h-svh flex-col">
      <header className="bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-6 py-3">
          <Link href="/" className="font-heading text-lg font-semibold">
            MQ&nbsp;Bot
          </Link>
          <Badge variant={env.APP_ENV === 'prod' ? 'destructive' : 'secondary'}>
            {env.APP_ENV === 'prod' ? 'production' : 'разработка'}
          </Badge>

          <div className="ml-2 min-w-0 flex-1">
            <Nav />
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <LiveUpdates />
            <span className="text-muted-foreground hidden text-sm sm:inline">
              {admin.displayName ?? admin.login}
            </span>
            <ThemeToggle />
            <Separator orientation="vertical" className="h-6" />
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
