import type { NetNode, NetEdge, NodeData, DeviceType, Level } from '../types'

function mac(s: string): string { return s } // fixed MACs for presets

function node(
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

function edge(id: string, source: string, target: string, wireless = false): NetEdge {
  return {
    id,
    source,
    target,
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
  level: Level
  nodes: NetNode[]
  edges: NetEdge[]
}

// ─── 1. Simple Star (LAN only) ───────────────────────────────────────────────

const starLan: Preset = {
  id: 'star-lan',
  name: 'Star Topology (LAN)',
  description: 'Classic star topology: a central switch connecting four workstations. Good for exploring LAN basics, switch MAC tables, and ping.',
  level: 'ks3',
  nodes: [
    node('sw1',  'switch', 'Switch',  '',              { x: 320, y: 240 }),
    node('pc1',  'pc',     'PC 1',    '192.168.1.11',  { x: 120, y: 80  }),
    node('pc2',  'pc',     'PC 2',    '192.168.1.12',  { x: 520, y: 80  }),
    node('pc3',  'pc',     'PC 3',    '192.168.1.13',  { x: 120, y: 380 }),
    node('pc4',  'pc',     'PC 4',    '192.168.1.14',  { x: 520, y: 380 }),
  ],
  edges: [
    edge('e1', 'sw1', 'pc1'),
    edge('e2', 'sw1', 'pc2'),
    edge('e3', 'sw1', 'pc3'),
    edge('e4', 'sw1', 'pc4'),
  ],
}

// ─── 2. Home Network ─────────────────────────────────────────────────────────

const homeNetwork: Preset = {
  id: 'home-network',
  name: 'Home Network',
  description: 'Typical home broadband setup: ISP → Domestic Gateway (combined router, switch, WAP and firewall) → wired PCs and wireless laptop.',
  level: 'ks4',
  nodes: [
    node('cloud1',   'cloud',    'Internet',       '0.0.0.0',       { x: 20,  y: 230 },
      { notes: 'Represents your ISP and the public internet.' }),
    node('gw1',      'gateway',  'Home Gateway',   '192.168.1.1',   { x: 240, y: 230 },
      { wanIp: '82.1.2.3',
        routingTable: [
          { destination: '0.0.0.0',     subnet: '0.0.0.0',       gateway: '0.0.0.0', iface: 'eth0', metric: 0 },
          { destination: '192.168.1.0', subnet: '255.255.255.0', gateway: '0.0.0.0', iface: 'eth1', metric: 0 },
        ],
        dhcpEnabled: true,
        dhcpPool: '100-200',
        ssid: 'HomeNet-5G',
        wpaKey: 'supersecret',
        band: '5GHz',
        rules: [
          { id: 'r1', direction: 'in', protocol: 'TCP', srcIp: '*', dstIp: '*', port: '80',  action: 'allow' },
          { id: 'r2', direction: 'in', protocol: 'ANY', srcIp: '*', dstIp: '*', port: '*',   action: 'deny'  },
        ],
        notes: 'The box from your ISP. Combines router (NAT), switch (wired ports), Wi-Fi access point, and basic firewall in one unit. DHCP assigns IPs 192.168.1.100–200 to clients.' }),
    node('pc1',      'pc',       'Desktop PC',     '192.168.1.11',  { x: 500, y: 100 }),
    node('pc2',      'pc',       'Work PC',        '192.168.1.12',  { x: 500, y: 260 }),
    node('laptop1',  'laptop',   'Laptop',         '192.168.1.20',  { x: 500, y: 400 },
      { notes: 'Connected wirelessly to HomeNet-5G' }),
  ],
  edges: [
    edge('e1', 'cloud1', 'gw1'),
    edge('e2', 'gw1',    'pc1'),
    edge('e3', 'gw1',    'pc2'),
    edge('e4', 'gw1',    'laptop1', true),
  ],
}

// ─── 3. School Network ───────────────────────────────────────────────────────

const schoolNetwork: Preset = {
  id: 'school-network',
  name: 'School Network',
  description: 'School infrastructure: Internet → Firewall → Router → Core switch → servers + classroom switch + WAP. Demonstrates network segmentation and security.',
  level: 'ks4',
  nodes: [
    node('cloud1',  'cloud',    'Internet',       '0.0.0.0',        { x: 20,  y: 330 }),
    node('fw1',     'firewall', 'Firewall',       '10.0.0.1',       { x: 200, y: 330 },
      { rules: [
          { id: 'r1', direction: 'in', protocol: 'TCP', srcIp: '*', dstIp: '*', port: '80',  action: 'allow' },
          { id: 'r2', direction: 'in', protocol: 'TCP', srcIp: '*', dstIp: '*', port: '443', action: 'allow' },
          { id: 'r3', direction: 'in', protocol: 'TCP', srcIp: '*', dstIp: '*', port: '22',  action: 'deny'  },
          { id: 'r4', direction: 'in', protocol: 'ANY', srcIp: '*', dstIp: '*', port: '*',   action: 'deny'  },
        ] }),
    node('router1', 'router',   'Core Router',    '192.168.0.1',    { x: 390, y: 330 },
      { wanIp: '10.0.0.2',
        routingTable: [
          { destination: '0.0.0.0',     subnet: '0.0.0.0',       gateway: '10.0.0.1',    iface: 'eth0', metric: 0 },
          { destination: '192.168.0.0', subnet: '255.255.255.0', gateway: '0.0.0.0',     iface: 'eth1', metric: 0 },
        ],
        dhcpEnabled: true,
        dhcpPool: '100-200' }),
    node('sw-core', 'switch',   'Core Switch',    '',               { x: 580, y: 330 }),
    node('srv1',    'server',   'File Server',    '192.168.0.10',   { x: 780, y: 120 },
      { notes: 'Central file storage for the school. Accessible to all on the LAN.' }),
    node('dns1',    'dns',      'DNS Server',     '192.168.0.53',   { x: 780, y: 230 },
      { dnsRecords: [
          { id: 'dr1', hostname: 'www.school.local',      ip: '192.168.0.80'  },
          { id: 'dr2', hostname: 'files.school.local',    ip: '192.168.0.10'  },
          { id: 'dr3', hostname: 'intranet.school.local', ip: '192.168.0.80'  },
        ] }),
    node('web1',    'web',      'Web Server',     '192.168.0.80',   { x: 780, y: 340 }),
    node('sw-cls',  'switch',   'Classroom Switch','',              { x: 780, y: 460 }),
    node('wap1',    'wap',      'Wi-Fi AP',       '192.168.0.200',  { x: 780, y: 570 },
      { ssid: 'School-WiFi', wpaKey: 'education2024', band: '5GHz' }),
    node('pc1',     'pc',       'Teacher PC',     '192.168.0.101',  { x: 990, y: 400 }),
    node('pc2',     'pc',       'Student PC 1',   '192.168.0.102',  { x: 990, y: 500 }),
    node('laptop1', 'laptop',   'Student Laptop', '192.168.0.151',  { x: 990, y: 600 },
      { notes: 'Connects wirelessly to School-WiFi' }),
  ],
  edges: [
    edge('e1',  'cloud1',  'fw1'),
    edge('e2',  'fw1',     'router1'),
    edge('e3',  'router1', 'sw-core'),
    edge('e4',  'sw-core', 'srv1'),
    edge('e5',  'sw-core', 'dns1'),
    edge('e6',  'sw-core', 'web1'),
    edge('e7',  'sw-core', 'sw-cls'),
    edge('e8',  'sw-cls',  'wap1'),
    edge('e9',  'sw-cls',  'pc1'),
    edge('e10', 'sw-cls',  'pc2'),
    edge('e11', 'wap1',    'laptop1', true),
  ],
}

// ─── 4. Client-Server ────────────────────────────────────────────────────────

const clientServer: Preset = {
  id: 'client-server',
  name: 'Client-Server Model',
  description: 'A web server and DNS server on a LAN, with three client PCs. Try nslookup and curl from a PC terminal.',
  level: 'ks4',
  nodes: [
    node('sw1',   'switch', 'Switch',      '',              { x: 320, y: 280 }),
    node('dns1',  'dns',    'DNS Server',  '192.168.1.53',  { x: 100, y: 100 },
      { notes: 'Resolves domain names to IP addresses. Try: nslookup www.local',
        dnsRecords: [
          { id: 'dr1', hostname: 'www.local',  ip: '192.168.1.80' },
          { id: 'dr2', hostname: 'web.local',  ip: '192.168.1.80' },
        ] }),
    node('web1',  'web',    'Web Server',  '192.168.1.80',  { x: 540, y: 100 },
      { notes: 'Serves HTTP pages on port 80. Try: curl www.local from a PC terminal.' }),
    node('pc1',   'pc',     'Client 1',   '192.168.1.11',  { x: 100, y: 420 }),
    node('pc2',   'pc',     'Client 2',   '192.168.1.12',  { x: 320, y: 460 }),
    node('pc3',   'pc',     'Client 3',   '192.168.1.13',  { x: 540, y: 420 }),
  ],
  edges: [
    edge('e1', 'sw1', 'dns1'),
    edge('e2', 'sw1', 'web1'),
    edge('e3', 'sw1', 'pc1'),
    edge('e4', 'sw1', 'pc2'),
    edge('e5', 'sw1', 'pc3'),
  ],
}

// ─── 5. Mesh / Internet backbone ─────────────────────────────────────────────

const meshNetwork: Preset = {
  id: 'mesh-network',
  name: 'Mesh / WAN Topology',
  description: 'Three sites connected via routers with redundant paths — like the internet backbone. Shows how packets can take multiple routes.',
  level: 'ks5',
  nodes: [
    node('cloud1',   'cloud',  'Internet',       '0.0.0.0',       { x: 320, y: 30  }),
    // Site A
    node('routerA',  'router', 'Router A',       '10.1.0.1',      { x: 80,  y: 200 },
      { wanIp: '172.16.0.1',
        interfaces: {
          '@routerB': { ip: '172.16.12.1', subnet: '255.255.255.252' },
          '@routerC': { ip: '172.16.13.1', subnet: '255.255.255.252' },
        },
        routingTable: [
          { destination: '10.2.0.0', subnet: '255.255.255.0', gateway: '172.16.12.2', iface: 'to Router B', metric: 1 },
          { destination: '10.3.0.0', subnet: '255.255.255.0', gateway: '172.16.13.2', iface: 'to Router C', metric: 1 },
        ],
        notes: 'Site A gateway. Point-to-point links: 172.16.12.0/30 to Router B, 172.16.13.0/30 to Router C. Static routes send each remote site over its direct link.' }),
    node('swA',      'switch', 'Switch A',       '',              { x: 80,  y: 360 }),
    node('pcA1',     'pc',     'PC A1',          '10.1.0.11',     { x: -80, y: 460 }),
    node('pcA2',     'pc',     'PC A2',          '10.1.0.12',     { x: 80,  y: 480 }),
    // Site B
    node('routerB',  'router', 'Router B',       '10.2.0.1',      { x: 320, y: 200 },
      { wanIp: '172.16.0.2',
        interfaces: {
          '@routerA': { ip: '172.16.12.2', subnet: '255.255.255.252' },
          '@routerC': { ip: '172.16.23.1', subnet: '255.255.255.252' },
        },
        routingTable: [
          { destination: '10.1.0.0', subnet: '255.255.255.0', gateway: '172.16.12.1', iface: 'to Router A', metric: 1 },
          { destination: '10.3.0.0', subnet: '255.255.255.0', gateway: '172.16.23.2', iface: 'to Router C', metric: 1 },
        ],
        notes: 'Site B gateway. Point-to-point links: 172.16.12.0/30 to Router A, 172.16.23.0/30 to Router C.' }),
    node('swB',      'switch', 'Switch B',       '',              { x: 320, y: 360 }),
    node('srvB',     'server', 'Server B',       '10.2.0.10',     { x: 220, y: 480 }),
    node('pcB1',     'pc',     'PC B1',          '10.2.0.11',     { x: 420, y: 480 }),
    // Site C
    node('routerC',  'router', 'Router C',       '10.3.0.1',      { x: 560, y: 200 },
      { wanIp: '172.16.0.3',
        interfaces: {
          '@routerA': { ip: '172.16.13.2', subnet: '255.255.255.252' },
          '@routerB': { ip: '172.16.23.2', subnet: '255.255.255.252' },
        },
        routingTable: [
          { destination: '10.1.0.0', subnet: '255.255.255.0', gateway: '172.16.13.1', iface: 'to Router A', metric: 1 },
          { destination: '10.2.0.0', subnet: '255.255.255.0', gateway: '172.16.23.1', iface: 'to Router B', metric: 1 },
        ],
        notes: 'Site C gateway. Try deleting the route to 10.1.0.0 and change it to go via Router B (172.16.23.1) — the packet takes the long way round.' }),
    node('swC',      'switch', 'Switch C',       '',              { x: 560, y: 360 }),
    node('pcC1',     'pc',     'PC C1',          '10.3.0.11',     { x: 460, y: 480 }),
    node('pcC2',     'pc',     'PC C2',          '10.3.0.12',     { x: 660, y: 480 }),
  ],
  edges: [
    // Internet links
    edge('ei1', 'cloud1',  'routerA'),
    edge('ei2', 'cloud1',  'routerB'),
    edge('ei3', 'cloud1',  'routerC'),
    // Inter-router (mesh) links
    edge('er1', 'routerA', 'routerB'),
    edge('er2', 'routerB', 'routerC'),
    edge('er3', 'routerA', 'routerC'),
    // LAN links
    edge('ea1', 'routerA', 'swA'),
    edge('ea2', 'swA',     'pcA1'),
    edge('ea3', 'swA',     'pcA2'),
    edge('eb1', 'routerB', 'swB'),
    edge('eb2', 'swB',     'srvB'),
    edge('eb3', 'swB',     'pcB1'),
    edge('ec1', 'routerC', 'swC'),
    edge('ec2', 'swC',     'pcC1'),
    edge('ec3', 'swC',     'pcC2'),
  ],
}


// ─── 6. CCNA: one router, three subnets ──────────────────────────────────────

const ccnaThreeSubnets: Preset = {
  id: 'ccna-three-subnets',
  name: 'CCNA: Router with Three Subnets',
  description: 'One router joins a /8, a /16 and a /24. Each PC must ARP for its default gateway, the router routes between connected networks, and the reply TTL drops by one. Try: ping --step 201.191.20.1 from PC1.',
  level: 'ks5',
  nodes: [
    node('pc1', 'pc', 'PC1', '15.0.0.1', { x: 40, y: 80 },
      { subnet: '255.0.0.0', gateway: '15.255.255.254', mac: '00:1a:2b:00:00:01' }),
    node('sw1', 'switch', 'SW1', '', { x: 220, y: 80 }, { mac: '00:1a:2b:00:01:00' }),
    node('r1', 'router', 'R1', '15.255.255.254', { x: 420, y: 200 }, {
      subnet: '255.0.0.0',
      mac: '00:1a:2b:00:0a:00',
      interfaces: {
        '@sw1': { ip: '15.255.255.254', subnet: '255.0.0.0' },
        '@sw2': { ip: '182.98.255.254', subnet: '255.255.0.0' },
        '@sw3': { ip: '201.191.20.254', subnet: '255.255.255.0' },
      },
      notes: 'Three interfaces, three networks. No static routes needed: all three are directly connected.',
    }),
    node('sw2', 'switch', 'SW2', '', { x: 420, y: 380 }, { mac: '00:1a:2b:00:02:00' }),
    node('pc2', 'pc', 'PC2', '182.98.0.1', { x: 240, y: 480 },
      { subnet: '255.255.0.0', gateway: '182.98.255.254', mac: '00:1a:2b:00:00:02' }),
    node('sw3', 'switch', 'SW3', '', { x: 640, y: 200 }, { mac: '00:1a:2b:00:03:00' }),
    node('pc3', 'pc', 'PC3', '201.191.20.1', { x: 820, y: 200 },
      { subnet: '255.255.255.0', gateway: '201.191.20.254', mac: '00:1a:2b:00:00:03' }),
  ],
  edges: [
    edge('c1', 'pc1', 'sw1'),
    edge('c2', 'sw1', 'r1'),
    edge('c3', 'r1', 'sw2'),
    edge('c4', 'sw2', 'pc2'),
    edge('c5', 'r1', 'sw3'),
    edge('c6', 'sw3', 'pc3'),
  ],
}

// ─── 7. CCNA: two routers, static routes ─────────────────────────────────────

const ccnaStaticRoutes: Preset = {
  id: 'ccna-static-routes',
  name: 'CCNA: Two Routers, Static Routes',
  description: 'Two LANs joined by a 10.0.0.0/30 link. Each router needs a static route to the far LAN, and replies need a route back. Delete one route and watch the ping fail.',
  level: 'ks5',
  nodes: [
    node('pc1', 'pc', 'PC1', '192.168.1.10', { x: 40, y: 120 }, { mac: '00:1b:00:00:00:01' }),
    node('srv1', 'server', 'SRV1', '192.168.1.100', { x: 40, y: 320 }, { mac: '00:1b:00:00:00:02' }),
    node('sw1', 'switch', 'SW1', '', { x: 220, y: 220 }, { mac: '00:1b:00:00:01:00' }),
    node('r1', 'router', 'R1', '192.168.1.1', { x: 420, y: 220 }, {
      mac: '00:1b:00:00:0a:00',
      interfaces: {
        '@sw1': { ip: '192.168.1.1', subnet: '255.255.255.0' },
        '@r2': { ip: '10.0.0.1', subnet: '255.255.255.252' },
      },
      routingTable: [
        { destination: '192.168.2.0', subnet: '255.255.255.0', gateway: '10.0.0.2', iface: 'to R2', metric: 1 },
      ],
    }),
    node('r2', 'router', 'R2', '192.168.2.1', { x: 640, y: 220 }, {
      mac: '00:1b:00:00:0b:00',
      interfaces: {
        '@r1': { ip: '10.0.0.2', subnet: '255.255.255.252' },
        '@sw2': { ip: '192.168.2.1', subnet: '255.255.255.0' },
      },
      routingTable: [
        { destination: '192.168.1.0', subnet: '255.255.255.0', gateway: '10.0.0.1', iface: 'to R1', metric: 1 },
      ],
    }),
    node('sw2', 'switch', 'SW2', '', { x: 840, y: 220 }, { mac: '00:1b:00:00:02:00' }),
    node('pc2', 'pc', 'PC2', '192.168.2.10', { x: 1020, y: 220 }, { mac: '00:1b:00:00:00:03' }),
  ],
  edges: [
    edge('d1', 'pc1', 'sw1'),
    edge('d2', 'srv1', 'sw1'),
    edge('d3', 'sw1', 'r1'),
    edge('d4', 'r1', 'r2'),
    edge('d5', 'r2', 'sw2'),
    edge('d6', 'sw2', 'pc2'),
  ],
}

// ─── 8. CCNA: switches only, watch MAC tables fill ───────────────────────────

const ccnaMacLearning: Preset = {
  id: 'ccna-mac-learning',
  name: 'CCNA: MAC Learning Across Two Switches',
  description: 'Two switches in one subnet. Ping --step from PC1 to PC4 and watch both MAC tables fill: the ARP broadcast floods everywhere, then replies travel as known unicast.',
  level: 'ks4',
  nodes: [
    node('pc1', 'pc', 'PC1', '192.168.10.11', { x: 40, y: 60 }, { mac: '00:1c:00:00:00:01' }),
    node('pc2', 'pc', 'PC2', '192.168.10.12', { x: 40, y: 300 }, { mac: '00:1c:00:00:00:02' }),
    node('sw1', 'switch', 'SW1', '', { x: 260, y: 180 }, { mac: '00:1c:00:00:01:00' }),
    node('sw2', 'switch', 'SW2', '', { x: 520, y: 180 }, { mac: '00:1c:00:00:02:00' }),
    node('pc3', 'pc', 'PC3', '192.168.10.13', { x: 740, y: 60 }, { mac: '00:1c:00:00:00:03' }),
    node('pc4', 'pc', 'PC4', '192.168.10.14', { x: 740, y: 300 }, { mac: '00:1c:00:00:00:04' }),
  ],
  edges: [
    edge('m1', 'pc1', 'sw1'),
    edge('m2', 'pc2', 'sw1'),
    edge('m3', 'sw1', 'sw2'),
    edge('m4', 'sw2', 'pc3'),
    edge('m5', 'sw2', 'pc4'),
  ],
}

export const PRESETS: Preset[] = [
  starLan,
  homeNetwork,
  schoolNetwork,
  clientServer,
  meshNetwork,
  ccnaMacLearning,
  ccnaThreeSubnets,
  ccnaStaticRoutes,
]
