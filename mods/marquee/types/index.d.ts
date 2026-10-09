// Marquee keeps no $.state: its one output is the status line ($.ui.status),
// and its one persisted value is the on/off switch in $.store ('enabled').

export type MarqueeSegment = 'model' | 'ctx' | 'limits' | 'cost' | 'git' | 'tool'

export type MarqueeOptions = {
  /** Characters the line may take before it scrolls (default 110). */
  width: number
  /** Comma-separated segment names, in order (default "model,ctx,limits,cost,git,tool"). */
  segments: string
}
