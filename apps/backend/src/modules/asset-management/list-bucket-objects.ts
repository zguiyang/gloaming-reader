import type { ObjectListItem } from '@/lib/oss';
import { listObjects } from '@/modules/oss';

export async function listBucketObjects(input: {
  prefix?: string;
  limit: number;
}): Promise<{ objects: ObjectListItem[]; complete: boolean }> {
  const objects: ObjectListItem[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listObjects(input.prefix, cursor);
    for (const object of page.objects) {
      if (objects.length >= input.limit) {
        return { objects, complete: false };
      }
      objects.push(object);
    }
    if (!page.hasMore || !page.nextCursor) {
      return { objects, complete: true };
    }
    cursor = page.nextCursor;
  }
}
