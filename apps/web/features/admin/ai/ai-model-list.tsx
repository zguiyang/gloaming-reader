'use client';

import { Pencil, Trash2 } from 'lucide-react';

import { t } from '@gloaming/i18n';
import type { LlmModel, LlmProvider } from '@gloaming/shared/llm';
import { getWireFamilyDefinition, getWireVariantLabel } from '@gloaming/shared/llm';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLocale } from '@/lib/locale-context';

type AiModelListProps = {
  provider: LlmProvider;
  models: LlmModel[];
  onEdit: (model: LlmModel) => void;
  onDelete: (model: LlmModel) => void;
};

export function AiModelList({ provider, models, onEdit, onDelete }: AiModelListProps) {
  const { locale } = useLocale();
  const familyDef = getWireFamilyDefinition(provider.apiFamily);

  if (models.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">{t(locale, 'admin.ai.provider.modelList.empty')}</p>
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t(locale, 'admin.ai.provider.modelList.displayName')}</TableHead>
              <TableHead>{t(locale, 'admin.ai.provider.modelList.modelId')}</TableHead>
              <TableHead>{t(locale, 'admin.ai.provider.modelList.apiMode')}</TableHead>
              <TableHead>{t(locale, 'admin.ai.provider.modelList.status')}</TableHead>
              <TableHead className="text-right">{t(locale, 'admin.content.common.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((model) => (
              <TableRow key={model.id}>
                <TableCell className="font-medium">{model.label}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{model.modelId}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-normal">
                    {getWireVariantLabel(provider.apiFamily, model.wireVariant)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={model.isEnabled ? 'secondary' : 'outline'}>
                    {model.isEnabled
                      ? t(locale, 'admin.ai.provider.modelList.enabled')
                      : t(locale, 'admin.ai.provider.modelList.disabled')}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 rounded-xl"
                      aria-label={t(locale, 'admin.ai.provider.modelList.editAria', { label: model.label })}
                      onClick={() => onEdit(model)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 rounded-xl text-destructive hover:text-destructive"
                      aria-label={t(locale, 'admin.ai.provider.modelList.deleteAria', { label: model.label })}
                      onClick={() => onDelete(model)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">
        {models.map((model) => (
          <li key={model.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{model.label}</p>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{model.modelId}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="outline" className="font-normal">
                    {getWireVariantLabel(provider.apiFamily, model.wireVariant)}
                  </Badge>
                  <Badge variant={model.isEnabled ? 'secondary' : 'outline'}>
                    {model.isEnabled
                      ? t(locale, 'admin.ai.provider.modelList.enabled')
                      : t(locale, 'admin.ai.provider.modelList.disabled')}
                  </Badge>
                  {!familyDef.runtimeImplemented ? (
                    <Badge variant="outline" className="text-xs font-normal">
                      {t(locale, 'admin.ai.provider.runtimeNotSupported')}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-xl"
                  aria-label={t(locale, 'admin.ai.provider.modelList.editAria', { label: model.label })}
                  onClick={() => onEdit(model)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-xl text-destructive hover:text-destructive"
                  aria-label={t(locale, 'admin.ai.provider.modelList.deleteAria', { label: model.label })}
                  onClick={() => onDelete(model)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
