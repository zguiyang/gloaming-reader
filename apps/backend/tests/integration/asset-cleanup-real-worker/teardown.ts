import type { RealWorkerHarness } from './harness';
import { redactRedis } from './isolation';

/** Required order: stop Worker → wait → S3 objects → DB rows → Redis/BullMQ. */
export async function runTeardown(harness: RealWorkerHarness): Promise<void> {
  const { prefix, report, deps, createdEmails, workIds, assetIds, uploadedIds, redisKeysCreated } = harness;
  const {
    eq,
    inArray,
    contentAssetTable,
    readingWorkTable,
    uploadedObjectTable,
    userTable,
    db,
    env,
    getRedis,
    closeQueue,
    resetObjectStoreCache,
  } = deps;

  try {
    await harness.stopWorker();
  } catch (error) {
    report.errors.push(`stopWorker: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    await closeQueue();
  } catch (error) {
    report.errors.push(`closeQueue: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    report.remainingPrefixKeys = await harness.listPrefixKeys(prefix);
    if (report.remainingPrefixKeys.length > 0) {
      const removed = await harness.deletePrefixObjects(prefix);
      for (const key of removed) {
        if (!report.teardownDeletedObjectKeys.includes(key)) {
          report.teardownDeletedObjectKeys.push(key);
        }
      }
      report.remainingPrefixKeys = await harness.listPrefixKeys(prefix);
    }
  } catch (error) {
    report.errors.push(`prefix cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    if (assetIds.length > 0) {
      await db.delete(contentAssetTable).where(inArray(contentAssetTable.id, assetIds));
    }
    if (uploadedIds.length > 0) {
      await db.delete(uploadedObjectTable).where(inArray(uploadedObjectTable.id, uploadedIds));
    }
    if (workIds.length > 0) {
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, workIds));
    }
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  } catch (error) {
    report.errors.push(`db cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    if (!harness.blockedByRedisPrecheck) {
      const redis = getRedis();
      if (redactRedis(env.REDIS_URL).db !== '1') {
        report.errors.push('refused Redis cleanup on non-DB-1 connection');
      } else {
        await harness.adoptCurrentRedisKeysAsTracked('before-redis-cleanup');

        const tracked = [...redisKeysCreated];
        report.redis.trackedKeys = tracked;

        const deletedTracked: string[] = [];
        if (tracked.length > 0) {
          const chunkSize = 100;
          for (let i = 0; i < tracked.length; i += chunkSize) {
            const chunk = tracked.slice(i, i + chunkSize);
            const existing: string[] = [];
            for (const key of chunk) {
              if ((await redis.exists(key)) === 1) existing.push(key);
            }
            if (existing.length > 0) {
              await redis.del(...existing);
              deletedTracked.push(...existing);
            }
          }
        }
        report.redis.deletedTrackedKeys = deletedTracked;

        let residualDeleted: string[] = [];
        let leftover = await redis.keys('*');
        if (leftover.length > 0) {
          if (harness.redisDb1EmptyBefore) {
            await redis.del(...leftover);
            residualDeleted = leftover;
            report.redis.flushedEntireDb1 = false;
            report.redis.cleanupMode = 'tracked-then-residual-db1-empty-before';
            leftover = await redis.keys('*');
            if (leftover.length > 0) {
              await redis.flushdb();
              report.redis.flushedEntireDb1 = true;
              residualDeleted = [...new Set([...residualDeleted, ...leftover])];
              leftover = await redis.keys('*');
            }
          } else {
            report.errors.push(
              `redis cleanup refused residual delete; DB 1 was not empty before test. leftover=${leftover.join(', ')}`,
            );
            report.redis.cleanupMode = 'tracked-only';
          }
        } else {
          report.redis.cleanupMode = 'tracked-only';
        }

        report.redis.residualKeysDeleted = residualDeleted;
        report.redis.keyCountAfterCleanup = leftover.length;
        report.redis.leftoverKeysAfterCleanup = leftover;
        if (leftover.length > 0) {
          report.errors.push(`redis leftover keys after cleanup: ${leftover.join(', ')}`);
        }
      }
    } else {
      report.redis.cleanupMode = 'blocked-precheck';
      report.redis.keyCountAfterCleanup = report.redis.keyCountBefore;
    }
  } catch (error) {
    report.errors.push(`redis cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    resetObjectStoreCache();
  } catch (error) {
    report.errors.push(`resetObjectStoreCache: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    report.devBucketAfter = await harness.countBucketObjects('gloaming-development');
  } catch (error) {
    report.errors.push(`dev bucket recount: ${error instanceof Error ? error.message : String(error)}`);
  }
}
