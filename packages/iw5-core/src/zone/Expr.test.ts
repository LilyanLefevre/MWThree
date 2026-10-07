import { describe, it, expect } from 'vitest'
import { compileExpr } from './Expr.js'

const ctx = (vars: Record<string, any>) => ({
  resolve: (p: string) => { if (!(p in vars)) throw new Error(`unknown ${p}`); return vars[p] },
  enumConst: {},
})

describe('compileExpr', () => {
  it('evaluates arithmetic with C integer division', () => {
    expect(compileExpr('(cellCount + 31) / 32')(ctx({ cellCount: 6 }))).toBe(1)
    expect(compileExpr('3 * triCount')(ctx({ triCount: 5 }))).toBe(15)
    expect(compileExpr('0x2000 * 2')(ctx({}))).toBe(0x4000)
  })

  it('evaluates comparisons and boolean operators', () => {
    const e = compileExpr('type == 1 || type == 2')
    expect(e(ctx({ type: 2 }))).toBe(1)
    expect(e(ctx({ type: 3 }))).toBe(0)
  })

  it('supports :: paths and array indexing', () => {
    expect(compileExpr('GfxWorld::counts[idx]')(ctx({ 'GfxWorld::counts': [4, 5, 6], idx: 2 }))).toBe(6)
  })

  it('treats element - array as the element index', () => {
    const arr = [{}, {}]
    const el = { $i: 1 }
    expect(compileExpr('el - arr')(ctx({ el, arr }))).toBe(1)
  })
})
