// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { SecretField, type SecretFieldProps } from '@/components/ui/secret-field';

const copy: SecretFieldProps['copy'] = {
  replaceLabel: '新密钥',
  replaceAction: '更换密钥',
  cancelReplaceAction: '取消更换',
  keepHint: '留空保留原密钥',
  configuredLabel: '已配置',
};

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function renderSecretField(props: Partial<SecretFieldProps> = {}) {
  const onChange = props.onChange ?? vi.fn();
  const onReplace = props.onReplace ?? vi.fn();
  const onCancelReplace = props.onCancelReplace ?? vi.fn();
  const values: SecretFieldProps = {
    id: 'secret-1',
    label: 'API 密钥',
    isSet: true,
    masked: '••••3c9a',
    value: '',
    onChange,
    replacing: false,
    onReplace,
    onCancelReplace,
    copy,
    ...props,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(SecretField, values)));
  const cleanup = () => {
    void act(() => root.unmount());
    container.remove();
  };
  cleanups.push(cleanup);
  return { container, onChange, onReplace, onCancelReplace };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('SecretField saved-secret contract', () => {
  it('shows a static masked summary with a replace entry — no editable input while saved', async () => {
    const { container } = await renderSecretField();

    expect(container.textContent).toContain('••••3c9a');
    expect(container.querySelector('input')).toBeNull();
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('更换密钥'));
    expect(button).toBeDefined();
  });

  it('opens an explicitly empty replacement input; the mask never becomes the value', async () => {
    const { container } = await renderSecretField({ replacing: true });

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('');
    expect(input.type).toBe('password');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    // Mask is not present as any input value.
    expect(Array.from(container.querySelectorAll('input')).some((i) => i.value.includes('•'))).toBe(false);
    expect(container.textContent).toContain('留空保留原密钥');
  });

  it('keeps the read-only masked summary visible while the replacement input is open', async () => {
    const { container } = await renderSecretField({ replacing: true });

    expect(container.textContent).toContain('••••3c9a');
    expect(container.textContent).toContain('已配置');
    // The summary row itself contains no editable control.
    expect(container.querySelector('input')?.type).toBe('password');
  });

  it('associates a real label with the replacement input via htmlFor/id', async () => {
    const { container } = await renderSecretField({ replacing: true });

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.id).toBe('secret-1');
    // The visible label bound to the input names the replacement, not the summary.
    const labels = Array.from(container.querySelectorAll('label')) as HTMLLabelElement[];
    const boundLabel = labels.find((l) => l.htmlFor === input.id);
    expect(boundLabel).toBeDefined();
    expect(boundLabel?.textContent).toContain('新密钥');
    // No unassociated sr-only paragraph is used as the input's name.
    expect(container.querySelector('p.sr-only')).toBeNull();
  });

  it('keeps the static summary label unassociated while saved and not replacing', async () => {
    const { container } = await renderSecretField();

    const labels = Array.from(container.querySelectorAll('label')) as HTMLLabelElement[];
    // Summary label exists as text but no input is bound to it.
    expect(labels.some((l) => l.textContent?.includes('API 密钥'))).toBe(true);
    expect(container.querySelector('input')).toBeNull();
  });

  it('disables the replacement input and both actions while pending', async () => {
    const { container } = await renderSecretField({ replacing: true, disabled: true });

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    const cancel = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('取消更换'),
    ) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
  });

  it('disables the replace entry while pending', async () => {
    const { container } = await renderSecretField({ disabled: true });

    const button = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('更换密钥'),
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('cancel replacement invokes onCancelReplace so the parent clears only the key draft', async () => {
    const { container, onCancelReplace, onReplace } = await renderSecretField({ replacing: true });

    const cancel = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('取消更换'));
    await act(async () => cancel?.click());

    expect(onCancelReplace).toHaveBeenCalledTimes(1);
    expect(onReplace).not.toHaveBeenCalled();
  });

  it('does not offer replacement entry for first-use (no saved key)', async () => {
    const { container } = await renderSecretField({ isSet: false, masked: null });

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('');
    expect(container.textContent).not.toContain('更换密钥');
  });

  it('associates the error message and marks the input invalid', async () => {
    const { container } = await renderSecretField({ replacing: true, error: '请检查此项内容。' });

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const errorNode = container.querySelector('[role="alert"]');
    expect(errorNode?.textContent).toContain('请检查此项内容。');
  });

  it('renders the replacement input with the filled appearance (data-appearance) on both branches', async () => {
    // Replacement open while saved…
    const saved = await renderSecretField({ replacing: true });
    expect(saved.container.querySelector('input')?.getAttribute('data-appearance')).toBe('filled');

    // …and first-use (no saved key).
    const firstUse = await renderSecretField({ isSet: false, masked: null });
    expect(firstUse.container.querySelector('input')?.getAttribute('data-appearance')).toBe('filled');
  });

  it('typing only updates the draft via onChange — empty stays empty (preserve-on-save)', async () => {
    const { container, onChange } = await renderSecretField({ replacing: true });

    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => setInputValue(input, 'sk-new'));

    expect(onChange).toHaveBeenCalledWith('sk-new');
  });
});
