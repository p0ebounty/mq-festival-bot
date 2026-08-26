import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Пакеты монорепо отдаются как TS-исходники, без пресборки.
  transpilePackages: ['@mq/db', '@mq/config'],

  // Next 16 в dev-режиме отдаёт /_next/* только доверенным origin'ам.
  // Без этого стенд за Traefik получает 403 на чанки и страница не гидрируется
  // (формы «молчат», HMR-сокет падает с 500).
  allowedDevOrigins: ['bot-dev.example.com', 'bot.example.com'],

  // За обратным прокси.
  poweredByHeader: false,
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
