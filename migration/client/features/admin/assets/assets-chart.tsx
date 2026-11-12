'use client';

import { Cell, Pie, PieChart } from 'recharts';

import { t } from '@gloaming/i18n';
import type { AssetCategorySummary } from '@gloaming/shared/assets';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { buildCategoryChartData, formatStorageBytes } from '@/features/admin/assets/assets-format';
import { useLocale } from '@/lib/locale-context';

type AssetsChartProps = {
  categories: AssetCategorySummary[];
};

export function AssetsChart({ categories }: AssetsChartProps) {
  const { locale } = useLocale();
  const data = buildCategoryChartData(categories, locale);
  const config = Object.fromEntries(
    data.map((entry) => [entry.category, { label: entry.label, color: entry.fill }]),
  ) satisfies ChartConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(locale, 'admin.assets.chart.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t(locale, 'admin.assets.chart.empty')}</p>
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
                    {t(locale, 'admin.assets.chart.legend', {
                      bytes: formatStorageBytes(entry.bytes),
                      count: entry.objectCount,
                    })}
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
