// Run with: node --experimental-strip-types scripts/frames.test.ts
import { FrameSim, formatStep } from '../src/simulation/frames.ts'
import type { NetNode, NetEdge, NodeData } from '../src/types/index.ts'
import { PRESETS } from '../src/simulation/presets.ts'
import { TEST_PRESETS } from '../src/simulation/testPresets.ts'

let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

let macN = 0
function dev(id: string, deviceType: NodeData['deviceType'], extra: Partial<NodeData> = {}): NetNode {
  macN++
  return {
    id,
    type: 'device',
    position: { x: 0, y: 0 },
    data: {
      label: id.toUpperCase(),
      deviceType,
      ip: '',
      wanIp: '',
      subnet: '255.255.255.0',
      gateway: '',
      mac: `02:00:00:00:${macN.toString(16).padStart(2, '0')}:00`,
      isOn: true,
      routingTable: [],
      dhcpEnabled: false,
      dhcpPool: '100-200',
      macTable: [],
      ssid: '',
      wpaKey: '',
      band: '2.4GHz',
      rules: [],
      dnsRecords: [],
      pageContent: '',
      termHistory: [],
      notes: '',
      ...extra,
    },
  }
}
function link(a: string, b: string): NetEdge {
  return { id: `e-${a}-${b}`, source: a, target: b }
}
function pingAll(sim: FrameSim, src: string, dst: string, count: number) {
  const id = `t${Math.random()}`
  for (let s = 0; s < count; s++) sim.ping(src, dst, s, id)
  sim.run()
  return [...sim.results.entries()].filter(([k]) => k.startsWith(id)).map(([, r]) => r)
}

// ── 1. One switch, three PCs ──────────────────────────────────────────────────
console.log('1. LAN: PC1 pings PC2 through SW1')
{
  const nodes = [
    dev('pc1', 'pc', { ip: '192.168.1.10' }),
    dev('pc2', 'pc', { ip: '192.168.1.11' }),
    dev('pc3', 'pc', { ip: '192.168.1.12' }),
    dev('sw1', 'switch', { subnet: '' }),
  ]
  const edges = [link('pc1', 'sw1'), link('pc2', 'sw1'), link('pc3', 'sw1')]
  const sim = new FrameSim(nodes, edges)
  const res = pingAll(sim, 'pc1', '192.168.1.11', 1)
  for (const rec of sim.log) console.log(formatStep(sim, rec).map((l) => '     ' + l).join('\n'))
  check('reply received', res[0]?.status === 'reply', JSON.stringify(res[0]))
  check('ttl 64 on same LAN', res[0]?.ttl === 64)
  check('first frame is ARP broadcast', sim.log[0]?.delivery.frame.kind === 'ARP_REQUEST')
  check('switch floods ARP to 2 ports', sim.log.filter((r) => r.delivery.fromNodeId === 'sw1' && r.delivery.frame.kind === 'ARP_REQUEST').length === 2)
  check('PC3 ignores ARP for someone else', sim.log.some((r) => r.delivery.toNodeId === 'pc3' && r.actions.join().includes('ignored')))
  const table = sim.macTableEntries('sw1')
  check('switch learned PC1 and PC2', table.length === 2, JSON.stringify(table))
  check('PC1 ARP cache has PC2', sim.arpEntries('pc1').some((a) => a.ip === '192.168.1.11'))
  check('PC2 learned PC1 from the request', sim.arpEntries('pc2').some((a) => a.ip === '192.168.1.10'))

  const before = sim.log.length
  const res2 = pingAll(sim, 'pc1', '192.168.1.11', 1)
  const newFrames = sim.log.slice(before)
  check('second ping skips ARP', newFrames.every((r) => !r.delivery.frame.kind.startsWith('ARP')))
  check('second ping known unicast, no flooding', newFrames.every((r) => !r.actions.join().includes('flood')))
  check('second ping replied', res2[0]?.status === 'reply')
}

// ── 2. Router with three interfaces (lab 4) ───────────────────────────────────
console.log('2. Router joins 15.0.0.0/8, 182.98.0.0/16, 201.191.20.0/24')
{
  const nodes = [
    dev('pc1', 'pc', { ip: '15.0.0.1', subnet: '255.0.0.0', gateway: '15.255.255.254' }),
    dev('pc2', 'pc', { ip: '182.98.0.1', subnet: '255.255.0.0', gateway: '182.98.255.254' }),
    dev('pc3', 'pc', { ip: '201.191.20.1', subnet: '255.255.255.0', gateway: '201.191.20.254' }),
    dev('sw1', 'switch'), dev('sw2', 'switch'), dev('sw3', 'switch'),
    dev('r1', 'router', {
      interfaces: {
        'G0/0': { ip: '15.255.255.254', subnet: '255.0.0.0' },
        'G0/1': { ip: '182.98.255.254', subnet: '255.255.0.0' },
        'G0/2': { ip: '201.191.20.254', subnet: '255.255.255.0' },
      },
    }),
  ]
  // edge ids sorted: e-r1-sw1 (G0/0), e-r1-sw2 (G0/1), e-r1-sw3 (G0/2)
  const edges = [link('pc1', 'sw1'), link('r1', 'sw1'), link('r1', 'sw2'), link('pc2', 'sw2'), link('r1', 'sw3'), link('pc3', 'sw3')]
  const sim = new FrameSim(nodes, edges)
  const names = sim.ifaces.get('r1')!.map((i) => `${i.name}=${i.ip}`)
  check('router interfaces addressed', names.join(',') === 'G0/0=15.255.255.254,G0/1=182.98.255.254,G0/2=201.191.20.254', names.join(','))
  const res = pingAll(sim, 'pc1', '201.191.20.1', 4)
  check('all 4 replies', res.every((r) => r.status === 'reply'), JSON.stringify(res))
  check('ttl decremented once', res[0]?.ttl === 63)
  check('PC1 ARPs for its gateway, not PC3', sim.log[0]?.delivery.frame.targetIp === '15.255.255.254')
  const rewritten = sim.log.find((r) => r.delivery.fromNodeId === 'r1' && r.delivery.frame.kind === 'ICMP_ECHO_REQUEST')
  check('router rewrites source MAC to its egress interface', rewritten?.delivery.frame.srcMac === sim.ifaces.get('r1')![2]!.mac)
  check('router ARP cache has PC3', sim.arpEntries('r1').some((a) => a.ip === '201.191.20.1' && a.iface === 'G0/2'))
}

// ── 3. Wrong default gateway ──────────────────────────────────────────────────
console.log('3. PC with a gateway nobody owns')
{
  const nodes = [
    dev('pc1', 'pc', { ip: '192.168.1.10', gateway: '192.168.1.254' }),
    dev('sw1', 'switch'),
    dev('r1', 'router', { ip: '192.168.1.1' }),
  ]
  const sim = new FrameSim(nodes, [link('pc1', 'sw1'), link('r1', 'sw1')])
  const res = pingAll(sim, 'pc1', '10.0.0.5', 2)
  check('destination host unreachable', res.every((r) => r.status === 'unreachable'), JSON.stringify(res))
  check('only one ARP request for both packets', sim.log.filter((r) => r.delivery.fromNodeId === 'pc1').length === 1)
}

// ── 4. Two routers, return route missing then added ───────────────────────────
console.log('4. Remote router needs a route back')
{
  const mk = (withRoute: boolean) => {
    const nodes = [
      dev('pc1', 'pc', { ip: '192.168.1.10', gateway: '192.168.1.1' }),
      dev('sw1', 'switch'),
      dev('r1', 'router', { interfaces: { 'G0/0': { ip: '10.0.0.1', subnet: '255.255.255.0' }, 'G0/1': { ip: '192.168.1.1', subnet: '255.255.255.0' } } }),
      dev('r2', 'router', {
        ip: '10.0.0.2',
        routingTable: withRoute ? [{ destination: '0.0.0.0', subnet: '0.0.0.0', gateway: '10.0.0.1', iface: 'G0/0', metric: 0 }] : [],
      }),
    ]
    // e-r1-r2 sorts before e-r1-sw1, so R1 G0/0 faces R2 and G0/1 faces SW1
    return new FrameSim(nodes, [link('pc1', 'sw1'), link('r1', 'sw1'), link('r1', 'r2')])
  }
  const a = mk(false)
  const ra = pingAll(a, 'pc1', '10.0.0.2', 1)
  check('without return route: no reply', ra[0]?.status !== 'reply', JSON.stringify(ra[0]))
  check('R2 logs no route back', a.log.some((r) => r.actions.join().includes('no route to 192.168.1.10')))
  const b = mk(true)
  const rb = pingAll(b, 'pc1', '10.0.0.2', 1)
  check('with default route: reply', rb[0]?.status === 'reply', JSON.stringify(rb[0]))
  check('reply ttl 63', rb[0]?.ttl === 63)
}

// ── 5. Different subnet, no gateway set ───────────────────────────────────────
console.log('5. Host without a gateway pings another subnet')
{
  const nodes = [dev('pc1', 'pc', { ip: '192.168.1.10' }), dev('sw1', 'switch')]
  const sim = new FrameSim(nodes, [link('pc1', 'sw1')])
  const res = pingAll(sim, 'pc1', '8.8.8.8', 1)
  check('no route', res[0]?.status === 'no-route', JSON.stringify(res[0]))
  check('no frames sent', sim.log.length === 0)
}

// ── 6. Hub repeats, does not learn ────────────────────────────────────────────
console.log('6. Hub vs switch')
{
  const nodes = [dev('pc1', 'pc', { ip: '10.1.1.1' }), dev('pc2', 'pc', { ip: '10.1.1.2' }), dev('pc3', 'pc', { ip: '10.1.1.3' }), dev('hub1', 'hub')]
  const sim = new FrameSim(nodes, [link('pc1', 'hub1'), link('pc2', 'hub1'), link('pc3', 'hub1')])
  pingAll(sim, 'pc1', '10.1.1.2', 1)
  check('pc3 sees the unicast echo too (hub repeats)', sim.log.some((r) => r.delivery.toNodeId === 'pc3' && r.delivery.frame.kind === 'ICMP_ECHO_REQUEST'))
}


// ── 7. Presets behave like the real thing ─────────────────────────────────────
console.log('7. Presets')
{
  const preset = (id: string) => TEST_PRESETS.find((p) => p.id === id)!
  const hosts = (p: ReturnType<typeof preset>) =>
    p.nodes.filter((n) => ['pc', 'laptop', 'server', 'web', 'dns'].includes(n.data.deviceType) && n.data.ip)
  for (const p of [...PRESETS, ...TEST_PRESETS]) {
    let ok = 0, total = 0
    for (const a of hosts(p)) for (const b of hosts(p)) {
      if (a === b) continue
      total++
      const sim = new FrameSim(p.nodes, p.edges)
      if (pingAll(sim, a.id, b.data.ip, 1)[0]?.status === 'reply') ok++
    }
    check(`${p.name}: every host reaches every host`, ok === total, `${ok}/${total}`)
  }

  const sr = preset('ccna-static-routes')
  const broken = sr.nodes.map((n) => (n.id === 'r2' ? { ...n, data: { ...n.data, routingTable: [] } } : n))
  const sim = new FrameSim(broken, sr.edges)
  const r = pingAll(sim, 'pc1', '192.168.2.10', 1)[0]
  check('static routes: deleting R2\'s route back breaks the ping', r?.status !== 'reply', JSON.stringify(r))
  check('… and the echo request still reached PC2', sim.log.some((x) => x.delivery.toNodeId === 'pc2' && x.delivery.frame.kind === 'ICMP_ECHO_REQUEST'))

  const ok2 = pingAll(new FrameSim(sr.nodes, sr.edges), 'pc1', '192.168.2.10', 1)[0]
  check('static routes: TTL 62 after two routers', ok2?.ttl === 62, JSON.stringify(ok2))

  const mesh = preset('mesh-network')
  const m = pingAll(new FrameSim(mesh.nodes, mesh.edges), 'pcA1', '10.3.0.11', 1)[0]
  check('mesh: A → C uses the direct link (TTL 62)', m?.ttl === 62, JSON.stringify(m))

  const home = preset('home-network')
  const hs = new FrameSim(home.nodes, home.edges)
  const h = pingAll(hs, 'pc1', '192.168.1.1', 1)[0]
  check('home: PC pings the gateway through its built-in switch', h?.status === 'reply', JSON.stringify(h))
  check('home: built-in switch learned the PC', hs.macTableEntries('gw1::lan').length >= 2)

  const three = preset('ccna-three-subnets')
  const t = pingAll(new FrameSim(three.nodes, three.edges), 'pc1', '201.191.20.254', 1)[0]
  check('three subnets: PC1 can ping the far interface of R1', t?.status === 'reply' && t.ttl === 64, JSON.stringify(t))
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
