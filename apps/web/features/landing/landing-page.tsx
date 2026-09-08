import { LandingCta, LandingFooter } from '@/features/landing/landing-close';
import { LandingHero } from '@/features/landing/landing-hero';
import { LandingProduct } from '@/features/landing/landing-product';
import { LandingStory } from '@/features/landing/landing-story';

export function LandingPage() {
  return (
    <>
      <main>
        <LandingHero />
        <LandingStory />
        <LandingProduct />
        <LandingCta />
      </main>
      <LandingFooter />
    </>
  );
}
