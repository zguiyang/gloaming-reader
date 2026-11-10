import { LandingBoundaries } from '@/features/landing/landing-boundaries';
import { LandingCta, LandingFooter } from '@/features/landing/landing-close';
import { LandingOpening } from '@/features/landing/landing-opening';
import { LandingProblem } from '@/features/landing/landing-problem';
import { LandingSolution } from '@/features/landing/landing-solution';

export function LandingPage() {
  return (
    <>
      <main>
        <LandingOpening />
        <LandingProblem />
        <LandingSolution />
        <LandingBoundaries />
        <LandingCta />
      </main>
      <LandingFooter />
    </>
  );
}
