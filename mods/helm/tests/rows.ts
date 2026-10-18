// The /config rows Claude Code 2.1.302 lists, trimmed to the ones Helm's profiles touch.
import type { Row } from '../hooks/profiles.ts'

export const row = (key: string, label: string, kind: Row['kind'], value: Row['value'], options?: string[], isLocked = false): Row => ({
  key, label, kind, value, ...(options ? { options } : {}), isLocked,
})

/** The rows Claude Code 2.1.302 lists, trimmed to the ones the profiles touch. */
export const ROWS = (): Row[] => [
  row('autoCompact', 'Auto-compact', 'boolean', true),
  row('autoContinueAtUsageLimit', 'Continue automatically at usage limit', 'boolean', true),
  row('tips', 'Show tips', 'boolean', true),
  row('reduceMotion', 'Reduce motion', 'boolean', false),
  row('thinking', 'Thinking mode', 'boolean', true, undefined, true),
  row('promptSuggestionEnabled', 'Prompt suggestions', 'boolean', true),
  row('recap', 'Session recap', 'boolean', false),
  row('checkpoints', 'Rewind code (checkpoints)', 'boolean', true),
  row('workflows', 'Dynamic workflows', 'boolean', true),
  row('workflowKeywordTriggerEnabled', 'Ultracode keyword trigger', 'boolean', true),
  row('workflowSizeGuideline', 'Dynamic workflow size', 'choice', 'medium', ['unrestricted', 'small', 'medium', 'large']),
  row('verbose', 'Verbose output', 'boolean', false),
  row('progressBar', 'Terminal progress bar', 'boolean', true),
  row('turnDuration', 'Show turn duration', 'boolean', true),
  row('permissionMode', 'Default permission mode', 'choice', 'default', ['default', 'plan', 'acceptEdits', 'auto', 'dontAsk']),
  row('useAutoModeDuringPlan', 'Use auto mode during plan', 'boolean', true),
  row('inputNeededNotifEnabled', 'Push when actions required', 'boolean', false),
  row('agentPushNotifEnabled', 'Push when Claude decides', 'boolean', true),
  row('outputStyle', 'Output style', 'choice', 'default', ['default', 'Proactive', 'Concise', 'Explanatory', 'Learning']),
  row('askUserQuestionTimeout', 'Question auto-continue timeout', 'choice', 'never', ['never', '60s', '5m', '10m']),
  row('prStatus', 'Show PR status footer', 'boolean', true),
  row('model', 'Model', 'choice', 'Default (recommended)', ['default', 'sonnet', 'opus', 'haiku', 'fable', 'best', 'sonnet[1m]', 'opus[1m]', 'fable[1m]', 'opusplan']),
]
