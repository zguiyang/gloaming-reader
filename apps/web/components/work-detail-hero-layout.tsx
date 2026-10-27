import type { ReactNode } from 'react';

export function WorkDetailHeroLayout({ cover, children }: { cover: ReactNode; children: ReactNode }) {
  return (
    <section className="grid grid-cols-1 items-center gap-8 md:grid-cols-12 md:gap-12 lg:gap-16">
      <div className="flex justify-center md:col-span-4 md:justify-start lg:col-span-3">{cover}</div>
      <div className="space-y-5 text-center md:col-span-8 md:space-y-6 md:text-left lg:col-span-9">{children}</div>
    </section>
  );
}
