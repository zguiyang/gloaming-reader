import { describe, expect, it } from 'vitest';

import { workflowModeLabels } from './works-format';

describe('admin workflow mode projection', () => {
  it('renders the backend-provided manual defaults without importing workflow flags', () => {
    expect(workflowModeLabels({ autoChainEnabled: false, ttsStepEnabled: false }, 'zh-CN')).toEqual({
      chain: '手动分步',
      audio: '手动音频',
    });
    expect(workflowModeLabels({ autoChainEnabled: false, ttsStepEnabled: false }, 'en-US')).toEqual({
      chain: 'Manual steps',
      audio: 'Manual audio',
    });
  });

  it('renders enabled policy values from the response projection', () => {
    expect(workflowModeLabels({ autoChainEnabled: true, ttsStepEnabled: true }, 'zh-CN')).toEqual({
      chain: '自动串联',
      audio: '自动音频',
    });
    expect(workflowModeLabels({ autoChainEnabled: true, ttsStepEnabled: true }, 'en-US')).toEqual({
      chain: 'Auto chain',
      audio: 'Auto audio',
    });
  });
});
