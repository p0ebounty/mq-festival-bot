'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ImageIcon,
  TargetIcon, LayoutDashboardIcon, MessagesSquareIcon, ScrollTextIcon,
  SettingsIcon, Share2Icon, UsersIcon,
} from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail,
} from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';

const ITEMS = [
  { href: '/', label: 'Дашборд', icon: LayoutDashboardIcon },
  { href: '/users', label: 'Участники', icon: UsersIcon },
  { href: '/dialogs', label: 'Диалоги', icon: MessagesSquareIcon },
  { href: '/generations', label: 'Генерации', icon: ImageIcon },
  { href: '/tasks', label: 'Задания', icon: TargetIcon },
  { href: '/claims', label: 'Репосты', icon: Share2Icon },
  { href: '/audit', label: 'Аудит', icon: ScrollTextIcon },
  { href: '/settings', label: 'Настройки', icon: SettingsIcon },
];

/**
 * Боковое меню.
 *
 * Сворачивается в полоску с иконками; состояние живёт в cookie, поэтому
 * переживает переходы и перезагрузку. Компонент готовый (shadcn sidebar) —
 * там уже есть и мобильный режим со шторкой, и горячая клавиша, и
 * подсказки над иконками в свёрнутом виде.
 */
export function AppSidebar({ env }: { env: 'dev' | 'prod' }) {
  const path = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:px-0">
          <span className="font-heading truncate text-base font-semibold group-data-[collapsible=icon]:hidden">
            MQ&nbsp;Bot
          </span>
          {env === 'dev' && (
            <Badge variant="secondary" className="group-data-[collapsible=icon]:hidden">
              разработка
            </Badge>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {ITEMS.map((it) => {
                // Дашборд подсвечиваем только на точном совпадении: иначе
                // он остаётся активным сразу на всех страницах.
                const active = it.href === '/' ? path === '/' : path.startsWith(it.href);
                return (
                  <SidebarMenuItem key={it.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={it.label}>
                      <Link href={it.href}>
                        <it.icon />
                        <span>{it.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Полоска у края: тянешь — меню сворачивается и разворачивается. */}
      <SidebarRail />
    </Sidebar>
  );
}
