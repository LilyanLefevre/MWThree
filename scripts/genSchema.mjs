// Compiles OpenAssetTools' IW5 struct header + zone-code rules into a JSON schema
// consumed by packages/iw5-core/src/zone/*.
// Usage: node scripts/genSchema.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'iw5-core')
const zcDir = join(root, 'zonecode')

// ---------------------------------------------------------------- header

function tokenize(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
  // drop preprocessor lines and namespace guards
  src = src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
  const toks = []
  const re = /\s*([A-Za-z_][A-Za-z0-9_]*|0[xX][0-9a-fA-F]+|\d+|::|[{}\[\]();,*:=<>+\-/|&~^!])/gy
  let m
  while ((m = re.exec(src))) toks.push(m[1])
  return toks
}

const PRIM = {
  char: [1, 1], 'unsigned char': [1, 1], 'signed char': [1, 1], bool: [1, 1],
  short: [2, 2], 'unsigned short': [2, 2], int: [4, 4], 'unsigned int': [4, 4],
  long: [4, 4], 'unsigned long': [4, 4], float: [4, 4], double: [8, 8],
  uint8_t: [1, 1], int8_t: [1, 1], uint16_t: [2, 2], int16_t: [2, 2],
  uint32_t: [4, 4], int32_t: [4, 4], uint64_t: [8, 8], int64_t: [8, 8],
  'unsigned __int64': [8, 8], void: [0, 1],
}
const PRIM_ALIAS = {
  'unsigned long long': 'uint64_t', 'long long': 'int64_t', __int64: 'int64_t',
}

const structs = {}
const enums = {}
const typedefs = {}
let anonCounter = 0

function parseHeader(toks) {
  let i = 0
  const peek = () => toks[i]
  const next = () => toks[i++]
  const expect = t => { const x = next(); if (x !== t) throw new Error(`expected ${t} got ${x} near ${toks.slice(i - 6, i + 3).join(' ')}`) }

  const isAlignMacro = t => /align/.test(t) && toks[i + 1] === '('
  function readAlign() {
    // current token is macro name
    next(); expect('(')
    const n = Number(next()); expect(')')
    return n
  }

  function evalConst(t) {
    if (/^0[xX]/.test(t)) return parseInt(t, 16)
    if (/^\d+$/.test(t)) return Number(t)
    if (t in enumConst) return enumConst[t]
    throw new Error(`unknown constant ${t}`)
  }

  function parseDims() {
    const dims = []
    while (peek() === '[') {
      next()
      let expr = []
      while (peek() !== ']') expr.push(next())
      next()
      dims.push(evalExpr(expr))
    }
    return dims
  }
  function evalExpr(toks) {
    // supports const, const*const, const+const
    const js = toks.map(t => /^[A-Za-z_]/.test(t) ? String(evalConst(t)) : /^0[xX]/.test(t) ? String(parseInt(t, 16)) : t).join(' ')
    return Function(`return (${js})`)()
  }

  function parseEnum(nameHint) {
    // after 'enum'
    let name = null
    if (peek() !== '{' && peek() !== ':') name = next()
    let base = 'int'
    if (peek() === ':') {
      next()
      const words = []
      while (peek() !== '{') words.push(next())
      base = words.join(' ')
    }
    expect('{')
    let v = 0
    const values = {}
    while (peek() !== '}') {
      const n = next()
      if (peek() === '=') {
        next()
        const ex = []
        while (peek() !== ',' && peek() !== '}') ex.push(next())
        v = evalExpr(ex)
      }
      values[n] = v
      enumConst[n] = v
      v++
      if (peek() === ',') next()
    }
    next()
    const e = { base, values }
    if (name) enums[name] = e
    return name
  }

  // parse a type specifier (without declarator). Returns {base:{prim|struct|enum}, align?}
  function parseTypeSpec() {
    const r = parseTypeSpec0()
    return r
  }
  function parseTypeSpec0() {
    let align
    let isConst = false
    const words = []
    for (;;) {
      const t = peek()
      if (t === 'const') { isConst = true; next(); continue }
      if (t === 'volatile') { next(); continue }
      if (isAlignMacro(t)) { align = readAlign(); continue }
      if (t === 'struct' || t === 'union') {
        const kind = next()
        let name = null
        let al
        while (isAlignMacro(peek())) al = readAlign()
        if (peek() !== '{') name = next()
        if (peek() === '{') {
          name = name ?? `$anon${anonCounter++}`
          parseStructBody(kind, name, al)
        }
        return { isConst, base: { struct: name }, align }
      }
      if (t === 'enum') {
        next()
        const name = parseEnum()
        return { isConst, base: { enum: name }, align }
      }
      if (/^(unsigned|signed|short|long|int|char|float|double|bool|void|__int64)$/.test(t)) { words.push(next()); continue }
      if (words.length === 0) {
        // identifier type: prim alias, typedef or struct name
        const name = next()
        if (name in PRIM) return { isConst, base: { prim: name }, align }
        if (name in typedefs) {
          const td = typedefs[name]
          return { ...structuredClone(td), isConst: isConst || td.isConst, align: Math.max(align ?? 0, td.align ?? 0) || undefined, fromTypedef: true }
        }
        if (name in structs || structNames.has(name)) return { isConst, base: { struct: name }, align }
        if (name in enums) return { isConst, base: { enum: name }, align }
        throw new Error(`unknown type ${name} near ${toks.slice(i - 5, i + 4).join(' ')}`)
      }
      break
    }
    let w = words.join(' ')
    w = PRIM_ALIAS[w] ?? w
    if (w === 'signed') w = 'int'
    if (w === 'unsigned') w = 'unsigned int'
    if (w === 'signed int') w = 'int'
    if (!(w in PRIM)) throw new Error(`bad prim ${w}`)
    return { isConst, base: { prim: w }, align }
  }

  // parse declarator list after a type spec, up to ';'. Returns array of members
  function parseDeclarators(spec, parentKind) {
    const out = []
    for (;;) {
      let ptr = 0
      while (peek() === '*') { next(); ptr++; while (peek() === 'const') next() }
      let name = null
      let ptrToArray = null
      if (peek() === '(') {
        // (*name)[N]
        next(); expect('*'); name = next(); expect(')')
        ptrToArray = parseDims()
        ptr++
        out.push({ name, type: { ...spec, ptr, ptrToArray, dims: [] } })
      } else {
        if (peek() !== ';' && peek() !== ',' && peek() !== ':' && peek() !== '[') name = next()
        const dims = parseDims()
        let bits
        if (peek() === ':') { next(); bits = Number(next()) }
        out.push({ name, type: { ...spec, ptr, dims, bits } })
      }
      if (peek() === ',') { next(); continue }
      break
    }
    expect(';')
    return out
  }

  function parseStructBody(kind, name, align) {
    expect('{')
    const members = []
    while (peek() !== '}') {
      if (peek() === 'static_assert') { while (next() !== ';'); continue }
      const spec = parseTypeSpec()
      const decls = parseDeclarators(spec, kind)
      for (const d of decls) {
        if (d.name === null) d.name = `$a${members.length}`, d.anonymous = true
        members.push(d)
      }
    }
    next()
    structs[name] = { kind, align, members }
  }

  const structNames = new Set()
  // pre-scan struct names so forward references work
  for (let k = 0; k < toks.length; k++) {
    if ((toks[k] === 'struct' || toks[k] === 'union') && /^[A-Za-z_]/.test(toks[k + 1] ?? '')) {
      let j = k + 1
      while (isAlignLike(toks[j]) && toks[j + 1] === '(') j += 4
      if (/^[A-Za-z_]/.test(toks[j] ?? '') && (toks[j + 1] === '{' || toks[j + 1] === ';')) structNames.add(toks[j])
    }
  }
  function isAlignLike(t) { return t && /align/.test(t) }

  while (i < toks.length) {
    const t = peek()
    if (t === 'namespace' || t === '}' || t === '{') { next(); continue } // namespace IW5 {  ... }
    if (t === 'IW5') { next(); continue }
    if (t === 'typedef') {
      next()
      const spec = parseTypeSpec()
      const decls = parseDeclarators(spec, 'typedef')
      for (const d of decls) typedefs[d.name] = { ...d.type, align: Math.max(spec.align ?? 0, 0) || undefined }
      continue
    }
    if (t === 'enum') { next(); parseEnum(); if (peek() === ';') next(); continue }
    if (t === 'struct' || t === 'union') {
      next()
      let align
      while (isAlignMacro(peek())) align = readAlign()
      const name = next()
      if (peek() === ';') { next(); continue } // forward decl
      parseStructBody(t, name, align)
      if (peek() === ';') next()
      continue
    }
    if (t === 'static_assert') { while (next() !== ';'); continue }
    if (t === ';') { next(); continue }
    throw new Error(`unexpected top-level token ${t} near ${toks.slice(i - 3, i + 6).join(' ')}`)
  }
}

const enumConst = {}

// ---------------------------------------------------------------- layout

function primInfo(p) { return PRIM[p] }

function typeAlignSize(type) {
  // returns {size, align} of a *single element* (no dims) including pointer
  if (type.ptr > 0) return { size: 4, align: 4 }
  const b = type.base
  let r
  if (b.prim) { const [s, a] = primInfo(b.prim); r = { size: s, align: a } }
  else if (b.enum) {
    const e = enums[b.enum]
    const [s, a] = primInfo(PRIM_ALIAS[e.base] ?? e.base); r = { size: s, align: a }
  } else {
    layoutStruct(b.struct)
    r = { size: structs[b.struct].size, align: structs[b.struct].alignment }
  }
  if (type.align) r = { size: r.size, align: Math.max(r.align, type.align) }
  return r
}

function layoutStruct(name) {
  const s = structs[name]
  if (s.size !== undefined) return
  if (s.laying) throw new Error(`recursive layout ${name}`)
  s.laying = true
  let off = 0
  let maxAlign = 1
  let bitUnitStart = -1, bitUnitSize = 0, bitPos = 0
  for (const m of s.members) {
    const t = m.type
    const dimsCount = (t.ptrToArray ? 1 : t.dims.reduce((a, b) => a * b, 1))
    const { size: es, align: ea } = typeAlignSize(t)
    if (t.bits !== undefined) {
      const unit = es
      if (s.kind === 'union') {
        m.offset = 0; m.bitOffset = 0; maxAlign = Math.max(maxAlign, ea)
        off = Math.max(off, unit)
        continue
      }
      if (bitUnitStart < 0 || bitUnitSize !== unit || bitPos + t.bits > unit * 8) {
        off = (off + ea - 1) & ~(ea - 1)
        bitUnitStart = off; bitUnitSize = unit; bitPos = 0
        off += unit
      }
      m.offset = bitUnitStart; m.bitOffset = bitPos
      bitPos += t.bits
      maxAlign = Math.max(maxAlign, ea)
      continue
    }
    bitUnitStart = -1
    const total = es * dimsCount
    maxAlign = Math.max(maxAlign, ea)
    if (s.kind === 'union') { m.offset = 0; off = Math.max(off, total); continue }
    off = (off + ea - 1) & ~(ea - 1)
    m.offset = off
    off += total
  }
  const al = Math.max(maxAlign, s.align ?? 1)
  s.alignment = al
  s.size = (off + al - 1) & ~(al - 1)
  delete s.laying
}

// ---------------------------------------------------------------- rules

function parseRules() {
  const rules = {}   // type -> { paths: {path: {...}}, reorder: [], block, allocalign }
  const files = readdirSync(join(zcDir, 'XAssets')).sort()
  const get = t => (rules[t] ??= { paths: {}, reorder: null, block: null, allocalign: null })
  for (const f of files) {
    let src = readFileSync(join(zcDir, 'XAssets', f), 'utf8')
    src = src.replace(/\/\/.*$/gm, '')
    const stmts = src.split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean)
    let use = null
    for (const st of stmts) {
      let m
      if ((m = /^use (\w+)$/.exec(st))) { use = m[1]; get(use); continue }
      if ((m = /^reorder(?: (\w+))?\s*:\s*(.*)$/.exec(st))) {
        const t = m[1] ?? use
        get(t).reorder = m[2].split(' ').filter(Boolean)
        continue
      }
      if ((m = /^set (\w+) ?(.*)$/.exec(st))) {
        const kind = m[1]
        const rest = m[2]
        const resolvePath = (p) => {
          const parts = p.split('::')
          if (parts.length > 1 && structs[parts[0]] && !hasMember(use, parts[0])) return [parts[0], parts.slice(1).join('::')]
          return [use, p]
        }
        if (kind === 'block') {
          const mm = /^(?:(\S+) )?(XFILE_BLOCK_\w+)$/.exec(rest)
          if (!mm[1]) { get(use).block = mm[2]; continue }
          const [t, p] = resolvePath(mm[1]); (get(t).paths[p] ??= {}).block = mm[2]; continue
        }
        if (kind === 'allocalign') { const mm = /^(\w+) (\d+)$/.exec(rest); get(mm[1]).allocalign = Number(mm[2]); continue }
        if (kind === 'action') { continue }
        const mm = /^(\S+)(?: (.*))?$/.exec(rest)
        const [t, p] = resolvePath(mm[1])
        const slot = (get(t).paths[p] ??= {})
        const arg = mm[2]
        if (kind === 'count') slot.count = arg
        else if (kind === 'arraysize') slot.arraysize = arg
        else if (kind === 'condition') slot.condition = arg
        else if (kind === 'string') slot.string = true
        else if (kind === 'scriptstring') slot.scriptstring = true
        else if (kind === 'reusable') slot.reusable = true
        else if (kind === 'assetref') slot.assetref = arg
        else throw new Error(`unknown rule ${st}`)
        continue
      }
      throw new Error(`cannot parse rule: ${st}`)
    }
  }
  return rules
}

function hasMember(type, name) {
  const s = structs[type]
  return !!s && s.members.some(m => m.name === name)
}

// ---------------------------------------------------------------- main

const src = readFileSync(join(zcDir, 'IW5_Assets.h'), 'utf8')
parseHeader(tokenize(src))
// Fixes for the retail PC build (differences from OAT's header, found empirically on real zones)
function dropMember(struct, name) {
  const s = structs[struct]
  s.members = s.members.filter(m => m.name !== name)
}
for (const n of Object.keys(structs)) layoutStruct(n)

// verify static_asserts
const asserts = [...src.matchAll(/static_assert\(sizeof\((\w+)\)\s*==\s*(\w+?)u?\)/g)]
let bad = 0
for (const [, n, v] of asserts) {
  if (structs[n] && structs[n].size !== Number(v)) { console.error(`SIZE MISMATCH ${n}: ${structs[n].size} vs ${v}`); bad++ }
}
console.log(`structs=${Object.keys(structs).length} enums=${Object.keys(enums).length} static_asserts=${asserts.length} bad=${bad}`)

const rules = parseRules()

// asset type table (IW5_Commands.txt order == XAssetType enum)
const cmds = readFileSync(join(zcDir, 'IW5_Commands.txt'), 'utf8')
const assetTypes = [...cmds.matchAll(/^asset (\w+) (\w+);/gm)].map(m => ({ struct: m[1], name: m[2] }))

const out = { structs: {}, enums: {}, rules, assetTypes, enumConst }
for (const [n, s] of Object.entries(structs)) {
  out.structs[n] = {
    kind: s.kind, size: s.size, align: s.alignment,
    members: s.members.map(m => ({
      name: m.name, anonymous: m.anonymous || undefined, offset: m.offset, bitOffset: m.bitOffset,
      bits: m.type.bits, const: m.type.isConst || undefined, ptr: m.type.ptr, dims: m.type.dims, ptrToArray: m.type.ptrToArray,
      base: m.type.base, align: m.type.align,
    })),
  }
}
for (const [n, e] of Object.entries(enums)) out.enums[n] = e
mkdirSync(join(root, 'src', 'generated'), { recursive: true })
writeFileSync(join(root, 'src', 'generated', 'iw5Schema.json'), JSON.stringify(out))
console.log('asset types:', assetTypes.length)
