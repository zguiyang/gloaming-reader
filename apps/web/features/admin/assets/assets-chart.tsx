'use client';

import { Cell, Pie, PieChart } from 'recharts';

import type { AssetCategorySummary } from '@gloaming/shared/assets';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { buildCategoryChartData, formatStorageBytes } from '@/features/admin/assets/assets-format';

type AssetsChartProps = {
  categories: AssetCategorySummary[];
};

export function AssetsChart({ categories }: AssetsChartProps) {
  const data = buildCategoryChartData(categories);
  const config = Object.fromEntries(
    data.map((entry) => [entry.category, { label: entry.label, color: entry.fill }]),
  ) satisfies ChartConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle>容量构成</CardTitle>
        <CardDescription>按对象分类汇总本次扫描占用</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-muted-foreground text-sm">暂无分类数据</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
            <ChartContainer config={config} className="mx-auto aspect-square h-56 w-full max-w-xs">
              <PieChart>
                <ChartTooltip
                  content={
                    <ChartTooltipContent nameKey="category" formatter={(value) => formatStorageBytes(Number(value))} />
                  }
                />
                <Pie data={data} dataKey="bytes" nameKey="category" innerRadius={52} outerRadius={80} strokeWidth={2}>
                  {data.map((entry) => (
                    <Cell key={entry.category} fill={entry.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <ul className="space-y-2 text-sm">
              {data.map((entry) => (
                <li key={entry.category} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: entry.fill }} />
                    {entry.label}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatStorageBytes(entry.bytes)} · {entry.objectCount} 个
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
