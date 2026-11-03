/**
 * Glue between the frame engine (frames.ts) and the app: writes learned MAC
 * tables / ARP caches back to node data, turns deliveries into packet
 * animations, and formats ping output.
 */
import type { NetNode, NetEdge, NodeData, PacketAnim } from '../types'
import { FrameSim } from './frames'
import type { Delivery, PingResult } from './frames'

export const FRAME_HOP_MS = 450

/** Copy the engine's MAC tables and ARP caches into node data when they changed. */
export function syncTables(
  sim: FrameSim,
  nodes: NetNode[],
  updateNodeData?: (id: string, patch: Partial<NodeData>) => void,
): void {
  if (!updateNodeData) return
  for (const node of nodes) {
    if (sim.macTables.has(node.id)) {
      const entries = sim.macTableEntries(node.id)
      if (JSON.stringify(entries) !== JSON.stringify(node.data.macTable ?? [])) {
        updateNodeData(node.id, { macTable: entries })
      }
    }
    if (sim.arpCaches.has(node.id)) {
      const entries = sim.arpEntries(node.id)
      if (JSON.stringify(entries) !== JSON.stringify(node.data.arpCache ?? [])) {
        updateNodeData(node.id, { arpCache: entries })
      }
    }
    if (sim.natTables.has(node.id)) {
      const entries = sim.natEntries(node.id)
      if (JSON.stringify(entries) !== JSON.stringify(node.data.natTable ?? [])) {
        updateNodeData(node.id, { natTable: entries })
      }
    }
  }
}

function frameLabel(d: Delivery): { protocol: PacketAnim['protocol']; label: string } {
  switch (d.frame.kind) {
    case 'ARP_REQUEST': return { protocol: 'ARP', label: 'ARP?' }
    case 'ARP_REPLY': return { protocol: 'ARP', label: 'ARP' }
    case 'ICMP_ECHO_REQUEST': return { protocol: 'ICMP', label: 'echo' }
    case 'ICMP_ECHO_REPLY': return { protocol: 'ICMP', label: 'reply' }
  }
}

/** One animation per delivery, staggered by step so frames play in order. */
export function deliveriesToPackets(
  deliveries: Delivery[],
  edges: NetEdge[],
  hopMs = FRAME_HOP_MS,
): PacketAnim[] {
  const ts = Date.now()
  const first = deliveries[0]?.step ?? 0
  return deliveries.map((d, i) => {
    const edge = edges.find((e) => e.id === d.edgeId)
    const { protocol, label } = frameLabel(d)
    return {
      id: `frm-${ts}-${i}-${d.step}`,
      edgeId: d.edgeId,
      protocol,
      label,
      delayMs: (d.step - first) * hopMs,
      durationMs: hopMs,
      reverse: edge ? edge.target === d.fromNodeId : false,
    }
  })
}

export interface PingFlags {
  target: string
  count: number
  verbose: boolean
  step: boolean
}

/** Parse `ping [-c N | -n N] [-v] [--step] <target>` */
export function parsePingArgs(args: string[]): PingFlags {
  let count = 0
  let verbose = false
  let step = false
  let target = ''
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if ((a === '-c' || a === '-n') && args[i + 1]) {
      count = Math.max(1, Math.min(10, parseInt(args[++i]!, 10) || 1))
    } else if (a === '-v') verbose = true
    else if (a === '--step' || a === '-step' || a === '/step') step = true
    else if (!a.startsWith('-')) target = a
  }
  return { target, count: count || (step ? 1 : 4), verbose, step }
}

export function pingResults(sim: FrameSim, pingId: string, count: number): PingResult[] {
  const out: PingResult[] = []
  for (let s = 0; s < count; s++) {
    out.push(sim.results.get(`${pingId}:${s}`) ?? { seq: s, status: 'timeout' })
  }
  return out
}

export function pingSummaryLines(target: string, results: PingResult[]): string[] {
  const lines: string[] = []
  for (const r of results) {
    if (r.status === 'reply') {
      lines.push(`64 bytes from ${r.fromIp ?? target}: icmp_seq=${r.seq} ttl=${r.ttl} time=${r.links ?? 1} ms`)
    } else if (r.status === 'unreachable') {
      lines.push(`From ${r.fromIp ?? '?'} icmp_seq=${r.seq} Destination Host Unreachable`)
    } else if (r.status === 'no-route') {
      lines.push(`ping: connect: Network is unreachable (icmp_seq=${r.seq})`)
    } else {
      lines.push(`Request timeout for icmp_seq ${r.seq}`)
    }
  }
  const received = results.filter((r) => r.status === 'reply').length
  const loss = results.length ? ((results.length - received) / results.length) * 100 : 0
  lines.push('')
  lines.push(`--- ${target} ping statistics ---`)
  lines.push(`${results.length} packets transmitted, ${received} packets received, ${loss.toFixed(1)}% packet loss`)
  const why = results.find((r) => r.status !== 'reply' && r.reason)?.reason
  if (why) lines.push(`(why: ${why})`)
  return lines
}

/** Create a simulator and queue `count` echo requests from srcId. */
export function launchPing(
  nodes: NetNode[],
  edges: NetEdge[],
  srcId: string,
  target: string,
  count: number,
): { sim: FrameSim; pingId: string } {
  const sim = new FrameSim(nodes, edges)
  const pingId = `p${Date.now().toString(36)}`
  for (let s = 0; s < count; s++) sim.ping(srcId, target, s, pingId)
  return { sim, pingId }
}
