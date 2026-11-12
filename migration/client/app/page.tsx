import { Button } from '@/components/ui/button';
import { ThemeModeToggle } from '@/components/theme-mode-toggle';

export default function Page() {
  return (
    <main className="container flex min-h-svh flex-col justify-center gap-8 py-16">
      <div className="flex flex-col gap-3">
        <p className="font-heading text-sm font-medium tracking-wide text-muted-foreground">migration/client</p>
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-foreground">Infrastructure smoke</h1>
        <p className="max-w-prose text-muted-foreground">
          Next + shadcn + Gloaming theme tokens are wired. No product pages yet — this shell only proves the extract
          tree can start.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button">Primary</Button>
        <Button type="button" variant="secondary">
          Secondary
        </Button>
        <ThemeModeToggle />
      </div>
    </main>
  );
}
