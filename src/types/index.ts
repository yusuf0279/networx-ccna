import type { Node, Edge } from '@xyflow/react'

export type DeviceType =
  | 'pc'
  | 'laptop'
  | 'server'
  | 'router'
  | 'switch'
  | 'hub'
  | 'wap'
  | 'firewall'
  | 'gateway'
  | 'dns'
  | 'web'
  | 'cloud'

export interface RouteEntry {
  destination: string
  subnet: string
  gateway: string
  iface: string
  metric: number
}

export interface MacEntry {
  mac: string
  port: string
  vlan: number
}

export interface ArpEntry {
  ip: string
  mac: string
  iface: string
}

/** One NAT translation (Cisco: show ip nat translations) */
export interface NatEntry {
  proto: 'icmp'
  /** private address of the inside host */
  insideLocal: string
  /** public address it is translated to (the router's outside interface) */
  insideGlobal: string
  /** the internet host it is talking to */
  outside: string
  /** ICMP query id the translation is tracked by */
  id: string
}

export interface IfaceConfig {
  ip: string
  subnet: string
}

export interface DnsRecord {
  id: string
  hostname: string
  ip: string
}

export interface FirewallRule {
  id: string
  direction: 'in' | 'out'
  protocol: 'TCP' | 'UDP' | 'ICMP' | 'ANY'
  srcIp: string
  dstIp: string
  port: string
  action: 'allow' | 'deny'
}

export interface TerminalLine {
  type: 'input' | 'output' | 'error' | 'info'
  text: string
}

export interface NodeData extends Record<string, unknown> {
  label: string
  deviceType: DeviceType
  ip: string
  wanIp: string
  subnet: string
  gateway: string
  mac: string
  isOn: boolean
  // Router
  routingTable: RouteEntry[]
  // Router DHCP server
  dhcpEnabled: boolean
  dhcpPool: string  // last-octet range, e.g. "100-200"
  // Switch
  macTable: MacEntry[]
  // WAP
  ssid: string
  wpaKey: string
  band: '2.4GHz' | '5GHz'
  // Firewall
  rules: FirewallRule[]
  // DNS server records
  dnsRecords: DnsRecord[]
  // Web server hosted page
  pageContent: string
  // Terminal history (pc, laptop, server)
  termHistory: TerminalLine[]
  // Extra info
  notes: string
  // Frame engine (optional, so older saved networks still load)
  /** Per-interface addressing, keyed by interface name (G0/0, G0/1, eth0 …) */
  interfaces?: Record<string, IfaceConfig>
  /** Subnet mask for the router's WAN address (defaults to 255.255.255.0) */
  wanSubnet?: string
  /** ARP cache filled by real ARP exchanges */
  arpCache?: ArpEntry[]
  /** NAT (PAT/overload) on this router; outside = interface name or "@<peerNodeId>" */
  nat?: { outside: string }
  /** NAT translations created by real traffic */
  natTable?: NatEntry[]
}

export type NetNode = Node<NodeData>
export type NetEdge = Edge

export type PanelType = 'config' | 'terminal' | 'browser' | 'info' | null

export interface PacketAnim {
  id: string
  edgeId: string
  protocol: 'ICMP' | 'HTTP' | 'DNS' | 'TCP' | 'UDP' | 'ARP'
  label: string
  delayMs: number
  durationMs: number
  reverse?: boolean
}
