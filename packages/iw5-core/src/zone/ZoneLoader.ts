// Schema-driven IW5 zone loader. Mirrors the semantics of OpenAssetTools' generated
// loaders: struct headers are read inline, then every FOLLOWING (-1) pointer's data is
// read depth-first in member order. Block allocation is simulated so that offset pointers
// (reusable data) can be resolved.
import schemaJson from '../generated/iw5Schema.json'
import { compileExpr, type ExprCtx } from './Expr.js'

export const POINTER_FOLLOWING = 0xffffffff
export const POINTER_INSERT = 0xfffffffe

export const XFILE_BLOCK = { TEMP: 0, PHYSICAL: 1, RUNTIME: 2, VIRTUAL: 3, LARGE: 4, CALLBACK: 5, VERTEX: 6, INDEX: 7, SCRIPT: 8 } as const
const BLOCK_BY_NAME: Record<string, number> = Object.fromEntries(
  Object.entries(XFILE_BLOCK).map(([k, v]) => [`XFILE_BLOCK_${k}`, v]),
)

export interface Member {
  name: string
  anonymous?: boolean
  offset: number
  bitOffset?: number
  bits?: number
  ptr: number
  dims: number[]
  ptrToArray: number[] | null
  base: { prim?: string; struct?: string; enum?: string }
  align?: number
  const?: boolean
}
export interface StructDef { kind: 'struct' | 'union'; size: number; align: number; members: Member[] }
interface PathRule {
  count?: string; arraysize?: string; condition?: string; string?: boolean
  scriptstring?: boolean; reusable?: boolean; assetref?: string; block?: string
}
interface TypeRules { paths: Record<string, PathRule>; reorder: string[] | null; block: string | null; allocalign: number | null }
interface Schema {
  structs: Record<string, StructDef>
  enums: Record<string, { base: string; values: Record<string, number> }>
  rules: Record<string, TypeRules>
  assetTypes: { struct: string; name: string }[]
  enumConst: Record<string, number>
}
export const schema = schemaJson as unknown as Schema

// XAssetType numeric id -> struct name (the enum has holes for unused types)
const ASSET_ENUM_ORDER = [
  'PhysPreset', 'PhysCollmap', 'XAnimParts', 'XModelSurfs', 'XModel', 'Material', 'MaterialPixelShader',
  'MaterialVertexShader', 'MaterialVertexDeclaration', 'MaterialTechniqueSet', 'GfxImage', 'snd_alias_list_t',
  'SndCurve', 'LoadedSound', 'clipMap_t', 'ComWorld', 'GlassWorld', 'PathData', 'VehicleTrack', 'MapEnts',
  'FxWorld', 'GfxWorld', 'GfxLightDef', null /*UI_MAP*/, 'Font_s', 'MenuList', 'menuDef_t', 'LocalizeEntry',
  'WeaponAttachment', 'WeaponCompleteDef', null /*SNDDRIVER*/, 'FxEffectDef', 'FxImpactTable', 'SurfaceFxTable',
  null, null, null, null /*AITYPE..XMODELALIAS*/, 'RawFile', 'ScriptFile', 'StringTable', 'LeaderboardDef',
  'StructuredDataDefSet', 'TracerDef', 'VehicleDef', 'AddonMapEnts',
]
export const ASSET_STRUCT_BY_TYPE = ASSET_ENUM_ORDER
const ASSET_HEADER_BLOCK: number = XFILE_BLOCK.TEMP
/** block receiving 4-byte slots for INSERT pointers (aliases to TEMP-loaded data) */
const INSERT_BLOCK: number = XFILE_BLOCK.VIRTUAL
const ASSET_STRUCTS = new Set(ASSET_ENUM_ORDER.filter((x): x is string => !!x))

export interface LoadedAsset { type: number; typeName: string | null; pointer: number; value: any; name: string | null }
export interface LoadedZone {
  header: { size: number; externalSize: number; blockSizes: number[] }
  scriptStrings: string[]
  assets: LoadedAsset[]
  blockUsed: number[]
  bytesRead: number
  /** resolve a leftover {$ref} (alias or interior pointer) */
  resolveRef(ref: number): { array: any; index: number; value: any } | null
}

/** Lazily decoded array of pointer-free structs (big arrays like vertices). */
export class PlainArray {
  constructor(public type: string, public length: number, public bytes: Uint8Array, private loader: ZoneLoader) {}
  get(i: number): any { return this.loader.decodeStruct(this.type, this.bytes, i * schema.structs[this.type].size) }
  get stride(): number { return schema.structs[this.type].size }
  *[Symbol.iterator]() { for (let i = 0; i < this.length; i++) yield this.get(i) }
}

interface Scope { type: string; obj: any; prefix: string | null; addr?: number }

const hasPtrCache = new Map<string, boolean>()
function hasPtr(name: string): boolean {
  const c = hasPtrCache.get(name)
  if (c !== undefined) return c
  hasPtrCache.set(name, false)
  const s = schema.structs[name]
  const r = s.members.some(m => m.ptr > 0 || (m.base.struct ? hasPtr(m.base.struct) : false))
  hasPtrCache.set(name, r)
  return r
}

function primKind(p: string): 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'f32' | 'f64' | 'u64' | 'i64' {
  switch (p) {
    case 'char': case 'signed char': case 'int8_t': return 'i8'
    case 'unsigned char': case 'bool': case 'uint8_t': return 'u8'
    case 'short': case 'int16_t': return 'i16'
    case 'unsigned short': case 'uint16_t': return 'u16'
    case 'int': case 'long': case 'int32_t': return 'i32'
    case 'unsigned int': case 'unsigned long': case 'uint32_t': return 'u32'
    case 'float': return 'f32'
    case 'double': return 'f64'
    case 'uint64_t': return 'u64'
    case 'int64_t': return 'i64'
  }
  throw new Error(`bad prim ${p}`)
}
function memberKind(m: { base: Member['base'] }): ReturnType<typeof primKind> {
  if (m.base.prim) return primKind(m.base.prim)
  const e = schema.enums[m.base.enum!]
  return primKind(e.base === 'unsigned' ? 'unsigned int' : e.base)
}
function kindSize(k: ReturnType<typeof primKind>): number {
  return k === 'u8' || k === 'i8' ? 1 : k === 'u16' || k === 'i16' ? 2 : k === 'f64' || k === 'u64' || k === 'i64' ? 8 : 4
}

export class ZoneLoader {
  private view: DataView
  private u8: Uint8Array
  pos = 0
  private blockOff = new Array(9).fill(0)
  private stack: number[] = []
  private registry = new Map<number, any>()
  scriptStrings: string[] = []
  /** reusable arrays: [start, byteLength, value, elemSize] for interior-pointer resolution */
  intervals: [number, number, any, number][] = []
  stats = { inlineAssetPtrs: 0, unresolvedRefs: 0 }
  private exprCache = new Map<string, (c: ExprCtx) => any>()
  /** optional trace: called after each asset */
  onAsset?: (i: number, a: LoadedAsset, pos: number) => void

  constructor(buf: ArrayBuffer) {
    this.view = new DataView(buf)
    this.u8 = new Uint8Array(buf)
  }

  // ------------------------------------------------------------ stream / blocks
  private pushBlock(b: number) { this.stack.push(b) }
  private popBlock() { this.stack.pop() }
  private get curBlock(): number { return this.stack[this.stack.length - 1] }
  private alloc(size: number, align: number, block = this.curBlock): number {
    if (block === XFILE_BLOCK.TEMP) return this.encode(block, 0)
    let off = this.blockOff[block]
    off = (off + align - 1) & ~(align - 1)
    const addr = this.encode(block, off)
    this.blockOff[block] = off + size
    return addr
  }
  private encode(block: number, off: number): number { return (((block << 28) | off) + 1) >>> 0 }
  private readBytes(n: number): Uint8Array {
    if (this.pos + n > this.u8.length) throw new Error(`read past end of zone (pos=${this.pos} n=${n} len=${this.u8.length})`)
    const r = this.u8.subarray(this.pos, this.pos + n)
    this.pos += n
    return r
  }
  private readU32(): number {
    const v = this.view.getUint32(this.pos, true)
    this.pos += 4
    return v
  }
  private readCString(): string {
    let e = this.pos
    while (e < this.u8.length && this.u8[e] !== 0) e++
    let s = ''
    for (let i = this.pos; i < e; i++) s += String.fromCharCode(this.u8[i])
    this.pos = e + 1
    return s
  }

  // ------------------------------------------------------------ top level
  load(): LoadedZone {
    const size = this.readU32()
    const externalSize = this.readU32()
    const blockSizes: number[] = []
    for (let i = 0; i < 9; i++) blockSizes.push(this.readU32())

    // XAssetList
    this.pushBlock(XFILE_BLOCK.VIRTUAL)
    const stringCount = this.readU32()
    const stringsPtr = this.readU32()
    const assetCount = this.readU32()
    const assetsPtr = this.readU32()

    if (stringsPtr === POINTER_FOLLOWING) {
      this.alloc(stringCount * 4, 4)
      const ptrs: number[] = []
      for (let i = 0; i < stringCount; i++) ptrs.push(this.readU32())
      for (const p of ptrs) {
        if (p === POINTER_FOLLOWING) {
          const s = this.readCString()
          this.registry.set(this.alloc(s.length + 1, 1), s)
          this.scriptStrings.push(s)
        } else this.scriptStrings.push('')
      }
    }

    const assets: LoadedAsset[] = []
    if (assetsPtr === POINTER_FOLLOWING) {
      const assetsBase = this.alloc(assetCount * 8, 4)
      const entries: { type: number; ptr: number }[] = []
      for (let i = 0; i < assetCount; i++) entries.push({ type: this.readU32(), ptr: this.readU32() })
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]
        const structName = ASSET_STRUCT_BY_TYPE[e.type] ?? null
        const a: LoadedAsset = { type: e.type, typeName: structName, pointer: e.ptr, value: null, name: null }
        assets.push(a)
        if (e.ptr === POINTER_FOLLOWING || e.ptr === POINTER_INSERT) {
          if (!structName) throw new Error(`asset #${i}: unsupported asset type ${e.type} at pos ${this.pos}`)
          a.value = this.withInsert(e.ptr, () => this.loadAssetHeader(structName))
          a.name = assetName(a.value)
          // later references to this asset point at the header field of its XAsset entry
          if (e.ptr === POINTER_FOLLOWING) this.registry.set((assetsBase + i * 8 + 4) >>> 0, a.value)
        }
        this.onAsset?.(i, a, this.pos)
      }
    }
    return {
      header: { size, externalSize, blockSizes }, scriptStrings: this.scriptStrings, assets,
      blockUsed: [...this.blockOff], bytesRead: this.pos,
      resolveRef: (r: number) => this.resolveRef(r),
    }
  }

  private sortedIntervals: [number, number, any, number][] | null = null

  /** Resolve a zone pointer (e.g. a left-over {$ref}) that points into a reusable array. */
  resolveRef(ref: number): { array: any; index: number; value: any } | null {
    const hit = this.registry.get(ref)
    if (hit !== undefined) return { array: null, index: 0, value: hit }
    if (!this.sortedIntervals) this.sortedIntervals = [...this.intervals].sort((a, b) => a[0] - b[0])
    const iv = this.sortedIntervals
    let lo = 0, hi = iv.length - 1, found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (iv[mid][0] <= ref) { found = mid; lo = mid + 1 } else hi = mid - 1
    }
    // intervals may nest/overlap (alias arrays): scan back a few
    for (let k = found; k >= 0 && k > found - 8; k--) {
      const [start, len, value, esz] = iv[k]
      if (ref >= start && ref < start + len) {
        const index = Math.floor((ref - start) / esz)
        const el = value instanceof PlainArray ? value.get(index) : value[index]
        return { array: value, index, value: el }
      }
    }
    return null
  }

  /** INSERT pointers get a 4-byte slot (alias) in the insert block; later offsets refer to that slot. */
  private withInsert<T>(ptr: number, load: () => T): T {
    if (ptr !== POINTER_INSERT) return load()
    const slot = this.alloc(4, 4, INSERT_BLOCK)
    const v = load()
    this.registry.set(slot, v)
    return v
  }

  private loadAssetHeader(structName: string): any {
    const rules = schema.rules[structName]
    const def = schema.structs[structName]
    this.alloc(def.size, rules?.allocalign ?? def.align, ASSET_HEADER_BLOCK)
    const bytes = this.readBytes(def.size)
    const obj = this.decodeStruct(structName, bytes, 0)
    this.pushBlock(XFILE_BLOCK.VIRTUAL)
    this.processStruct([{ type: structName, obj, prefix: '' }], structName, obj)
    this.popBlock()
    return obj
  }

  // ------------------------------------------------------------ decode
  decodeStruct(name: string, bytes: Uint8Array, off: number): any {
    const def = schema.structs[name]
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const obj: any = {}
    this.decodeMembers(def, dv, bytes, off, obj)
    return obj
  }

  private decodeMembers(def: StructDef, dv: DataView, bytes: Uint8Array, base: number, obj: any) {
    for (const m of def.members) {
      const o = base + m.offset
      if (m.anonymous && m.base.struct && m.ptr === 0 && m.dims.length === 0) {
        this.decodeMembers(schema.structs[m.base.struct], dv, bytes, o, obj)
        continue
      }
      obj[m.name] = this.decodeMember(m, dv, bytes, o)
    }
  }

  private decodeScalar(k: ReturnType<typeof primKind>, dv: DataView, o: number): number {
    switch (k) {
      case 'u8': return dv.getUint8(o)
      case 'i8': return dv.getInt8(o)
      case 'u16': return dv.getUint16(o, true)
      case 'i16': return dv.getInt16(o, true)
      case 'u32': return dv.getUint32(o, true)
      case 'i32': return dv.getInt32(o, true)
      case 'f32': return dv.getFloat32(o, true)
      case 'f64': return dv.getFloat64(o, true)
      case 'u64': return dv.getUint32(o + 4, true) * 4294967296 + dv.getUint32(o, true)
      case 'i64': return dv.getInt32(o + 4, true) * 4294967296 + dv.getUint32(o, true)
    }
  }

  private decodeMember(m: Member, dv: DataView, bytes: Uint8Array, o: number): any {
    const count = m.dims.reduce((a, b) => a * b, 1)
    if (m.ptr > 0) {
      if (m.ptrToArray || m.dims.length === 0) return dv.getUint32(o, true)
      const arr = new Uint32Array(count)
      for (let i = 0; i < count; i++) arr[i] = dv.getUint32(o + i * 4, true)
      return arr
    }
    if (m.base.struct) {
      const sd = schema.structs[m.base.struct]
      if (m.dims.length === 0) { const r: any = {}; this.decodeMembers(sd, dv, bytes, o, r); return r }
      const items: any[] = []
      for (let i = 0; i < count; i++) { const r: any = {}; this.decodeMembers(sd, dv, bytes, o + i * sd.size, r); items.push(r) }
      return items
    }
    const k = memberKind(m)
    if (m.bits !== undefined) {
      const raw = this.decodeScalar(k, dv, o)
      const v = Math.floor(raw / 2 ** (m.bitOffset ?? 0))
      return m.bits >= 32 ? v : v % 2 ** m.bits
    }
    if (m.dims.length === 0) return this.decodeScalar(k, dv, o)
    return this.typedArray(k, dv, bytes, o, count)
  }

  private typedArray(k: ReturnType<typeof primKind>, dv: DataView, bytes: Uint8Array, o: number, count: number): any {
    const sz = kindSize(k)
    const copy = bytes.slice(o, o + count * sz)
    switch (k) {
      case 'u8': return copy
      case 'i8': return new Int8Array(copy.buffer)
      case 'u16': return new Uint16Array(copy.buffer)
      case 'i16': return new Int16Array(copy.buffer)
      case 'u32': return new Uint32Array(copy.buffer)
      case 'i32': return new Int32Array(copy.buffer)
      case 'f32': return new Float32Array(copy.buffer)
      case 'f64': return new Float64Array(copy.buffer)
      default: { const a: number[] = []; for (let i = 0; i < count; i++) a.push(this.decodeScalar(k, dv, o + i * sz)); return a }
    }
  }

  // ------------------------------------------------------------ rules / expressions
  private findRule(scopes: Scope[], member: string, suffix = ''): { rule: PathRule; scope: Scope } & { scopeIdx: number } | null {
    // merge rules across scopes (innermost wins per property)
    let merged: PathRule | null = null
    let ruleScope = -1
    for (let i = scopes.length - 1; i >= 0; i--) {
      const s = scopes[i]
      if (s.prefix === null) continue
      const r = schema.rules[s.type]?.paths[s.prefix + member + suffix]
      if (r) {
        if (!merged) { merged = { ...r }; ruleScope = i } else {
          // inner scopes win; fill missing from outer
          for (const k of Object.keys(r) as (keyof PathRule)[]) if (merged[k] === undefined) (merged as any)[k] = r[k]
        }
      }
    }
    return merged ? { rule: merged, scope: scopes[ruleScope], scopeIdx: ruleScope } : null
  }

  private evalExpr(expr: string, scopes: Scope[], scopeIdx: number): any {
    let fn = this.exprCache.get(expr)
    if (!fn) { fn = compileExpr(expr); this.exprCache.set(expr, fn) }
    return fn({
      resolve: (path: string) => this.resolvePath(path, scopes, scopeIdx),
      enumConst: schema.enumConst,
    })
  }

  private resolvePath(path: string, scopes: Scope[], scopeIdx: number): any {
    const parts = path.split('::')
    if (parts.length === 1 && schema.structs[parts[0]]) {
      for (let k = scopes.length - 1; k >= 0; k--) if (scopes[k].type === parts[0]) return scopes[k].obj
    }
    let obj: any
    let i = 0
    // type-qualified lookup
    if (parts.length > 1 && schema.structs[parts[0]]) {
      const hasMem = schema.structs[scopes[scopeIdx].type]?.members.some(m => m.name === parts[0])
      if (!hasMem) {
        let found: Scope | undefined
        for (let k = scopes.length - 1; k >= 0; k--) if (scopes[k].type === parts[0]) { found = scopes[k]; break }
        if (found) { obj = found.obj; i = 1 }
        else if (schema.structs[parts[0]]) {
          // fall back to elsewhere in the chain
          obj = undefined
        }
      }
    }
    if (obj === undefined && i === 0) {
      // first component: field in rule scope, else outer scopes, else enum constant
      const first = parts[0]
      const chain = [scopes[scopeIdx], ...scopes.slice(0, scopeIdx).reverse(), ...scopes.slice(scopeIdx + 1)]
      for (const s of chain) if (s.obj && first in s.obj) { obj = s.obj; break }
      if (obj === undefined) {
        if (first in schema.enumConst) return schema.enumConst[first]
        throw new Error(`cannot resolve '${path}' in scope ${scopes[scopeIdx].type}`)
      }
    }
    let v: any = obj
    for (; i < parts.length; i++) {
      if (v == null) throw new Error(`null while resolving '${path}'`)
      v = v[parts[i]]
    }
    return v
  }

  private evalCount(rule: PathRule | undefined, scopes: Scope[], scopeIdx: number): number {
    if (!rule || !rule.count) return 1
    const v = this.evalExpr(rule.count, scopes, scopeIdx)
    return typeof v === 'number' ? v : Number(v)
  }

  // ------------------------------------------------------------ member walking
  private memberOrder(name: string): Member[] {
    const def = schema.structs[name]
    const ro = schema.rules[name]?.reorder
    if (!ro) return def.members
    const byName = new Map(def.members.map(m => [m.name, m]))
    const dots = ro.indexOf('...')
    const take = (names: string[]) => {
      const out: Member[] = []
      for (const n of names) { const m = byName.get(n); if (m) { out.push(m); byName.delete(n) } }
      return out
    }
    const before = take(dots < 0 ? ro : ro.slice(0, dots))
    const after = dots < 0 ? [] : take(ro.slice(dots + 1))
    const rest = def.members.filter(m => byName.has(m.name))
    // '...' stands for the unlisted members; those that follow every listed member in
    // declaration order keep their place after the reordered group.
    const lastListed = Math.max(...after.map(m => def.members.indexOf(m)), -1)
    const trailing = rest.filter(m => def.members.indexOf(m) > lastListed && lastListed >= 0)
    const middle = rest.filter(m => !trailing.includes(m))
    return [...before, ...middle, ...after, ...trailing]
  }

  /** Process loadable members of a decoded struct whose bytes were already read. */
  private processStruct(scopes: Scope[], typeName: string, obj: any) {
    const def = schema.structs[typeName]
    if (def.kind === 'union') return this.processUnion(scopes, typeName, obj)
    for (const m of this.memberOrder(typeName)) this.processMember(scopes, m, obj)
  }

  private processUnion(scopes: Scope[], typeName: string, obj: any) {
    const def = schema.structs[typeName]
    let chosen: Member | null = null
    let fallback: Member | null = null
    for (const m of def.members) {
      if (!this.memberLoadable(m)) continue
      const fr = this.findRule(scopes, m.name)
      const cond = fr?.rule.condition
      if (cond === undefined) { if (!fallback) fallback = m; continue }
      if (cond === 'never') continue
      if (cond === 'always' || this.evalExpr(cond, scopes, fr!.scopeIdx)) { chosen = m; break }
    }
    const m = chosen ?? fallback
    if (!m) return
    this.processMember(scopes, m, obj, true)
  }

  private memberLoadable(m: Member): boolean {
    return m.ptr > 0 || (!!m.base.struct && hasPtr(m.base.struct))
  }

  private processMember(scopes: Scope[], m: Member, obj: any, skipCondition = false) {
    try { this.processMember0(scopes, m, obj, skipCondition) } catch (e: any) {
      if (e && typeof e.message === 'string' && !e.$ctx) e.message += `\n  at ${scopes[scopes.length - 1].type}.${m.name} (pos=${this.pos})`
      else if (e && typeof e.message === 'string') e.message += `\n  at ${scopes[scopes.length - 1].type}.${m.name}`
      if (e) e.$ctx = true
      throw e
    }
  }

  private processMember0(scopes: Scope[], m: Member, obj: any, skipCondition = false) {
    if (!this.memberLoadable(m)) return
    if (m.anonymous && m.base.struct && m.ptr === 0 && m.dims.length === 0) {
      // anonymous inline struct/union: fields live flattened in obj
      this.descendInline(scopes, m, obj, m.base.struct)
      return
    }
    const fr = this.findRule(scopes, m.name)
    if (!skipCondition && fr?.rule.condition !== undefined) {
      if (fr.rule.condition === 'never') return
      if (fr.rule.condition !== 'always' && !this.evalExpr(fr.rule.condition, scopes, fr.scopeIdx)) return
    }
    if (m.ptr === 0) {
      // inline struct (or array of structs)
      const sd = m.base.struct!
      if (m.dims.length === 0) this.descendInline(scopes, m, obj[m.name], sd)
      else {
        const arr = obj[m.name] as any[]
        arr.forEach((el, i) => this.descendInline(scopes, m, el, sd, i))
      }
      return
    }
    // pointer member(s)
    const baseAddr = scopes[scopes.length - 1].addr
    const mAddr = baseAddr === undefined ? undefined : baseAddr + m.offset
    if (m.dims.length === 0) {
      obj[m.name] = this.loadPointer(scopes, m, obj[m.name], '', mAddr)
    } else {
      const raw = obj[m.name] as Uint32Array
      const out: any[] = []
      const n = raw.length
      const d0 = m.dims[0]
      for (let i = 0; i < n; i++) {
        const idx = m.dims.length === 1 ? `[${i}]` : `[${Math.floor(i / (n / d0))}][${i % (n / d0)}]`
        out.push(this.loadPointer(scopes, m, raw[i], idx, mAddr === undefined ? undefined : mAddr + i * 4))
      }
      obj[m.name] = out
    }
  }

  private descendInline(scopes: Scope[], m: Member, childObj: any, childType: string, elemIndex = 0) {
    // extend parent prefixes
    const ns: Scope[] = scopes.map(s => ({ ...s, prefix: s.prefix === null ? null : m.anonymous ? s.prefix : s.prefix + m.name + '::' }))
    const parentAddr = scopes[scopes.length - 1].addr
    const addr = parentAddr === undefined ? undefined : parentAddr + m.offset + elemIndex * schema.structs[childType].size
    ns.push({ type: childType, obj: childObj, prefix: '', addr })
    this.processStruct(ns, childType, childObj)
  }

  /** Load the pointee of a single pointer value. Returns the loaded value (or the raw pointer when nothing inline). */
  private loadPointer(scopes: Scope[], m: Member, ptr: number, idxSuffix: string, memberAddr?: number): any {
    if (ptr === 0) return null
    let fr = this.findRule(scopes, m.name, idxSuffix)
    if (idxSuffix) {
      const b = this.findRule(scopes, m.name)
      if (b) {
        if (!fr) fr = b
        else for (const k of Object.keys(b.rule) as (keyof PathRule)[]) if (fr.rule[k] === undefined) (fr.rule as any)[k] = b.rule[k]
      }
    }
    const rule = fr?.rule
    const scopeIdx = fr?.scopeIdx ?? scopes.length - 1
    const baseScopeForExpr = scopeIdx
    if (ptr !== POINTER_FOLLOWING && ptr !== POINTER_INSERT) {
      // reference to already loaded data
      const addr = ptr
      const hit = this.registry.get(addr)
      if (hit !== undefined) return hit
      this.stats.unresolvedRefs++
      return { $ref: ptr }
    }
    const blk = rule?.block ? BLOCK_BY_NAME[rule.block] : this.curBlock
    this.pushBlock(blk)
    try {
      const v = this.withInsert(ptr, () => this.loadPointee(scopes, m, rule, baseScopeForExpr, blk))
      if (memberAddr !== undefined && this.isTempPointee(m, blk)) this.registry.set(memberAddr >>> 0, v)
      return v
    } finally {
      this.popBlock()
    }
  }

  /** pointees loaded in a TEMP block are referenced through the address of the pointer that holds them */
  private isTempPointee(m: Member, blk: number): boolean {
    return blk === XFILE_BLOCK.TEMP || (!!m.base.struct && schema.rules[m.base.struct]?.block === 'XFILE_BLOCK_TEMP')
  }

  private loadPointee(scopes: Scope[], m: Member, rule: PathRule | undefined, scopeIdx: number, blk: number): any {
    const isString = m.base.prim === 'char' && (!!rule?.string || (!!m.const && m.ptr <= 2 && !rule?.count))
    const runtime = blk === XFILE_BLOCK.RUNTIME
    const reg = (addr: number, v: any, byteLen = 0, elemSize = 0) => {
      if (rule?.reusable) this.registry.set(addr, v)
      if (byteLen > 0 && blk !== XFILE_BLOCK.TEMP && blk !== XFILE_BLOCK.RUNTIME) this.intervals.push([addr, byteLen, v, elemSize])
    }

    if (m.ptrToArray) {
      const n = this.evalCount(rule, scopes, scopeIdx)
      const elem = m.ptrToArray.reduce((a, b) => a * b, 1) * 4
      const addr = this.alloc(n * elem, 4)
      const bytes = runtime ? new Uint8Array(0) : this.readBytes(n * elem).slice()
      const v = new Float32Array(bytes.buffer)
      reg(addr, v)
      return v
    }

    // pointer depth 2: array of pointers
    if (m.ptr >= 2) {
      const n = this.evalCount(rule, scopes, scopeIdx)
      const addr = this.alloc(n * 4, 4)
      const raws: number[] = []
      if (!runtime) for (let i = 0; i < n; i++) raws.push(this.readU32())
      const out = raws.map((p, i) => {
        const v = this.loadElementPtr(scopes, m, p, rule, isString)
        if ((p === POINTER_FOLLOWING) && this.isTempPointee({ ...m, ptr: m.ptr - 1 }, blk)) this.registry.set((addr + i * 4) >>> 0, v)
        return v
      })
      reg(addr, out)
      return out
    }

    // depth 1
    if (isString) {
      const s = this.readCString()
      const addr = this.alloc(s.length + 1, 1)
      this.registry.set(addr, s)
      return s
    }
    if (m.base.struct && ASSET_STRUCTS.has(m.base.struct)) {
      // inline asset
      this.stats.inlineAssetPtrs++
      return this.loadAssetHeader(m.base.struct)
    }
    const n = this.evalCount(rule, scopes, scopeIdx)
    if (!Number.isFinite(n) || n < 0) throw new Error(`bad count ${n} for ${m.name} (rule ${rule?.count})`)
    if (m.base.struct) {
      const sd = schema.structs[m.base.struct]
      const typeName = m.base.struct
      const flex = this.hasArraysize(typeName)
      const align = m.align ?? schema.rules[typeName]?.allocalign ?? sd.align
      const addr = this.alloc(n * sd.size, align)
      if (runtime) return null
      if (n === 0) return []
      const base = scopes.map(s => ({ ...s, prefix: null as string | null }))
      if (!hasPtr(typeName) && !flex) {
        const bytes = this.readBytes(n * sd.size).slice()
        const v = new PlainArray(typeName, n, bytes, this)
        reg(addr, v, n * sd.size, sd.size)
        return v
      }
      const items: any[] = []
      if (flex) {
        for (let i = 0; i < n; i++) {
          const start = this.pos
          items.push(this.readFlexElement(typeName, base))
          const extra = this.pos - start - sd.size
          if (extra > 0 && blk !== XFILE_BLOCK.TEMP && blk !== XFILE_BLOCK.RUNTIME) this.blockOff[blk] += extra
        }
      } else {
        const bytes = this.readBytes(n * sd.size).slice()
        for (let i = 0; i < n; i++) items.push(this.decodeStruct(typeName, bytes, i * sd.size))
      }
      items.forEach((el, i) => { el.$i = i })
      for (const el of items) Object.defineProperty(el, '$arr', { value: items, enumerable: false })
      reg(addr, items, n * sd.size, sd.size)
      // pointee elements are processed in order, in a fresh path context
      items.forEach((el, i) => this.processStruct([...base, { type: typeName, obj: el, prefix: '', addr: blk === XFILE_BLOCK.TEMP || blk === XFILE_BLOCK.RUNTIME ? undefined : addr + i * sd.size }], typeName, el))
      return n === 1 && !rule?.count ? items[0] : items
    }
    // primitive / enum pointee
    const k = memberKind(m)
    const sz = m.base.prim === 'void' ? 1 : kindSize(k)
    const addr = this.alloc(n * sz, m.align ?? sz)
    if (runtime) return null
    const bytes = this.readBytes(n * sz).slice()
    const v = n === 1 && !rule?.count ? this.decodeScalar(k, new DataView(bytes.buffer), 0) : this.typedArray(k, new DataView(bytes.buffer), bytes, 0, n)
    reg(addr, v, n * sz, sz)
    return v
  }

  private hasArraysize(typeName: string): boolean {
    const r = schema.rules[typeName]
    if (!r) return false
    return Object.values(r.paths).some(p => p.arraysize !== undefined)
  }

  /** Resolve a rule path (a::b::c) inside a struct type to absolute offset and leaf member + union ancestry. */
  private pathInfo(typeName: string, path: string) {
    let def = schema.structs[typeName]
    let off = 0
    const unions: { prefix: string; def: StructDef; name: string }[] = []
    const parts = path.split('::')
    let leaf: Member | null = null
    for (let i = 0; i < parts.length; i++) {
      const mem = def.members.find(x => x.name === parts[i])
      if (!mem) return null
      if (def.kind === 'union') unions.push({ prefix: parts.slice(0, i).join('::') + (i ? '::' : ''), def, name: mem.name })
      off += mem.offset
      leaf = mem
      if (i < parts.length - 1) {
        if (!mem.base.struct) return null
        def = schema.structs[mem.base.struct]
      }
    }
    return leaf ? { offset: off, leaf, unions } : null
  }

  private unionChoice(rootType: string, prefix: string, def: StructDef, obj: any, scopes: Scope[]): string | null {
    let fallback: string | null = null
    for (const m of def.members) {
      const cond = schema.rules[rootType]?.paths[prefix + m.name]?.condition
      if (cond === undefined) { if (!fallback) fallback = m.name; continue }
      if (cond === 'never') continue
      if (cond === 'always' || this.evalExpr(cond, [...scopes, { type: rootType, obj, prefix: '' }], scopes.length)) return m.name
    }
    return fallback
  }

  /** Read a struct that ends in variable-sized inline arrays (arraysize rule). */
  private readFlexElement(typeName: string, base: Scope[]): any {
    const sd = schema.structs[typeName]
    const rules = schema.rules[typeName]
    const infos: { path: string; expr: string; info: NonNullable<ReturnType<ZoneLoader['pathInfo']>> }[] = []
    for (const [path, pr] of Object.entries(rules.paths)) {
      if (pr.arraysize === undefined) continue
      const info = this.pathInfo(typeName, path)
      if (info) infos.push({ path, expr: pr.arraysize, info })
    }
    const headerLen = Math.min(...infos.map(x => x.info.offset))
    const buf = new Uint8Array(sd.size)
    buf.set(this.readBytes(headerLen))
    const obj = this.decodeStruct(typeName, buf, 0)
    const scopes = [...base, { type: typeName, obj, prefix: '' }]
    infos.sort((a, b) => a.info.offset - b.info.offset)
    for (const { path, expr, info } of infos) {
      // skip arrays in inactive union members
      const parts = path.split('::')
      let active = true
      for (const u of info.unions) {
        const ch = this.unionChoice(typeName, u.prefix, u.def, obj, base)
        if (ch !== u.name) { active = false; break }
      }
      if (!active) continue
      const n = Number(this.evalExpr(expr, scopes, scopes.length - 1))
      let arr: any
      if (info.leaf.base.struct) {
        const esz = schema.structs[info.leaf.base.struct].size
        const bytes = this.readBytes(n * esz).slice()
        arr = Array.from({ length: n }, (_, i) => this.decodeStruct(info.leaf.base.struct!, bytes, i * esz))
      } else {
        const k = memberKind(info.leaf)
        const bytes = this.readBytes(n * kindSize(k)).slice()
        arr = this.typedArray(k, new DataView(bytes.buffer), bytes, 0, n)
      }
      let tgt = obj
      for (let i = 0; i < parts.length - 1; i++) tgt = tgt[parts[i]] ?? tgt
      tgt[parts[parts.length - 1]] = arr
    }
    return obj
  }

  private loadElementPtr(scopes: Scope[], m: Member, p: number, rule: PathRule | undefined, isString: boolean): any {
    if (p === 0) return null
    if (p !== POINTER_FOLLOWING && p !== POINTER_INSERT) {
      const hit = this.registry.get(p)
      if (hit !== undefined) return hit
      this.stats.unresolvedRefs++
      return { $ref: p }
    }
    if (isString) {
      const s = this.readCString()
      this.registry.set(this.alloc(s.length + 1, 1), s)
      return s
    }
    const sub: Member = { ...m, ptr: m.ptr - 1, dims: [] }
    return this.withInsert(p, () => {
      if (m.ptr - 1 === 1 && m.base.struct && ASSET_STRUCTS.has(m.base.struct)) {
        this.stats.inlineAssetPtrs++
        return this.loadAssetHeader(m.base.struct)
      }
      return this.loadPointee(scopes, sub, { ...rule, count: undefined } as PathRule, scopes.length - 1, this.curBlock)
    })
  }
}

function assetName(v: any): string | null {
  if (!v) return null
  if (typeof v.name === 'string') return v.name
  if (typeof v.aliasName === 'string') return v.aliasName
  if (v.info && typeof v.info.name === 'string') return v.info.name
  return null
}
