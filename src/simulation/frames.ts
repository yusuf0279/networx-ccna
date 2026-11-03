/**
 * Frame-level network engine.
 *
 * Unlike the path-finding helpers in network.ts, this module moves individual
 * Ethernet frames across individual links, one event at a time:
 *
 *  - every cable is a link between two named interfaces (eth0, G0/0, Fa0/1 …)
 *  - hosts work out the next hop (same subnet → destination, otherwise → gateway)
 *  - hosts and routers resolve next-hop MACs with ARP (broadcast request, unicast reply)
 *  - switches learn source MACs per port, forward known unicast, flood the rest
 *  - hubs repeat every frame out of every other port
 *  - routers do longest-prefix match on connected + static routes, decrement TTL
 *    and rewrite the source/destination MAC on every hop
 *
 * Each call to step() delivers exactly one frame to one device, so a UI or a
 * terminal can show the TCP/IP stack working one frame at a time.
 */
import type { NetNode, NetEdge, MacEntry, ArpEntry, NatEntry } from '../types'

export const BROADCAST = 'ff:ff:ff:ff:ff:ff'

// ── Addressing helpers ───────────────────────────────────────────────────────

export function ipToInt(ip: string): number | null {
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n >>> 0
}

export function maskBits(mask: string): number {
  const m = ipToInt(mask)
  if (m === null) return -1
  let bits = 0
  for (let i = 31; i >= 0; i--) {
    if ((m >>> i) & 1) bits++
    else break
  }
  return bits
}

export function inSubnet(ip: string, netIp: string, mask: string): boolean {
  const a = ipToInt(ip), b = ipToInt(netIp), m = ipToInt(mask)
  if (a === null || b === null || m === null) return false
  return ((a & m) >>> 0) === ((b & m) >>> 0)
}

// ── Topology model ───────────────────────────────────────────────────────────

export interface Iface {
  nodeId: string
  name: string
  edgeId: string
  peerNodeId: string
  mac: string
  ip: string
  mask: string
}

type Role = 'host' | 'router' | 'switch' | 'hub' | 'cloud'

function roleOf(node: NetNode): Role {
  switch (node.data.deviceType) {
    case 'router':
    case 'gateway':
    case 'firewall':
      return 'router'
    case 'switch':
    case 'wap':
      return 'switch'
    case 'hub':
      return 'hub'
    case 'cloud':
      // A cloud with per-interface addresses acts as the ISP's router; otherwise it's a dead end
      return Object.values(node.data.interfaces ?? {}).some((c) => c.ip) ? 'router' : 'cloud'
    default:
      return 'host'
  }
}

function ifacePrefix(role: Role): string {
  if (role === 'router') return 'G0/'
  if (role === 'switch' || role === 'hub') return 'Fa0/'
  return 'eth'
}

/** Give interface k of a node its own MAC by bumping the last octet. */
function ifaceMac(base: string, k: number): string {
  if (k === 0) return base
  const parts = base.split(':')
  if (parts.length !== 6) return base
  const last = (parseInt(parts[5] ?? '0', 16) + k) & 0xff
  parts[5] = last.toString(16).padStart(2, '0')
  return parts.join(':')
}

/**
 * Build the interface list for every node from the edges.
 * Interfaces are numbered in edge-id order so names stay stable.
 *
 * Addressing:
 *  - data.interfaces[name] wins when present (per-interface IP and mask)
 *  - hosts: the first interface uses data.ip / data.subnet
 *  - routers: the first LAN-facing interface uses data.ip / data.subnet and the
 *    cloud-facing (or second) interface uses data.wanIp
 */
export function buildInterfaces(nodes: NetNode[], edges: NetEdge[]): Map<string, Iface[]> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const result = new Map<string, Iface[]>()
  const sorted = [...edges].sort((a, b) => a.id.localeCompare(b.id))

  for (const node of nodes) {
    const role = roleOf(node)
    const mine = sorted.filter((e) => (e.source === node.id || e.target === node.id) && e.source !== e.target)
    const start = role === 'host' || role === 'router' ? 0 : 1
    const prefix = ifacePrefix(role)
    const list: Iface[] = mine.map((e, k) => {
      const peerNodeId = e.source === node.id ? e.target : e.source
      return {
        nodeId: node.id,
        name: `${prefix}${k + start}`,
        edgeId: e.id,
        peerNodeId,
        mac: ifaceMac(node.data.mac, k),
        ip: '',
        mask: '',
      }
    })

    const explicit = node.data.interfaces ?? {}
    if (role === 'host') {
      if (list[0]) {
        list[0].ip = node.data.ip
        list[0].mask = node.data.subnet || '255.255.255.0'
      }
    } else if (role === 'router') {
      const wanIdx = list.findIndex((i) => byId.get(i.peerNodeId)?.data.deviceType === 'cloud')
      const lanIdx = list.findIndex((_, k) => k !== wanIdx)
      if (lanIdx >= 0 && node.data.ip) {
        list[lanIdx]!.ip = node.data.ip
        list[lanIdx]!.mask = node.data.subnet || '255.255.255.0'
      }
      if (node.data.wanIp) {
        const w = wanIdx >= 0 ? wanIdx : list.findIndex((_, k) => k !== lanIdx)
        if (w >= 0) {
          list[w]!.ip = node.data.wanIp
          list[w]!.mask = node.data.wanSubnet || '255.255.255.0'
        }
      }
    }
    for (const iface of list) {
      // Keyed by interface name (set in the UI) or by "@<peer node id>" (stable for presets)
      const cfg = explicit[iface.name] ?? explicit[`@${iface.peerNodeId}`]
      if (cfg && cfg.ip) {
        iface.ip = cfg.ip
        iface.mask = cfg.subnet || '255.255.255.0'
      }
    }
    result.set(node.id, list)
  }
  return result
}

/**
 * A home gateway is a router with a built-in switch. Split it into a router
 * (WAN side + one LAN uplink) and a virtual switch that owns the LAN ports, so
 * PCs plugged into the gateway can still reach each other at layer 2.
 * Real edge ids are kept, so packet animations still land on the right cables.
 */
export function expandGateways(nodes: NetNode[], edges: NetEdge[]): { nodes: NetNode[]; edges: NetEdge[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const outNodes = [...nodes]
  let outEdges = [...edges]
  for (const g of nodes) {
    if (g.data.deviceType !== 'gateway') continue
    const swId = `${g.id}::lan`
    outNodes.push({
      ...g,
      id: swId,
      data: { ...g.data, deviceType: 'switch', label: `${g.data.label} (built-in switch)`, macTable: [] },
    })
    outEdges = outEdges.map((e) => {
      if (e.source !== g.id && e.target !== g.id) return e
      const peer = e.source === g.id ? e.target : e.source
      if (byId.get(peer)?.data.deviceType === 'cloud') return e
      return e.source === g.id ? { ...e, source: swId } : { ...e, target: swId }
    })
    outEdges.push({ id: `${g.id}::uplink`, source: g.id, target: swId })
  }
  return { nodes: outNodes, edges: outEdges }
}

// ── Frames ───────────────────────────────────────────────────────────────────

export type FrameKind = 'ARP_REQUEST' | 'ARP_REPLY' | 'ICMP_ECHO_REQUEST' | 'ICMP_ECHO_REPLY'

export interface Frame {
  kind: FrameKind
  srcMac: string
  dstMac: string
  // ARP payload
  senderIp?: string
  senderMac?: string
  targetIp?: string
  // IP / ICMP payload
  srcIp?: string
  dstIp?: string
  ttl?: number
  seq?: number
  pingId?: string
  /** links crossed so far by this echo (request + reply), used as simulated RTT */
  links?: number
}

interface IpPacket {
  srcIp: string
  dstIp: string
  ttl: number
  kind: 'ICMP_ECHO_REQUEST' | 'ICMP_ECHO_REPLY'
  seq: number
  pingId: string
  links: number
}

export interface Delivery {
  step: number
  edgeId: string
  fromNodeId: string
  fromIface: string
  toNodeId: string
  toIface: string
  frame: Frame
}

export interface StepRecord {
  step: number
  delivery: Delivery
  /** what the receiving device did with the frame */
  actions: string[]
}

export interface PingResult {
  seq: number
  status: 'reply' | 'timeout' | 'unreachable' | 'no-route'
  fromIp?: string
  ttl?: number
  links?: number
  reason?: string
}

// ── Engine ───────────────────────────────────────────────────────────────────

export class FrameSim {
  readonly nodes: Map<string, NetNode>
  readonly ifaces: Map<string, Iface[]>
  /** per-switch MAC table: mac → port name */
  readonly macTables = new Map<string, Map<string, string>>()
  /** per-host/router ARP cache: ip → { mac, iface } */
  readonly arpCaches = new Map<string, Map<string, { mac: string; iface: string }>>()
  /** per-router NAT table: ICMP id → translation */
  readonly natTables = new Map<string, Map<string, NatEntry>>()
  readonly log: StepRecord[] = []
  readonly results = new Map<string, PingResult>()

  private queue: Delivery[] = []
  private stepCount = 0
  /** packets waiting for an ARP reply: nodeId → nextHopIp → packets */
  private parked = new Map<string, Map<string, { iface: string; packets: IpPacket[] }>>()
  /** pre-step notes produced while a ping is being launched */
  private pendingNotes: string[] = []
  readonly launchNotes: string[] = []

  constructor(rawNodes: NetNode[], rawEdges: NetEdge[]) {
    const { nodes, edges } = expandGateways(rawNodes, rawEdges)
    this.nodes = new Map(nodes.map((n) => [n.id, n]))
    this.ifaces = buildInterfaces(nodes, edges)
    for (const n of nodes) {
      const role = roleOf(n)
      if (role === 'switch') {
        this.macTables.set(n.id, new Map((n.data.macTable ?? []).map((m) => [m.mac, m.port])))
      }
      if (role === 'host' || role === 'router') {
        this.arpCaches.set(
          n.id,
          new Map((n.data.arpCache ?? []).map((a) => [a.ip, { mac: a.mac, iface: a.iface }])),
        )
      }
      if (role === 'router' && n.data.nat) {
        this.natTables.set(n.id, new Map((n.data.natTable ?? []).map((e) => [e.id, e])))
      }
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  get idle(): boolean {
    return this.queue.length === 0
  }

  get steps(): number {
    return this.stepCount
  }

  /** Frames queued on the wire but not yet delivered. */
  get inFlight(): number {
    return this.queue.length
  }

  /** Queue one ICMP echo request from a host. Frames are not delivered until step()/run(). */
  ping(srcId: string, dstIp: string, seq: number, pingId: string): void {
    const key = `${pingId}:${seq}`
    const src = this.nodes.get(srcId)
    const srcIface = this.ifaces.get(srcId)?.find((i) => i.ip)
    if (!src || !srcIface) {
      this.results.set(key, { seq, status: 'no-route', reason: 'this device has no IP address' })
      return
    }
    this.results.set(key, { seq, status: 'timeout' })
    this.pendingNotes = []
    this.sendIp(srcId, {
      srcIp: srcIface.ip,
      dstIp,
      ttl: 64,
      kind: 'ICMP_ECHO_REQUEST',
      seq,
      pingId,
      links: 0,
    })
    this.launchNotes.push(...this.pendingNotes)
    this.pendingNotes = []
  }

  /** Deliver exactly one frame. Returns the record, or null when nothing is in flight. */
  step(): StepRecord | null {
    const d = this.queue.shift()
    if (!d) return null
    this.stepCount++
    d.step = this.stepCount
    const actions = this.receive(d)
    const rec = { step: d.step, delivery: d, actions }
    this.log.push(rec)
    return rec
  }

  /** Run until no frames are in flight (or the safety limit is hit). */
  run(maxSteps = 2000): void {
    let n = 0
    while (!this.idle && n < maxSteps) {
      this.step()
      n++
    }
    this.finishArp()
  }

  /** After the network goes quiet, packets still waiting on ARP have failed. */
  finishArp(): void {
    for (const [nodeId, byIp] of this.parked) {
      for (const [ip, entry] of byIp) {
        for (const p of entry.packets) {
          if (p.kind !== 'ICMP_ECHO_REQUEST') continue
          const key = `${p.pingId}:${p.seq}`
          const r = this.results.get(key)
          if (r && r.status === 'timeout') {
            const node = this.nodes.get(nodeId)
            const isOrigin = this.ifaces.get(nodeId)?.some((i) => i.ip === p.srcIp)
            r.status = 'unreachable'
            r.fromIp = isOrigin ? p.srcIp : this.ifaces.get(nodeId)?.find((i) => i.name === entry.iface)?.ip
            r.reason = `${node?.data.label ?? nodeId} sent ARP for ${ip} but nobody answered`
          }
        }
      }
    }
    this.parked.clear()
  }

  macTableEntries(switchId: string): MacEntry[] {
    const t = this.macTables.get(switchId)
    if (!t) return []
    return [...t.entries()].map(([mac, port]) => ({ mac, port, vlan: 1 }))
  }

  arpEntries(nodeId: string): ArpEntry[] {
    const c = this.arpCaches.get(nodeId)
    if (!c) return []
    return [...c.entries()].map(([ip, v]) => ({ ip, mac: v.mac, iface: v.iface }))
  }

  natEntries(nodeId: string): NatEntry[] {
    return [...(this.natTables.get(nodeId)?.values() ?? [])]
  }

  label(nodeId: string): string {
    return this.nodes.get(nodeId)?.data.label ?? nodeId
  }

  // ── Sending ──────────────────────────────────────────────────────────────

  private emit(nodeId: string, ifaceName: string, frame: Frame): void {
    const iface = this.ifaces.get(nodeId)?.find((i) => i.name === ifaceName)
    if (!iface) return
    const peerIface = this.ifaces.get(iface.peerNodeId)?.find((i) => i.edgeId === iface.edgeId)
    if (!peerIface) return
    this.queue.push({
      step: 0,
      edgeId: iface.edgeId,
      fromNodeId: nodeId,
      fromIface: ifaceName,
      toNodeId: iface.peerNodeId,
      toIface: peerIface.name,
      frame,
    })
  }

  /** Choose egress interface and next-hop IP, CCNA style. */
  private lookup(nodeId: string, dstIp: string): { iface: Iface; nextHop: string; via: string } | null {
    const node = this.nodes.get(nodeId)
    const list = (this.ifaces.get(nodeId) ?? []).filter((i) => i.ip)
    if (!node) return null
    const role = roleOf(node)

    if (role === 'host') {
      const iface = list[0]
      if (!iface) return null
      if (inSubnet(dstIp, iface.ip, iface.mask)) return { iface, nextHop: dstIp, via: 'same subnet' }
      const gw = node.data.gateway
      if (gw && inSubnet(gw, iface.ip, iface.mask)) return { iface, nextHop: gw, via: `default gateway ${gw}` }
      return null
    }

    // Router: longest prefix match over connected networks and static routes
    let best: { iface: Iface; nextHop: string; via: string; bits: number; metric: number } | null = null
    for (const iface of list) {
      if (inSubnet(dstIp, iface.ip, iface.mask)) {
        const bits = maskBits(iface.mask)
        if (!best || bits > best.bits) {
          best = { iface, nextHop: dstIp, via: `connected on ${iface.name}`, bits, metric: 0 }
        }
      }
    }
    for (const r of node.data.routingTable ?? []) {
      if (!inSubnet(dstIp, r.destination, r.subnet)) continue
      const bits = maskBits(r.subnet)
      const gw = r.gateway && r.gateway !== '0.0.0.0' ? r.gateway : ''
      const iface = gw
        ? list.find((i) => inSubnet(gw, i.ip, i.mask))
        : list.find((i) => i.name === r.iface)
      if (!iface) continue
      const metric = r.metric ?? 0
      if (!best || bits > best.bits || (bits === best.bits && metric < best.metric)) {
        best = {
          iface,
          nextHop: gw || dstIp,
          via: `${bits === 0 ? 'default route' : 'static route'} ${r.destination}/${bits}${gw ? ` via ${gw}` : ''}`,
          bits,
          metric,
        }
      }
    }
    return best
  }

  /** The router's NAT outside interface, if NAT is configured. */
  private natOutside(nodeId: string): Iface | undefined {
    const outside = this.nodes.get(nodeId)?.data.nat?.outside
    if (!outside) return undefined
    return this.ifaces.get(nodeId)?.find((i) => i.name === outside || `@${i.peerNodeId}` === outside)
  }

  private sendIp(nodeId: string, pkt: IpPacket): void {
    const route = this.lookup(nodeId, pkt.dstIp)
    const who = this.label(nodeId)
    const outside = route ? this.natOutside(nodeId) : undefined
    if (route && outside?.ip && route.iface.name === outside.name && pkt.srcIp !== outside.ip) {
      // NAT overload: private source address leaves as the router's public address.
      // One row per conversation, so repeated pings don't pile up duplicates.
      const table = this.natTables.get(nodeId)
      for (const [k, e] of table ?? []) {
        if (e.insideLocal === pkt.srcIp && e.outside === pkt.dstIp) table!.delete(k)
      }
      table?.set(pkt.pingId, {
        proto: 'icmp',
        insideLocal: pkt.srcIp,
        insideGlobal: outside.ip,
        outside: pkt.dstIp,
        id: pkt.pingId,
      })
      this.pendingNotes.push(
        `${who} NAT: source ${pkt.srcIp} → ${outside.ip} (private address swapped for the public one on ${outside.name}; saved in the NAT table)`,
      )
      pkt = { ...pkt, srcIp: outside.ip }
    }
    if (!route) {
      this.pendingNotes.push(`${who} has no route to ${pkt.dstIp} — packet dropped`)
      if (pkt.kind === 'ICMP_ECHO_REQUEST') {
        const r = this.results.get(`${pkt.pingId}:${pkt.seq}`)
        if (r && r.status === 'timeout') {
          const isOrigin = this.ifaces.get(nodeId)?.some((i) => i.ip === pkt.srcIp)
          r.status = isOrigin ? 'no-route' : 'unreachable'
          r.fromIp = isOrigin ? undefined : this.ifaces.get(nodeId)?.find((i) => i.ip)?.ip
          r.reason = `${who} has no route to ${pkt.dstIp}`
        }
      }
      return
    }
    const cache = this.arpCaches.get(nodeId)
    const known = cache?.get(route.nextHop)
    if (known) {
      this.pendingNotes.push(
        `${who} sends ${kindLabel(pkt.kind)} to ${pkt.dstIp} out ${route.iface.name} (${route.via}); next hop ${route.nextHop} is ${known.mac} in its ARP cache`,
      )
      this.emit(nodeId, route.iface.name, {
        kind: pkt.kind,
        srcMac: route.iface.mac,
        dstMac: known.mac,
        srcIp: pkt.srcIp,
        dstIp: pkt.dstIp,
        ttl: pkt.ttl,
        seq: pkt.seq,
        pingId: pkt.pingId,
        links: pkt.links,
      })
      return
    }

    // Need ARP first: park the packet, ask once per next hop
    let byIp = this.parked.get(nodeId)
    if (!byIp) {
      byIp = new Map()
      this.parked.set(nodeId, byIp)
    }
    const waiting = byIp.get(route.nextHop)
    if (waiting) {
      waiting.packets.push(pkt)
      this.pendingNotes.push(`${who} queues ${kindLabel(pkt.kind)} until ARP for ${route.nextHop} is answered`)
      return
    }
    byIp.set(route.nextHop, { iface: route.iface.name, packets: [pkt] })
    this.pendingNotes.push(
      `${who} wants to reach ${pkt.dstIp} (${route.via}) but doesn't know the MAC for ${route.nextHop}, so it broadcasts an ARP request out ${route.iface.name}`,
    )
    this.emit(nodeId, route.iface.name, {
      kind: 'ARP_REQUEST',
      srcMac: route.iface.mac,
      dstMac: BROADCAST,
      senderIp: route.iface.ip,
      senderMac: route.iface.mac,
      targetIp: route.nextHop,
    })
  }

  // ── Receiving ────────────────────────────────────────────────────────────

  private receive(d: Delivery): string[] {
    const node = this.nodes.get(d.toNodeId)
    if (!node) return ['device missing — frame lost']
    if (!node.data.isOn) return [`${node.data.label} is switched off — frame lost`]
    const role = roleOf(node)
    let f = d.frame

    if (role === 'switch') return this.bridge(node, d)
    if (role === 'hub') {
      const out = (this.ifaces.get(node.id) ?? []).filter((i) => i.name !== d.toIface)
      for (const i of out) this.emit(node.id, i.name, { ...f })
      return [`hub repeats the frame out of every other port${out.length ? ` (${out.map((i) => i.name).join(', ')})` : ''}`]
    }
    if (role === 'cloud') return ['frame reaches the Internet cloud — not simulated further']

    const ingress = this.ifaces.get(node.id)?.find((i) => i.name === d.toIface)
    if (!ingress) return ['no such interface']
    const mine = f.dstMac === BROADCAST || f.dstMac === ingress.mac
    if (!mine) return [`destination MAC ${f.dstMac} is not ${ingress.mac} — frame ignored`]

    this.pendingNotes = []
    const actions: string[] = []

    if (f.kind === 'ARP_REQUEST' || f.kind === 'ARP_REPLY') {
      const cache = this.arpCaches.get(node.id)
      const ownsTarget = ingress.ip && f.targetIp === ingress.ip
      if (f.kind === 'ARP_REQUEST' && !ownsTarget) {
        return [`ARP asks for ${f.targetIp}, which is not ${ingress.ip || 'this device'} — ignored`]
      }
      if (cache && f.senderIp && f.senderMac) {
        cache.set(f.senderIp, { mac: f.senderMac, iface: ingress.name })
        actions.push(`ARP cache: ${f.senderIp} → ${f.senderMac}`)
      }
      if (f.kind === 'ARP_REQUEST') {
        actions.push(`that's me — unicast ARP reply to ${f.senderMac}`)
        this.emit(node.id, ingress.name, {
          kind: 'ARP_REPLY',
          srcMac: ingress.mac,
          dstMac: f.senderMac ?? f.srcMac,
          senderIp: ingress.ip,
          senderMac: ingress.mac,
          targetIp: f.senderIp,
        })
      } else if (f.senderIp) {
        const waiting = this.parked.get(node.id)?.get(f.senderIp)
        if (waiting) {
          this.parked.get(node.id)!.delete(f.senderIp)
          actions.push(`releases ${waiting.packets.length} queued packet${waiting.packets.length === 1 ? '' : 's'}`)
          for (const p of waiting.packets) this.sendIp(node.id, p)
        }
      }
      return [...actions, ...this.pendingNotes]
    }

    // IP / ICMP
    const outside = this.natOutside(node.id)
    const entry = outside && ingress.name === outside.name && f.dstIp === outside.ip && f.kind === 'ICMP_ECHO_REPLY'
      ? this.natTables.get(node.id)?.get(f.pingId ?? '')
      : undefined
    const nat = entry && entry.outside === f.srcIp ? entry : undefined
    if (nat) {
      actions.push(`NAT: destination ${f.dstIp} → ${nat.insideLocal} (found in the NAT table)`)
      f = { ...f, dstIp: nat.insideLocal }
    }
    const links = (f.links ?? 0) + 1
    const ownIps = (this.ifaces.get(node.id) ?? []).map((i) => i.ip).filter(Boolean)
    if (f.dstIp && ownIps.includes(f.dstIp)) {
      if (f.kind === 'ICMP_ECHO_REQUEST') {
        actions.push(`echo request is for me — sending echo reply to ${f.srcIp}`)
        this.sendIp(node.id, {
          srcIp: f.dstIp,
          dstIp: f.srcIp!,
          ttl: 64,
          kind: 'ICMP_ECHO_REPLY',
          seq: f.seq ?? 0,
          pingId: f.pingId ?? '',
          links,
        })
      } else {
        const key = `${f.pingId}:${f.seq}`
        const r = this.results.get(key)
        if (r && r.status === 'timeout') {
          r.status = 'reply'
          r.fromIp = f.srcIp
          r.ttl = f.ttl
          r.links = links
        }
        actions.push(`echo reply received from ${f.srcIp} (icmp_seq=${f.seq}, ttl=${f.ttl})`)
      }
      return [...actions, ...this.pendingNotes]
    }

    if (role !== 'router') {
      return [`IP ${f.dstIp} is not mine and hosts don't forward — dropped`]
    }

    const ttl = (f.ttl ?? 64) - 1
    if (ttl <= 0) return [`TTL reached 0 — packet dropped`]
    actions.push(`routes packet for ${f.dstIp}, TTL ${f.ttl} → ${ttl}`)
    this.sendIp(node.id, {
      srcIp: f.srcIp!,
      dstIp: f.dstIp!,
      ttl,
      kind: f.kind as IpPacket['kind'],
      seq: f.seq ?? 0,
      pingId: f.pingId ?? '',
      links,
    })
    return [...actions, ...this.pendingNotes]
  }

  private bridge(node: NetNode, d: Delivery): string[] {
    const table = this.macTables.get(node.id)!
    const f = d.frame
    const actions: string[] = []
    const old = table.get(f.srcMac)
    if (old !== d.toIface) {
      table.set(f.srcMac, d.toIface)
      actions.push(old ? `moves ${f.srcMac} from ${old} to ${d.toIface}` : `learns ${f.srcMac} on ${d.toIface}`)
    }
    const ports = this.ifaces.get(node.id) ?? []
    const flood = () => {
      const out = ports.filter((p) => p.name !== d.toIface)
      for (const p of out) this.emit(node.id, p.name, { ...f })
      return out.map((p) => p.name).join(', ') || 'no other ports'
    }
    if (f.dstMac === BROADCAST) {
      actions.push(`broadcast — floods out ${flood()}`)
    } else {
      const port = table.get(f.dstMac)
      if (!port) {
        actions.push(`${f.dstMac} not in MAC table — floods out ${flood()}`)
      } else if (port === d.toIface) {
        actions.push(`${f.dstMac} is on the incoming port — frame filtered`)
      } else {
        this.emit(node.id, port, { ...f })
        actions.push(`${f.dstMac} is on ${port} — forwards out ${port}`)
      }
    }
    return actions
  }
}

function kindLabel(kind: IpPacket['kind']): string {
  return kind === 'ICMP_ECHO_REQUEST' ? 'ICMP echo request' : 'ICMP echo reply'
}

// ── Formatting helpers for terminals and panels ──────────────────────────────

export function describeFrame(f: Frame): string {
  switch (f.kind) {
    case 'ARP_REQUEST':
      return `ARP request: who has ${f.targetIp}? tell ${f.senderIp}`
    case 'ARP_REPLY':
      return `ARP reply: ${f.senderIp} is at ${f.senderMac}`
    case 'ICMP_ECHO_REQUEST':
      return `ICMP echo request ${f.srcIp} → ${f.dstIp} (seq ${f.seq}, TTL ${f.ttl})`
    case 'ICMP_ECHO_REPLY':
      return `ICMP echo reply ${f.srcIp} → ${f.dstIp} (seq ${f.seq}, TTL ${f.ttl})`
  }
}

export function formatStep(sim: FrameSim, rec: StepRecord): string[] {
  const d = rec.delivery
  const f = d.frame
  const head =
    `[${rec.step}] ${sim.label(d.fromNodeId)} ${d.fromIface} → ${sim.label(d.toNodeId)} ${d.toIface}: ` +
    describeFrame(f)
  const macs = `      L2 ${f.srcMac} → ${f.dstMac === BROADCAST ? 'ff:ff:ff:ff:ff:ff (broadcast)' : f.dstMac}`
  return [head, macs, ...rec.actions.map((a) => `      • ${a}`)]
}
