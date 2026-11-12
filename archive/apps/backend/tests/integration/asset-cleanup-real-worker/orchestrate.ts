import { type AppDeps, createHarness } from './harness';
import { buildReportOutput, computeFinalVerdict } from './report';
import { runScenarioA } from './scenario-a';
import { runScenarioB } from './scenario-b';
import { scenarioCNotRun, scenarioDNotRun } from './scenarios-not-run';
import { runTeardown } from './teardown';
import type { IntegrationReport, IsolatedEnv } from './types';

export type RealWorkerRunResult = {
  output: Record<string, unknown>;
  exitCode: number;
};

export async function runRealWorkerIntegration(input: {
  isolated: IsolatedEnv;
  runId: string;
  prefix: string;
  report: IntegrationReport;
  deps: AppDeps;
}): Promise<RealWorkerRunResult> {
  const { isolated, runId, prefix, report, deps } = input;
  const harness = createHarness({ isolated, runId, prefix, report, deps });

  harness.assertRuntimeIsolation();

  try {
    const canRun = await harness.runRedisDb1Precheck();
    if (canRun) {
      report.devBucketBefore = await harness.countBucketObjects('gloaming-development');
      await harness.startWorker();

      const adminCookie = await harness.createAdminSession();
      harness.logIsolationBanner();

      report.scenarios.push(await runScenarioA(harness, adminCookie));
      report.scenarios.push(await runScenarioB(harness, adminCookie));
      report.scenarios.push(scenarioCNotRun());
      report.scenarios.push(scenarioDNotRun());
    }
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
    if (String(error).includes('BLOCKED')) {
      report.finalVerdict = 'BLOCKED';
    }
  } finally {
    await runTeardown(harness);
  }

  computeFinalVerdict(report, isolated, harness.blockedByRedisPrecheck);

  const output = buildReportOutput({
    report,
    isolated,
    redisDb1EmptyBefore: harness.redisDb1EmptyBefore,
    workerLog: harness.workerLog,
  });

  return {
    output,
    exitCode: report.finalVerdict === 'PASS' ? 0 : 1,
  };
}
