import type { NetNode, NetEdge, NodeData, DeviceType } from '../types'

function mac(s: string): string { return s } // fixed MACs for presets

export function node(
  id: string,
  deviceType: DeviceType,
  label: string,
  ip: string,
  position: { x: number; y: number },
  extra: Partial<NodeData> = {},
): NetNode {
  return {
    id,
    type: 'device',
    position,
    data: {
      label,
      deviceType,
      ip,
      wanIp: '',
      subnet: ['switch', 'hub', 'cloud'].includes(deviceType) ? '' : '255.255.255.0',
      gateway: ['switch', 'hub', 'cloud', 'router', 'gateway'].includes(deviceType) ? '' : ip.replace(/\.\d+$/, '.1'),
      mac: mac(`aa:bb:cc:dd:${id.slice(-2).padStart(2, '0')}:01`),
      isOn: true,
      routingTable: [],
      dhcpEnabled: false,
      dhcpPool: '100-200',
      macTable: [],
      ssid: 'NetworX-WiFi',
      wpaKey: 'password123',
      band: '2.4GHz',
      rules: [],
      dnsRecords: [],
      pageContent: deviceType === 'web'
        ? `<!DOCTYPE html>\n<html>\n<head>\n  <title>${label}</title>\n</head>\n<body>\n  <h1>Welcome to ${label}</h1>\n  <p>This page is served from <strong>${ip}</strong>.</p>\n  <p>Edit this content in the Configure panel &rarr; Page tab.</p>\n</body>\n</html>`
        : '',
      termHistory: [],
      notes: '',
      ...extra,
    },
  }
}

/** sourceHandle: st | sl | sr | sb, targetHandle: t | l | r | b (sides of the node) */
export function edge(id: string, source: string, target: string, wireless = false, handles?: [string, string]): NetEdge {
  return {
    id,
    source,
    target,
    ...(handles ? { sourceHandle: handles[0], targetHandle: handles[1] } : {}),
    animated: wireless,
    style: wireless
      ? { stroke: '#6366f1', strokeDasharray: '6 3' }
      : { stroke: '#374151' },
    label: wireless ? 'Wi-Fi' : undefined,
  }
}

export interface Preset {
  id: string
  name: string
  description: string
  nodes: NetNode[]
  edges: NetEdge[]
}

// ─── Exercise 1: one subnet, two switches, no router ────────────────────────

const ex1SwitchesOnly: Preset = {
  id: 'ex1-switches-only',
  name: 'Exercise 1: Switches Only (One Subnet)',
  description: 'Four PCs on one subnet (192.168.1.0/24) joined by two switches. No router: switches forward frames by MAC address. Try: on PC1 run ping --step 192.168.1.13 and watch the ARP broadcast, then both MAC tables fill.',
  nodes: [
    node('pc1', 'pc', 'PC1', '192.168.1.10', { x: 60, y: 60 },  { gateway: '', mac: '00:1a:2b:00:00:01' }),
    node('pc2', 'pc', 'PC2', '192.168.1.11', { x: 60, y: 300 }, { gateway: '', mac: '00:1a:2b:00:00:02' }),
    node('sw1', 'switch', 'SW1', '', { x: 280, y: 180 }, { mac: '00:1a:2b:00:01:00' }),
    node('sw2', 'switch', 'SW2', '', { x: 560, y: 180 }, { mac: '00:1a:2b:00:02:00' }),
    node('pc3', 'pc', 'PC3', '192.168.1.12', { x: 780, y: 60 },  { gateway: '', mac: '00:1a:2b:00:00:03' }),
    node('pc4', 'pc', 'PC4', '192.168.1.13', { x: 780, y: 300 }, { gateway: '', mac: '00:1a:2b:00:00:04' }),
  ],
  edges: [
    edge('e1', 'pc1', 'sw1', false, ['sr', 'l']),
    edge('e2', 'pc2', 'sw1', false, ['sr', 'l']),
    edge('e3', 'sw1', 'sw2', false, ['sr', 'l']),
    edge('e4', 'sw2', 'pc3', false, ['sr', 'l']),
    edge('e5', 'sw2', 'pc4', false, ['sr', 'l']),
  ],
}

// ─── Exercise 2: two subnets joined by a router ─────────────────────────────

const ex2TwoSubnets: Preset = {
  id: 'ex2-two-subnets',
  name: 'Exercise 2: Two Subnets and a Router',
  description: 'Same four PCs, now split into 192.168.1.0/24 (SW1) and 192.168.2.0/24 (SW2). A switch alone cannot join two subnets, so R1 routes between them. Try: on PC1 run ping --step 192.168.2.10 and see PC1 ARP for its default gateway, not for PC3.',
  nodes: [
    node('pc1', 'pc', 'PC1', '192.168.1.10', { x: 60, y: 60 },  { mac: '00:1a:2b:00:00:01' }),
    node('pc2', 'pc', 'PC2', '192.168.1.11', { x: 60, y: 300 }, { mac: '00:1a:2b:00:00:02' }),
    node('sw1', 'switch', 'SW1', '', { x: 240, y: 180 }, { mac: '00:1a:2b:00:01:00' }),
    node('r1', 'router', 'R1', '192.168.1.1', { x: 420, y: 180 }, {
      mac: '00:1a:2b:00:0a:00',
      interfaces: {
        '@sw1': { ip: '192.168.1.1', subnet: '255.255.255.0' },
        '@sw2': { ip: '192.168.2.1', subnet: '255.255.255.0' },
      },
      notes: 'One interface in each subnet. Both networks are directly connected, so no static routes are needed.',
    }),
    node('sw2', 'switch', 'SW2', '', { x: 600, y: 180 }, { mac: '00:1a:2b:00:02:00' }),
    node('pc3', 'pc', 'PC3', '192.168.2.10', { x: 780, y: 60 },  { mac: '00:1a:2b:00:00:03' }),
    node('pc4', 'pc', 'PC4', '192.168.2.11', { x: 780, y: 300 }, { mac: '00:1a:2b:00:00:04' }),
  ],
  edges: [
    edge('e1', 'pc1', 'sw1', false, ['sr', 'l']),
    edge('e2', 'pc2', 'sw1', false, ['sr', 'l']),
    edge('e3', 'sw1', 'r1', false, ['sr', 'l']),
    edge('e4', 'r1', 'sw2', false, ['sr', 'l']),
    edge('e5', 'sw2', 'pc3', false, ['sr', 'l']),
    edge('e6', 'sw2', 'pc4', false, ['sr', 'l']),
  ],
}

// ─── Exercise 3: the same network, now on the internet (default route + NAT) ─

const ex3Internet: Preset = {
  id: 'ex3-internet-nat',
  name: 'Exercise 3: Connecting to the Internet',
  description: 'Exercise 2 plus an internet link. R1 has a default route (0.0.0.0/0) to the ISP and uses NAT to swap each PC\'s private address for its one public address, 203.0.113.2. Try: on PC1 run ping --step 8.8.8.8 and watch the source IP change at R1, then open R1 → Routing to see the NAT table. Then, on the 8.8.8.8 server, ping 203.0.113.3: it works, because PC4 has a static NAT entry. Ping 192.168.1.10 instead and it fails at the ISP, because private addresses are not routed on the internet.',
  nodes: [
    node('pc1', 'pc', 'PC1', '192.168.1.10', { x: 60, y: 60 },  { mac: '00:1a:2b:00:00:01' }),
    node('pc2', 'pc', 'PC2', '192.168.1.11', { x: 60, y: 300 }, { mac: '00:1a:2b:00:00:02' }),
    node('sw1', 'switch', 'SW1', '', { x: 240, y: 180 }, { mac: '00:1a:2b:00:01:00' }),
    node('r1', 'router', 'R1', '192.168.1.1', { x: 420, y: 180 }, {
      mac: '00:1a:2b:00:0a:00',
      interfaces: {
        '@sw1': { ip: '192.168.1.1', subnet: '255.255.255.0' },
        '@sw2': { ip: '192.168.2.1', subnet: '255.255.255.0' },
        '@isp': { ip: '203.0.113.2', subnet: '255.255.255.248' },
      },
      routingTable: [
        { destination: '0.0.0.0', subnet: '0.0.0.0', gateway: '203.0.113.1', iface: '', metric: 0 },
      ],
      nat: { outside: '@isp', static: [{ inside: '192.168.2.11', outside: '203.0.113.3' }] },
      notes: 'Default route 0.0.0.0/0 via the ISP (203.0.113.1): anything not on a connected network goes to the internet. NAT outside interface faces the ISP, so private 192.168.x.x sources leave as 203.0.113.2. PC4 has a static NAT entry: it always uses its own public address 203.0.113.3, so the internet can start a conversation with it.',
    }),
    node('sw2', 'switch', 'SW2', '', { x: 600, y: 180 }, { mac: '00:1a:2b:00:02:00' }),
    node('pc3', 'pc', 'PC3', '192.168.2.10', { x: 780, y: 60 },  { mac: '00:1a:2b:00:00:03' }),
    node('pc4', 'pc', 'PC4', '192.168.2.11', { x: 780, y: 300 }, { mac: '00:1a:2b:00:00:04' }),
    node('isp', 'cloud', 'Internet (ISP)', '', { x: 420, y: -60 }, {
      mac: '00:1a:2b:00:0b:00',
      interfaces: {
        '@r1':   { ip: '203.0.113.1', subnet: '255.255.255.248' },
        '@srv1': { ip: '8.8.8.1', subnet: '255.255.255.0' },
      },
      notes: 'The ISP\'s router. It only knows public addresses: it can reach R1\'s 203.0.113.2, but has no route to any 192.168.x.x network.',
    }),
    node('srv1', 'server', 'Server 8.8.8.8', '8.8.8.8', { x: 700, y: -60 }, {
      mac: '00:1a:2b:00:0c:00',
      notes: 'A public server on the internet.',
    }),
  ],
  edges: [
    edge('e1', 'pc1', 'sw1', false, ['sr', 'l']),
    edge('e2', 'pc2', 'sw1', false, ['sr', 'l']),
    edge('e3', 'sw1', 'r1', false, ['sr', 'l']),
    edge('e4', 'r1', 'sw2', false, ['sr', 'l']),
    edge('e5', 'sw2', 'pc3', false, ['sr', 'l']),
    edge('e6', 'sw2', 'pc4', false, ['sr', 'l']),
    edge('e7', 'r1', 'isp', false, ['st', 'b']),
    edge('e8', 'isp', 'srv1', false, ['sr', 'l']),
  ],
}

export const PRESETS: Preset[] = [
  ex1SwitchesOnly,
  ex2TwoSubnets,
  ex3Internet,
]
