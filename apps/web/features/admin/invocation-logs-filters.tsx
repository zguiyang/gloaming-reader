'use client';

import { CalendarIcon } from 'lucide-react';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs } from '@/components/ui/tabs';
import { getAdminDayPickerLocale } from '@/features/admin/admin-logs-format';
import { AdminSegmentedTabsList, AdminSegmentedTabsTrigger } from '@/features/admin/admin-segmented-tabs';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

/** Neutral Admin logs filter presets; domain window helpers stay on each page. */
export const INVOCATION_LOGS_PRESET_DAYS = [3, 7, 15, 30] as const;
export type InvocationLogsPresetDays = (typeof INVOCATION_LOGS_PRESET_DAYS)[number];

export type InvocationLogsRangePreset = `${InvocationLogsPresetDays}` | 'custom';
export type InvocationLogsStatusFilter = 'all' | 'success' | 'failure';

export type InvocationLogsRange = {
  from: Date;
  to: Date;
};

type InvocationLogsFiltersProps = {
  rangeTab: InvocationLogsRangePreset;
  range: InvocationLogsRange;
  status: InvocationLogsStatusFilter;
  /** Domain-owned window strategy (AI / TTS / future invocation logs). */
  windowForDays: (days: InvocationLogsPresetDays) => InvocationLogsRange;
  onRangeTabChange: (tab: InvocationLogsRangePreset) => void;
  onRangeChange: (range: InvocationLogsRange) => void;
  onStatusChange: (status: InvocationLogsStatusFilter) => void;
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateTimeLabel(date: Date, locale: Parameters<typeof getAdminDayPickerLocale>[0]): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function toTimeValue(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function mergeDateKeepingTime(day: Date, timeSource: Date): Date {
  const next = new Date(day);
  next.setHours(timeSource.getHours(), timeSource.getMinutes(), timeSource.getSeconds(), timeSource.getMilliseconds());
  return next;
}

function applyClock(date: Date, timeValue: string): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function orderedRange(from: Date, to: Date): InvocationLogsRange {
  return from.getTime() <= to.getTime() ? { from, to } : { from: to, to: from };
}

type DateTimeEndpointProps = {
  id: string;
  label: string;
  value: Date;
  onChange: (next: Date) => void;
};

function DateTimeEndpoint({ id, label, value, onChange }: DateTimeEndpointProps) {
  const { locale } = useLocale();

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            className={cn(
              'h-full min-h-0 min-w-[11.5rem] flex-1 justify-start rounded-xl border-0 bg-card px-3 font-normal shadow-card',
              'hover:bg-card hover:text-foreground',
              'aria-expanded:bg-card aria-expanded:text-foreground',
            )}
          />
        }
      >
        <span className="sr-only">{label}</span>
        <CalendarIcon data-icon="inline-start" className="text-muted-foreground" />
        <span className="truncate tabular-nums text-foreground">{formatDateTimeLabel(value, locale)}</span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto gap-0 overflow-hidden rounded-2xl p-0 shadow-card ring-1 ring-foreground/10"
      >
        <Calendar
          mode="single"
          locale={getAdminDayPickerLocale(locale)}
          defaultMonth={value}
          selected={value}
          onSelect={(day) => {
            if (!day) {
              return;
            }
            onChange(mergeDateKeepingTime(day, value));
          }}
        />
        <div className="flex items-center gap-2 border-t border-border bg-secondary/50 px-3 py-2.5">
          <label className="shrink-0 text-xs text-muted-foreground" htmlFor={id}>
            {t(locale, 'admin.logs.filters.timeLabel')}
          </label>
          <Input
            id={id}
            type="time"
            step={60}
            className="h-8 flex-1 rounded-xl bg-card tabular-nums"
            value={toTimeValue(value)}
            onChange={(event) => {
              const parsed = applyClock(value, event.target.value);
              if (!parsed) {
                return;
              }
              onChange(parsed);
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function InvocationLogsFilters({
  rangeTab,
  range,
  status,
  windowForDays,
  onRangeTabChange,
  onRangeChange,
  onStatusChange,
}: InvocationLogsFiltersProps) {
  const { locale } = useLocale();

  const statusFilters: { value: InvocationLogsStatusFilter; label: string }[] = [
    { value: 'all', label: t(locale, 'admin.logs.filters.statusAll') },
    { value: 'success', label: t(locale, 'admin.logs.filters.statusSuccess') },
    { value: 'failure', label: t(locale, 'admin.logs.filters.statusFailure') },
  ];

  function applyPreset(days: InvocationLogsPresetDays) {
    onRangeTabChange(String(days) as InvocationLogsRangePreset);
    onRangeChange(windowForDays(days));
  }

  function applyFrom(next: Date) {
    onRangeTabChange('custom');
    onRangeChange(orderedRange(next, range.to));
  }

  function applyTo(next: Date) {
    onRangeTabChange('custom');
    onRangeChange(orderedRange(range.from, next));
  }

  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
        <Tabs
          value={rangeTab}
          className="w-fit"
          onValueChange={(value) => {
            if (value === 'custom') {
              onRangeTabChange('custom');
              return;
            }
            if (value === '3' || value === '7' || value === '15' || value === '30') {
              applyPreset(Number(value) as InvocationLogsPresetDays);
            }
          }}
        >
          <AdminSegmentedTabsList aria-label={t(locale, 'admin.logs.filters.rangePresetAria')}>
            {INVOCATION_LOGS_PRESET_DAYS.map((days) => (
              <AdminSegmentedTabsTrigger key={days} value={String(days)} className="px-3.5">
                {t(locale, 'admin.logs.filters.presetDays', { days })}
              </AdminSegmentedTabsTrigger>
            ))}
            <AdminSegmentedTabsTrigger value="custom" className="px-3.5">
              {t(locale, 'admin.logs.filters.custom')}
            </AdminSegmentedTabsTrigger>
          </AdminSegmentedTabsList>
        </Tabs>

        {rangeTab === 'custom' ? (
          <div className="flex h-[3.25rem] min-w-0 max-w-2xl flex-1 items-center rounded-xl bg-muted/80 p-1.5">
            <DateTimeEndpoint
              id="invocation-logs-from-time"
              label={t(locale, 'admin.logs.filters.startTime')}
              value={range.from}
              onChange={applyFrom}
            />
            <span className="shrink-0 px-2 text-sm text-muted-foreground">
              {t(locale, 'admin.logs.filters.rangeSeparator')}
            </span>
            <DateTimeEndpoint
              id="invocation-logs-to-time"
              label={t(locale, 'admin.logs.filters.endTime')}
              value={range.to}
              onChange={applyTo}
            />
          </div>
        ) : null}
      </div>

      <Tabs
        value={status}
        className="w-fit"
        onValueChange={(value) => {
          if (value !== 'all' && value !== 'success' && value !== 'failure') {
            return;
          }
          onStatusChange(value);
        }}
      >
        <AdminSegmentedTabsList aria-label={t(locale, 'admin.logs.filters.statusFilterAria')}>
          {statusFilters.map((item) => (
            <AdminSegmentedTabsTrigger key={item.value} value={item.value}>
              {item.label}
            </AdminSegmentedTabsTrigger>
          ))}
        </AdminSegmentedTabsList>
      </Tabs>
    </div>
  );
}
