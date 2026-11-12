'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type SecretFieldCopy = {
  /** Label of the editable replacement input (e.g. "New key"). */
  replaceLabel: string;
  /** Text action that opens the replacement input (e.g. "Replace key"). */
  replaceAction: string;
  /** Text action that closes the replacement and clears only the key draft. */
  cancelReplaceAction: string;
  /** Hint under the replacement input (e.g. "Leave blank to keep the current key"). */
  keepHint: string;
  /** Explicit saved-state name shown in the summary row (e.g. "Configured"). */
  configuredLabel: string;
};

export type SecretFieldProps = {
  id: string;
  label: string;
  /** Whether a secret is already saved on the server. */
  isSet: boolean;
  /** Static masked summary of the saved secret; never editable. */
  masked: string | null | undefined;
  /** Draft value of the replacement input; always '' until the user types. */
  value: string;
  onChange: (value: string) => void;
  /** Whether the replacement input is currently open. */
  replacing: boolean;
  onReplace: () => void;
  onCancelReplace: () => void;
  error?: string;
  className?: string;
  /** Disables the actions and input while a save is pending. */
  disabled?: boolean;
  copy: SecretFieldCopy;
  placeholderWhenSet?: string;
  autoComplete?: string;
};

/**
 * Saved-secret pattern: a read-only masked summary with an explicit
 * "replace" entry. The summary row stays visible while the replacement input
 * is open, so the configured state is never lost. The replacement input opens
 * only on request, is always empty initially, and submitting it empty
 * preserves the saved key. Cancelling the replacement clears only the key
 * draft. The masked summary is display text and can never become part of a
 * payload.
 */
export function SecretField({
  id,
  label,
  isSet,
  masked,
  value,
  onChange,
  replacing,
  onReplace,
  onCancelReplace,
  error,
  className,
  disabled = false,
  copy,
  placeholderWhenSet,
  autoComplete = 'new-password',
}: SecretFieldProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const hintId = `${id}-keep-hint`;
  const errorId = `${id}-error`;
  const hasError = Boolean(error);
  const describedBy = [hasError ? errorId : null, isSet && replacing ? hintId : null].filter(Boolean).join(' ');

  // Focus the replacement input when the user opens it.
  React.useEffect(() => {
    if (isSet && replacing) {
      inputRef.current?.focus();
    }
  }, [isSet, replacing]);

  return (
    <Field className={className}>
      {isSet ? (
        <>
          {/* Static saved-state label + summary; never an editable control. */}
          <FieldLabel>{label}</FieldLabel>
          <div
            className={cn(
              'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface-container px-3 py-2',
              hasError && 'border-destructive',
            )}
          >
            <span className="truncate text-sm text-foreground">
              {masked ? `${copy.configuredLabel} · ${masked}` : copy.configuredLabel}
            </span>
            {!replacing ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="shrink-0 px-0"
                disabled={disabled}
                aria-describedby={hasError ? errorId : undefined}
                onClick={onReplace}
              >
                {copy.replaceAction}
              </Button>
            ) : null}
          </div>
          {replacing ? (
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={id}>{copy.replaceLabel}</FieldLabel>
              <Input
                ref={inputRef}
                id={id}
                type="password"
                appearance="filled"
                className="h-11"
                disabled={disabled}
                autoComplete={autoComplete}
                aria-invalid={hasError || undefined}
                aria-describedby={describedBy || undefined}
                value={value}
                placeholder={placeholderWhenSet}
                onChange={(event) => onChange(event.target.value)}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldDescription id={hintId} className="m-0">
                  {copy.keepHint}
                </FieldDescription>
                <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onCancelReplace}>
                  {copy.cancelReplaceAction}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            ref={inputRef}
            id={id}
            type="password"
            appearance="filled"
            className="h-11"
            disabled={disabled}
            autoComplete={autoComplete}
            aria-invalid={hasError || undefined}
            aria-describedby={hasError ? errorId : undefined}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </>
      )}
      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  );
}
