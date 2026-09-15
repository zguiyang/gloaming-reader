import { cn } from '@/lib/utils';

export function UserAvatar({
  image,
  initial,
  sizeClass,
}: {
  image: string | null;
  initial: string;
  sizeClass: string;
}) {
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote avatar URL
      <img
        src={image}
        alt=""
        className={cn(sizeClass, 'shrink-0 rounded-full bg-muted object-cover')}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div
      className={cn(
        sizeClass,
        'flex shrink-0 items-center justify-center rounded-full bg-accent font-medium text-accent-foreground',
      )}
    >
      {initial}
    </div>
  );
}
