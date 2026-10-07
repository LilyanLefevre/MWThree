// Tiny C-like expression compiler for zone-code rules (counts / conditions).
export interface ExprCtx {
  resolve(path: string): any
  enumConst: Record<string, number>
}

type Node = (c: ExprCtx) => any

const TOKEN = /\s*(0[xX][0-9a-fA-F]+|\d+|[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*|\|\||&&|==|!=|<=|>=|[-+*/%<>!()\[\]])/y

export function compileExpr(src: string): Node {
  const toks: string[] = []
  TOKEN.lastIndex = 0
  let m: RegExpExecArray | null
  while (TOKEN.lastIndex < src.length && (m = TOKEN.exec(src))) toks.push(m[1])
  if (TOKEN.lastIndex < src.trimEnd().length) throw new Error(`bad expression: ${src}`)
  let i = 0
  const peek = () => toks[i]
  const next = () => toks[i++]

  const num = (v: any): number => (typeof v === 'number' ? v : v === true ? 1 : v === false ? 0 : Number(v))

  function primary(): Node {
    const t = next()
    if (t === '(') { const e = or(); next(); return postfix(e) }
    if (t === '!') { const e = primary(); return c => (num(e(c)) ? 0 : 1) }
    if (t === '-') { const e = primary(); return c => -num(e(c)) }
    if (/^0[xX]/.test(t)) { const v = parseInt(t, 16); return () => v }
    if (/^\d/.test(t)) { const v = Number(t); return () => v }
    if (t === 'true') return () => 1
    if (t === 'false') return () => 0
    const path = t
    return postfix(c => c.resolve(path))
  }
  function postfix(e: Node): Node {
    while (peek() === '[') {
      next()
      const idx = or()
      next()
      const base = e
      e = c => { const b = base(c); const k = num(idx(c)); return b[k] }
    }
    return e
  }
  function mul(): Node {
    let l = primary()
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next(); const r = primary(); const a = l
      l = op === '*' ? c => num(a(c)) * num(r(c)) : op === '/' ? c => Math.trunc(num(a(c)) / num(r(c))) : c => num(a(c)) % num(r(c))
    }
    return l
  }
  function add(): Node {
    let l = mul()
    while (peek() === '+' || peek() === '-') {
      const op = next(); const r = mul(); const a = l
      if (op === '+') l = c => num(a(c)) + num(r(c))
      else l = c => {
        const x = a(c), y = r(c)
        // pointer difference: element - array => index of element
        if (x && typeof x === 'object' && '$i' in x) return x.$i
        return num(x) - num(y)
      }
    }
    return l
  }
  function rel(): Node {
    let l = add()
    while (['<', '>', '<=', '>=', '==', '!='].includes(peek())) {
      const op = next(); const r = add(); const a = l
      l = c => {
        const x = num(a(c)), y = num(r(c))
        switch (op) {
          case '<': return x < y ? 1 : 0
          case '>': return x > y ? 1 : 0
          case '<=': return x <= y ? 1 : 0
          case '>=': return x >= y ? 1 : 0
          case '==': return x === y ? 1 : 0
          default: return x !== y ? 1 : 0
        }
      }
    }
    return l
  }
  function and(): Node {
    let l = rel()
    while (peek() === '&&') { next(); const r = rel(); const a = l; l = c => (num(a(c)) && num(r(c)) ? 1 : 0) }
    return l
  }
  function or(): Node {
    let l = and()
    while (peek() === '||') { next(); const r = and(); const a = l; l = c => (num(a(c)) || num(r(c)) ? 1 : 0) }
    return l
  }
  const root = or()
  if (i < toks.length) throw new Error(`trailing tokens in expression: ${src}`)
  return root
}
