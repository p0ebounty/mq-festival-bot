import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth';

export default async function Home() {
  const admin = await getCurrentAdmin();
  redirect(admin ? '/settings' : '/login');
}
