import type { Metadata } from 'next';

import { SiteNav } from '@/components/navigation';
import { LandingNavEntrance, LandingPage } from '@/features/landing';

export const metadata: Metadata = {
  title: `Gloaming — 回来，继续读你想读的英文`,
  description: 'Gloaming 是一个为真实英文阅读打造的 AI 阅读环境。它不会打断你的阅读，也不会把阅读变成任务。',
};

export default function Home() {
  return (
    <div className="relative z-10 flex min-h-full flex-1 flex-col">
      <LandingNavEntrance>
        <SiteNav />
      </LandingNavEntrance>
      <LandingPage />
    </div>
  );
}
