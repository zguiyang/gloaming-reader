/**
 * Opt-in tonal "filled" appearance for editable controls (Input, Textarea,
 * SelectTrigger, InputGroup/Combobox). Default (outline) appearance stays
 * unchanged everywhere; scoped settings/admin config pages opt in per control.
 *
 * Colors come only from existing semantic tokens: `surface-container` is the
 * filled default in both themes, `surface-container-low` the disabled surface,
 * `ring`/`destructive` the focus and error signals. Focus keeps a visible ring
 * plus offset (gap) instead of a subtle background shift. Forced-colors mode
 * falls back to system borders and a system focus outline.
 *
 * Read-only styling is intentionally NOT part of this shared list: CSS
 * `:read-only` also matches non-editable elements such as buttons and selects,
 * so read-only edge/text styles are applied only on the actual input/textarea
 * primitives (see input.tsx / textarea.tsx).
 *
 * Height variants use the Select `data-size` modifiers so they beat the built-in
 * `data-[size=default]:h-8` specificity; compact consumers keep `size="sm"`.
 */
export const controlFilledClasses = [
  // Default: tonal fill, no visible edge; accepted 8px corners (the global
  // --radius makes plain rounded-lg 12px, so the filled recipe pins 8px).
  'rounded-[8px]',
  'border-transparent',
  'bg-surface-container',
  'dark:bg-surface-container',
  'dark:hover:bg-surface-container',
  // Focus: keep the fill, add a 2px ring with an offset gap.
  'focus-visible:ring-2',
  'focus-visible:ring-ring',
  'focus-visible:ring-offset-2',
  'focus-visible:ring-offset-background',
  // Error: edge + ring; field text is preserved by the browser.
  'aria-invalid:border-destructive',
  'aria-invalid:ring-2',
  'aria-invalid:ring-destructive/20',
  'dark:aria-invalid:border-destructive/50',
  'dark:aria-invalid:ring-destructive/40',
  // Error + focus together: the combined variant outranks both single-state
  // rules, so the focus ring color wins over the invalid ring tint and focus
  // stays clearly visible on an invalid field.
  'aria-invalid:focus-visible:ring-ring',
  'dark:aria-invalid:focus-visible:ring-ring',
  // Disabled: neutral surface and secondary text, still legible.
  'disabled:border-transparent',
  'disabled:bg-surface-container-low',
  'dark:disabled:bg-surface-container-low',
  'disabled:text-muted-foreground',
  'disabled:opacity-100',
  // Forced colors: system border and system focus outline.
  'forced-colors:border',
  'forced-colors:[border-color:CanvasText]',
  'forced-colors:bg-transparent',
  'forced-colors:disabled:[border-color:GrayText]',
  'forced-colors:focus-visible:outline-2',
  'forced-colors:focus-visible:outline-offset-2',
  'forced-colors:focus-visible:outline-[Highlight]',
  'forced-colors:focus-visible:outline-solid',
].join(' ');

/**
 * Read-only edge for actual enabled readonly inputs only. The bare `:read-only`
 * pseudo-class also matches disabled inputs (and non-editable elements), so an
 * explicit `[readonly]:enabled` attribute/state selector keeps the disabled
 * neutral surface and secondary text winning on disabled controls.
 */
export const filledReadOnlyClasses = [
  '[&[readonly]:enabled]:border-border',
  '[&[readonly]:enabled]:text-foreground',
].join(' ');

/** Filled SelectTrigger sizing: 44px default, 36px sm (compact filters). */
export const filledSelectHeightClasses = ['data-[size=default]:h-11', 'data-[size=sm]:h-9'].join(' ');

/**
 * Filled InputGroup/Combobox focus/disabled/invalid layer. The group container
 * (not the inner input) draws the edge and ring, so the filled recipe must use
 * the container-level `has-[]` selectors with a 2px ring + offset gap.
 */
export const filledInputGroupClasses = [
  'has-[[data-slot=input-group-control]:focus-visible]:border-transparent',
  'has-[[data-slot=input-group-control]:focus-visible]:ring-2',
  'has-[[data-slot=input-group-control]:focus-visible]:ring-ring',
  'has-[[data-slot=input-group-control]:focus-visible]:ring-offset-2',
  'has-[[data-slot=input-group-control]:focus-visible]:ring-offset-background',
  'has-[[data-slot][aria-invalid=true]]:border-destructive',
  'has-[[data-slot][aria-invalid=true]]:ring-2',
  'has-[[data-slot][aria-invalid=true]]:ring-destructive/20',
  'dark:has-[[data-slot][aria-invalid=true]]:border-destructive/50',
  'dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40',
  // Error + focus together on the child control: focus ring color wins.
  'has-[[data-slot=input-group-control][aria-invalid=true]:focus-visible]:ring-ring',
  'dark:has-[[data-slot=input-group-control][aria-invalid=true]:focus-visible]:ring-ring',
  'has-disabled:border-transparent',
  'has-disabled:bg-surface-container-low',
  'dark:has-disabled:bg-surface-container-low',
  'has-disabled:opacity-100',
].join(' ');

/** Filled styling for raw `<select>` elements that cannot take SelectTrigger. */
export const nativeSelectFilledClasses = [
  'rounded-[8px]',
  'border-transparent',
  'bg-surface-container',
  'text-foreground',
  'dark:bg-surface-container',
  'focus-visible:ring-2',
  'focus-visible:ring-ring',
  'focus-visible:ring-offset-2',
  'focus-visible:ring-offset-background',
  'disabled:border-transparent',
  'disabled:bg-surface-container-low',
  'dark:disabled:bg-surface-container-low',
  'disabled:text-muted-foreground',
  'disabled:opacity-100',
  'aria-invalid:border-destructive',
  'dark:aria-invalid:border-destructive/50',
  'aria-invalid:focus-visible:ring-ring',
  'dark:aria-invalid:focus-visible:ring-ring',
  'forced-colors:border',
  'forced-colors:[border-color:CanvasText]',
  'forced-colors:bg-transparent',
  'forced-colors:focus-visible:outline-2',
  'forced-colors:focus-visible:outline-offset-2',
  'forced-colors:focus-visible:outline-[Highlight]',
  'forced-colors:focus-visible:outline-solid',
].join(' ');
