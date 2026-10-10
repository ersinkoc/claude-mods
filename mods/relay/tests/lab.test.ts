import { describe, expect, test } from 'claude-code/testing'

import type { RelayReq } from '../types'
import { KZ } from '../hooks/lib/kz.ts'
import {
  bucketOf, cacheShare, cacheSvg, clockOf, emptySnap, fmtMs, fmtTps, headerSvg, histogramSvg, mixColor, mixSvg, percentile,
  recentSvg, reqOf, slowestSvg, statsOf, stopColor, stopLabel, throughputSvg, vbars,
} from '../hooks/lab.ts'

const REQ: RelayReq = { id: 't:0', at: 0, ms: 1500, model: 'claude-opus-5-5', input: 100, output: 50, cacheRead: 300, cacheWrite: 0, stop: 'end_turn', who: 'main' }
const W = 360

describe('reading a request', () => {
  test('no usage, a numeric effort, a model only the step names, a stream too short to time', () => {
    const bare = reqOf(100, 50, undefined, { turnId: 't', index: 2, model: 'claude-haiku-5', effort: 3 }, { stopReason: 'max_tokens', usage: null }, 'w')
    expect(bare).toEqual({
      id: 't:2', at: 100, ms: 0, ttft: undefined, model: 'claude-haiku-5', effort: '3', input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
      tps: undefined, stop: 'max_tokens', who: 'w',
    })
    const named = reqOf(0, 1000, 950, { turnId: 't', index: 0, model: 'step-model' }, { stopReason: 'end_turn', usage: { output_tokens: 10, model: '' } }, 'main')
    expect(named.model).toBe('step-model')
    expect(named.effort).toBeUndefined()
    expect(named.ttft).toBe(950)
    expect(named.tps).toBeUndefined() // 50 ms of streaming: too short
    const silent = reqOf(0, 1000, 100, { turnId: 't', index: 0, model: 'm' }, { stopReason: 'end_turn', usage: { output_tokens: 0 } }, 'main')
    expect(silent.tps).toBeUndefined()
  })

  test('cache share, percentiles and buckets at their edges', () => {
    expect(cacheShare({ ...REQ, input: 0, cacheRead: 0, cacheWrite: 0 })).toBe(0)
    expect(cacheShare(REQ)).toBe(0.75)
    expect(percentile([], 0.5)).toBeUndefined()
    expect(percentile([7], 0.95)).toBe(7)
    expect(bucketOf({ ...REQ, ms: 999 })).toBe(0)
    expect(bucketOf({ ...REQ, ms: 1000 })).toBe(1)
    expect(bucketOf({ ...REQ, ms: 64_000 })).toBe(7)
  })

  test('stats of nothing, and of failed requests only', () => {
    const none = statsOf(emptySnap())
    expect(none).toEqual({ n: 0, p50: undefined, p95: undefined, avgTps: undefined, avgTtft: undefined, cache: 0, tokensIn: 0, tokensOut: 0, hist: [0, 0, 0, 0, 0, 0, 0, 0], mix: [], slowest: [] })
    const failed = statsOf({ reqs: [{ ...REQ, stop: null }], total: 1, failed: 1 })
    expect(failed.n).toBe(1)
    expect(failed.p50).toBeUndefined()
    expect(failed.mix).toEqual([{ model: 'Opus 5.5', n: 1, color: KZ.violet }])
    expect(mixColor(failed, 'claude-opus-5-5')).toBe(KZ.violet)
    expect(mixColor(failed, 'some-other-model')).toBe(KZ.mist)
  })

  test('nine models wrap round the palette', () => {
    const reqs = Array.from({ length: 9 }, (_, i) => ({ ...REQ, id: `t:${i}`, model: `model-${i}` }))
    const st = statsOf({ reqs, total: 9, failed: 0 })
    expect(st.mix).toHaveLength(9)
    expect(st.mix[8]?.color).toBe(st.mix[0]?.color)
  })
})

describe('formatting', () => {
  test('durations, rates, the clock, stop reasons', () => {
    expect(fmtMs(undefined)).toBe('—')
    expect(fmtMs(12.4)).toBe('12ms')
    expect(fmtMs(4200)).toBe('4.2s')
    expect(fmtMs(42_000)).toBe('42s')
    expect(fmtMs(125_000)).toBe('2m05s')
    expect(fmtMs(999.4)).toBe('999ms')
    expect(fmtMs(999.5)).toBe('1.0s')
    expect(fmtMs(59_499)).toBe('59s')
    expect(fmtMs(59_500)).toBe('1m00s')
    expect(fmtTps(undefined)).toBe('—')
    expect(fmtTps(4.25)).toBe('4.3')
    expect(fmtTps(42.6)).toBe('43')
    expect(clockOf(new Date(2026, 4, 6, 7, 8, 9).getTime())).toBe('07:08:09')
    expect(stopLabel(null)).toBe('no response')
    expect(stopLabel('max_tokens')).toBe('max tokens')
    const stops = [null, 'end_turn', 'tool_use', 'max_tokens', 'model_context_window_exceeded', 'refusal', 'pause_turn']
    expect(stops.map(stopColor)).toEqual([KZ.red, KZ.green, KZ.cyan, KZ.amber, KZ.amber, KZ.red, KZ.mist])
  })

  test('vertical bars keep a sliver for small non-zero values', () => {
    expect(vbars([0, 1, 100], 2)).toEqual(['  █', ' ▁█'])
    expect(vbars([], 1)).toEqual([''])
  })
})

describe('desktop cards', () => {
  test('the header colours its percentiles only when there are some', () => {
    const empty = headerSvg(emptySnap(), statsOf(emptySnap()), W)
    expect(empty.height).toBe(112)
    expect(empty.source).toContain('0 requests')
    expect(empty.source).toContain(`fill="${KZ.mist}"`)
    const snap = { reqs: [REQ], total: 1, failed: 0 }
    const full = headerSvg(snap, statsOf(snap), W)
    expect(full.source).toContain('1.5s')
  })

  test('the histogram labels every bucket and counts the full ones', () => {
    const snap = { reqs: [REQ, { ...REQ, id: 'b', ms: 90_000 }], total: 2, failed: 0 }
    const { source } = histogramSvg(statsOf(snap), W)
    expect(source).toContain('2 answered')
    expect(source).toContain('&lt;1s')
    expect(source).toContain('64+')
    expect(source.match(/<title>1 requests<\/title>/g)).toHaveLength(2)
  })

  test('throughput: waiting, one point, a line', () => {
    expect(throughputSvg([], W).source).toContain('waiting for a response')
    const one = throughputSvg([{ ...REQ, tps: 40 }], W).source
    expect(one).toContain('max 40')
    expect(one).toContain('last 1 requests')
    expect(one).not.toContain('<path')
    const line = throughputSvg([{ ...REQ, tps: 40 }, { ...REQ, tps: undefined }, { ...REQ, tps: 80 }], W).source
    expect(line).toContain('<path')
    expect(line).toContain('class="pulse"')
    expect(line).toContain('last 2 requests')
  })

  test('model mix: none, one model, several', () => {
    const none = mixSvg(statsOf(emptySnap()), W)
    expect(none.source).toContain('0 models')
    expect(none.height).toBe(72)
    const one = mixSvg(statsOf({ reqs: [REQ], total: 1, failed: 0 }), W)
    expect(one.source).toContain('1 model<')
    const three = statsOf({ reqs: [REQ, { ...REQ, model: 'claude-haiku-5' }, { ...REQ, model: 'claude-sonnet-5' }], total: 3, failed: 0 })
    const several = mixSvg(three, W)
    expect(several.source).toContain('3 models')
    expect(several.height).toBe(56 + 2 * 16)
  })

  test('cache share, slowest and recent: empty and filled', () => {
    expect(cacheSvg([], W).source).toContain('no answered requests yet')
    const cache = cacheSvg([REQ, { ...REQ, stop: null }], W).source
    expect(cache).toContain('last 1')
    expect(cache).toContain('75% read from cache')

    expect(slowestSvg(statsOf(emptySnap()), W).source).toContain('nothing timed yet')
    const snap = { reqs: [REQ, { ...REQ, id: 'e', effort: 'high', who: 'Explore' }], total: 2, failed: 0 }
    const slow = slowestSvg(statsOf(snap), W).source
    expect(slow).toContain('Opus 5.5 · high · Explore')
    expect(slow).toContain('Opus 5.5 · main')

    expect(recentSvg([], statsOf(emptySnap()), W, 12).source).toContain('no model requests yet')
    const recent = recentSvg([REQ, { ...REQ, id: 'f', effort: 'low', tps: 55, stop: null }], statsOf(snap), W, 12)
    expect(recent.height).toBe(90)
    expect(recent.source).toContain('Opus 5.5 · low')
    expect(recent.source).toContain('1.5s · 55 t/s')
    expect(recent.source).toContain('<title>no response</title>')
  })
})
