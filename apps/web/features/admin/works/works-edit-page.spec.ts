import { describe, expect, it } from 'vitest';

import { workflowModeLabels } from './works-edit-page';

describe('admin workflow mode projection', () => {
  it('renders the backend-provided manual defaults without importing workflow flags', () => {
    expect(workflowModeLabels({ autoChainEnabled: false, ttsStepEnabled: false })).toEqual({
      chain: '手动分步',
      audio: '手动音频',
    });
  });

  it('renders enabled policy values from the response projection', () => {
    expect(workflowModeLabels({ autoChainEnabled: true, ttsStepEnabled: true })).toEqual({
      chain: '自动串联',
      audio: '自动音频',
    });
  });
});
