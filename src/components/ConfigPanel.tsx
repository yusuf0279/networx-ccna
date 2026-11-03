import { useState } from 'react'
import { X, Plus, Trash2, Power } from 'lucide-react'
import { useNetworkStore } from '../store'
import type { FirewallRule, DnsRecord } from '../types'
import { buildInterfaces } from '../simulation/frames'

interface Props {
  nodeId: string
  onClose: () => void
}

function Field({ label, value, onChange, placeholder = '', mono = false }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</label>
      <input
        className={`border border-gray-200 rounded-md px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-300 ${mono ? 'font-mono' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

export default function ConfigPanel({ nodeId, onClose }: Props) {
  const { nodes, edges, updateNodeData, addRoute, removeRoute, addRule, removeRule, addDnsRecord, removeDnsRecord } = useNetworkStore()
  const node = nodes.find((n) => n.id === nodeId)
  const [tab, setTab] = useState<'basic' | 'advanced' | 'security' | 'wireless' | 'page' | 'records'>('basic')

  if (!node) return null

  const { data } = node
  const upd = (patch: Parameters<typeof updateNodeData>[1]) => updateNodeData(nodeId, patch)

  function handleAddRoute() {
    addRoute(nodeId, { destination: '10.0.0.0', subnet: '255.255.255.0', gateway: '0.0.0.0', iface: 'G0/0', metric: 1 })
  }

  function handleAddDnsRecord() {
    addDnsRecord(nodeId, {
      id: `dr${Date.now()}`,
      hostname: 'host.local',
      ip: '192.168.1.',
    } satisfies DnsRecord)
  }

  function handleAddRule() {
    addRule(nodeId, {
      id: `r${Date.now()}`,
      direction: 'in',
      protocol: 'TCP',
      srcIp: '*',
      dstIp: '*',
      port: '80',
      action: 'allow',
    })
  }

  const isRouter = data.deviceType === 'router'
  const isSwitch = data.deviceType === 'switch'
  const isHub = data.deviceType === 'hub'
  const isWap = data.deviceType === 'wap'
  const isFirewall = data.deviceType === 'firewall'
  const isGateway = data.deviceType === 'gateway'
  const isWeb = data.deviceType === 'web'
  const isDns = data.deviceType === 'dns'
  const hasIp = !(isSwitch || isHub)

  const TABS = [
    { id: 'basic',    label: 'Basic' },
    ...(isSwitch                        ? [{ id: 'advanced', label: 'MAC Table' }] : []),
    ...((isRouter   || isGateway)       ? [{ id: 'advanced', label: 'Routing' }]   : []),
    ...((isWap      || isGateway)       ? [{ id: 'wireless', label: 'Wireless' }]  : []),
    ...((isFirewall || isGateway)       ? [{ id: 'security', label: 'Security' }]  : []),
    ...(isWeb                           ? [{ id: 'page',     label: 'Page' }]       : []),
    ...(isDns                           ? [{ id: 'records',  label: 'Records' }]    : []),
  ] as { id: string; label: string }[]

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div>
          <h2 className="font-semibold text-gray-800 text-sm">{data.label}</h2>
          <span className="text-xs text-gray-400 capitalize">{data.deviceType}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
              data.isOn ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'
            }`}
            onClick={() => upd({ isOn: !data.isOn })}
          >
            <Power size={11} />
            {data.isOn ? 'Online' : 'Offline'}
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      {TABS.length > 1 && (
        <div className="flex border-b border-gray-200 px-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setTab(t.id as typeof tab)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === 'basic' && (
          <>
            <Field label="Label" value={data.label} onChange={(v) => upd({ label: v })} />
            {hasIp && (
              <>
                {(isRouter || isGateway) && (
                  <Field label="WAN IP — eth0 (ISP-facing)" value={(data.wanIp as string) ?? ''} onChange={(v) => upd({ wanIp: v })} placeholder="e.g. 82.1.2.3" mono />
                )}
                <Field label={(isRouter || isGateway) ? 'LAN IP — eth1 (network-facing)' : 'IP Address'} value={data.ip} onChange={(v) => upd({ ip: v })} placeholder="192.168.1.x" mono />
                <Field label="Subnet Mask" value={data.subnet} onChange={(v) => upd({ subnet: v })} placeholder="255.255.255.0" mono />
                <Field label="Default Gateway" value={data.gateway} onChange={(v) => upd({ gateway: v })} placeholder="192.168.1.1" mono />
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">MAC Address</label>
                  <span className="font-mono text-sm text-gray-600 bg-gray-50 rounded-md px-2.5 py-1.5 border border-gray-100">
                    {data.mac}
                  </span>
                </div>
              </>
            )}
            {/* DHCP server section — routers and gateways */}
            {(isRouter || isGateway) && (
              <div className="border border-gray-100 rounded-lg p-3 space-y-3 bg-gray-50">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-gray-700">DHCP Server</div>
                    <div className="text-xs text-gray-400">Auto-assign IPs to clients</div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={!!data.dhcpEnabled}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                      data.dhcpEnabled ? 'bg-blue-500' : 'bg-gray-300'
                    }`}
                    onClick={() => upd({ dhcpEnabled: !data.dhcpEnabled })}
                    title="Toggle DHCP server"
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
                      data.dhcpEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`} />
                  </button>
                </div>
                {data.dhcpEnabled && (
                  <>
                    <Field
                      label="IP Pool (last octet range)"
                      value={(data.dhcpPool as string) ?? '100-200'}
                      onChange={(v) => upd({ dhcpPool: v })}
                      placeholder="100-200"
                      mono
                    />
                    <p className="text-xs text-gray-400">
                      Clients run <code className="bg-gray-100 px-1 rounded font-mono">dhclient</code> or{' '}
                      <code className="bg-gray-100 px-1 rounded font-mono">ipconfig /renew</code> to get an IP from the pool.
                    </p>
                  </>
                )}
              </div>
            )}
            <Field label="Notes" value={data.notes} onChange={(v) => upd({ notes: v })} placeholder="Add notes..." />
          </>
        )}

        {tab === 'advanced' && (isRouter || isGateway) && (
          <div>
            {isRouter && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-1">Interfaces</h3>
              <p className="text-xs text-gray-400 mb-2">
                One interface per cable, numbered in the order the cables were made. Each interface needs its own IP and subnet mask.
              </p>
              {(() => {
                const ifaces = buildInterfaces(nodes, edges).get(nodeId) ?? []
                if (ifaces.length === 0) {
                  return <p className="text-xs text-gray-400">Connect a cable to create an interface.</p>
                }
                return (
                  <div className="space-y-2">
                    {ifaces.map((iface) => {
                      const peer = nodes.find((n) => n.id === iface.peerNodeId)
                      const cfg = data.interfaces?.[iface.name]
                      const setIface = (patch: { ip?: string; subnet?: string }) =>
                        upd({
                          interfaces: {
                            ...(data.interfaces ?? {}),
                            [iface.name]: {
                              ip: patch.ip ?? cfg?.ip ?? iface.ip,
                              subnet: patch.subnet ?? cfg?.subnet ?? (iface.mask || '255.255.255.0'),
                            },
                          },
                        })
                      return (
                        <div key={iface.name} className="border border-gray-100 rounded-md p-2 bg-gray-50">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="font-mono font-semibold text-gray-700">{iface.name}</span>
                            <span className="text-gray-400">to {peer?.data.label ?? '?'}</span>
                          </div>
                          <div className="flex gap-1">
                            <input
                              className="flex-1 min-w-0 border border-gray-200 rounded px-1.5 py-1 text-xs font-mono"
                              value={cfg?.ip ?? iface.ip}
                              placeholder="IP address"
                              onChange={(e) => setIface({ ip: e.target.value })}
                            />
                            <input
                              className="flex-1 min-w-0 border border-gray-200 rounded px-1.5 py-1 text-xs font-mono"
                              value={cfg?.subnet ?? iface.mask}
                              placeholder="255.255.255.0"
                              onChange={(e) => setIface({ subnet: e.target.value })}
                            />
                          </div>
                          <div className="text-[10px] text-gray-400 font-mono mt-1">MAC {iface.mac}</div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
            )}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Routing Table</h3>
              <button
                className="flex items-center gap-1 text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded transition-colors"
                onClick={handleAddRoute}
              >
                <Plus size={12} /> Add Route
              </button>
            </div>
            <div className="space-y-2">
              {data.routingTable.map((route, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3 text-xs font-mono space-y-1.5 relative">
                  <button
                    className="absolute top-2 right-2 text-gray-300 hover:text-red-400 transition-colors"
                    onClick={() => removeRoute(nodeId, i)}
                  >
                    <Trash2 size={12} />
                  </button>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pr-5">
                    {(['destination', 'subnet', 'gateway', 'iface'] as const).map((field) => (
                      <div key={field}>
                        <div className="text-gray-400 text-xs">{field}</div>
                        <input
                          className="w-full bg-white border border-gray-200 rounded px-1.5 py-0.5 font-mono text-xs"
                          value={route[field]}
                          onChange={(e) => {
                            const updated = data.routingTable.map((r, idx) =>
                              idx === i ? { ...r, [field]: e.target.value } : r
                            )
                            upd({ routingTable: updated })
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {data.routingTable.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">
                  No static routes. Directly connected networks are routed automatically.
                </p>
              )}
            </div>
            <div className="flex items-center justify-between mt-5 mb-2">
              <h3 className="text-sm font-semibold text-gray-700">ARP Cache</h3>
              {(data.arpCache?.length ?? 0) > 0 && (
                <button
                  className="flex items-center gap-1 text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 px-2 py-1 rounded transition-colors"
                  onClick={() => upd({ arpCache: [] })}
                >
                  <Trash2 size={12} /> Clear
                </button>
              )}
            </div>
            {(data.arpCache?.length ?? 0) === 0 ? (
              <p className="text-xs text-gray-400 text-center py-2">Empty. Fills when the router ARPs for a next hop.</p>
            ) : (
              <table className="w-full text-xs font-mono">
                <tbody>
                  {data.arpCache!.map((e) => (
                    <tr key={e.ip} className="border-b border-gray-50">
                      <td className="py-1">{e.ip}</td>
                      <td className="py-1 text-blue-600">{e.mac}</td>
                      <td className="py-1 text-right">{e.iface}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'advanced' && isSwitch && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">MAC Address Table</h3>
              {data.macTable.length > 0 && (
                <button
                  className="flex items-center gap-1 text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 px-2 py-1 rounded transition-colors"
                  onClick={() => upd({ macTable: [] })}
                >
                  <Trash2 size={12} /> Clear
                </button>
              )}
            </div>
            {data.macTable.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">Table empty. MAC addresses are learnt as traffic flows.</p>
            ) : (
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-100">
                    <th className="text-left py-1">MAC</th>
                    <th className="text-left py-1">Port</th>
                    <th className="text-left py-1">VLAN</th>
                  </tr>
                </thead>
                <tbody>
                  {data.macTable.map((e, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-1 text-blue-600">{e.mac}</td>
                      <td className="py-1">{e.port}</td>
                      <td className="py-1">{e.vlan}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'wireless' && (isWap || isGateway) && (
          <>
            <Field label="SSID (Network Name)" value={data.ssid} onChange={(v) => upd({ ssid: v })} />
            <Field label="WPA2 Key" value={data.wpaKey} onChange={(v) => upd({ wpaKey: v })} />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Band</label>
              <div className="flex gap-2">
                {(['2.4GHz', '5GHz'] as const).map((b) => (
                  <button
                    key={b}
                    className={`flex-1 py-1.5 text-sm rounded-md border transition-colors ${
                      data.band === b
                        ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                    onClick={() => upd({ band: b })}
                  >
                    {b}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {data.band === '2.4GHz'
                  ? '2.4 GHz: longer range, slower, more interference'
                  : '5 GHz: shorter range, faster, less congestion'}
              </p>
            </div>
          </>
        )}

        {tab === 'page' && isWeb && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-gray-400">
              Edit the HTML served by this web server. Use{' '}
              <code className="bg-gray-100 px-1 rounded font-mono">curl {data.ip}</code>{' '}
              from a terminal to fetch it.
            </p>
            <textarea
              className="font-mono text-xs bg-gray-900 text-green-400 p-3 rounded-lg resize-none outline-none border border-gray-700 focus:border-green-500 transition-colors"
              style={{ height: '280px' }}
              value={data.pageContent ?? ''}
              onChange={(e) => upd({ pageContent: e.target.value })}
              spellCheck={false}
            />
          </div>
        )}

        {tab === 'records' && isDns && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">DNS Records (A)</h3>
              <button
                className="flex items-center gap-1 text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded transition-colors"
                onClick={handleAddDnsRecord}
              >
                <Plus size={12} /> Add Record
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Local hostnames resolved by this server. Use{' '}
              <code className="bg-gray-100 px-1 rounded font-mono">nslookup host.local</code>{' '}
              from any connected device.
            </p>
            <div className="space-y-2">
              {(data.dnsRecords ?? []).map((rec) => (
                <div key={rec.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 relative">
                  <div className="flex-1 min-w-0">
                    <input
                      className="w-full font-mono text-xs border border-gray-200 rounded px-1.5 py-0.5 mb-1 bg-white"
                      placeholder="hostname.local"
                      value={rec.hostname}
                      onChange={(e) => {
                        const updated = (data.dnsRecords ?? []).map((r) =>
                          r.id === rec.id ? { ...r, hostname: e.target.value } : r
                        )
                        upd({ dnsRecords: updated })
                      }}
                    />
                    <input
                      className="w-full font-mono text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white"
                      placeholder="192.168.1.x"
                      value={rec.ip}
                      onChange={(e) => {
                        const updated = (data.dnsRecords ?? []).map((r) =>
                          r.id === rec.id ? { ...r, ip: e.target.value } : r
                        )
                        upd({ dnsRecords: updated })
                      }}
                    />
                  </div>
                  <button
                    className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                    onClick={() => removeDnsRecord(nodeId, rec.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {(data.dnsRecords ?? []).length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">
                  No records. Add an A record above.
                </p>
              )}
            </div>
          </div>
        )}

        {tab === 'security' && (isFirewall || isGateway) && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Firewall Rules</h3>
              <button
                className="flex items-center gap-1 text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded transition-colors"
                onClick={handleAddRule}
              >
                <Plus size={12} /> Add Rule
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-3">Rules are evaluated top-to-bottom. First match wins.</p>
            <div className="space-y-2">
              {data.rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`rounded-lg p-3 text-xs space-y-2 relative border ${
                    rule.action === 'allow' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                  }`}
                >
                  <button
                    className="absolute top-2 right-2 text-gray-300 hover:text-red-400 transition-colors"
                    onClick={() => removeRule(nodeId, rule.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                  <div className="grid grid-cols-3 gap-2 pr-5">
                    {/* Direction */}
                    <div>
                      <div className="text-gray-500 mb-0.5">Direction</div>
                      <select
                        className="w-full border border-gray-200 rounded px-1 py-0.5 text-xs bg-white"
                        value={rule.direction}
                        onChange={(e) => {
                          const updated = data.rules.map((r) =>
                            r.id === rule.id ? { ...r, direction: e.target.value as FirewallRule['direction'] } : r
                          )
                          upd({ rules: updated })
                        }}
                      >
                        <option value="in">Inbound</option>
                        <option value="out">Outbound</option>
                      </select>
                    </div>
                    {/* Protocol */}
                    <div>
                      <div className="text-gray-500 mb-0.5">Protocol</div>
                      <select
                        className="w-full border border-gray-200 rounded px-1 py-0.5 text-xs bg-white"
                        value={rule.protocol}
                        onChange={(e) => {
                          const updated = data.rules.map((r) =>
                            r.id === rule.id ? { ...r, protocol: e.target.value as FirewallRule['protocol'] } : r
                          )
                          upd({ rules: updated })
                        }}
                      >
                        {['TCP', 'UDP', 'ICMP', 'ANY'].map((p) => <option key={p}>{p}</option>)}
                      </select>
                    </div>
                    {/* Port */}
                    <div>
                      <div className="text-gray-500 mb-0.5">Port</div>
                      <input
                        className="w-full border border-gray-200 rounded px-1 py-0.5 text-xs font-mono bg-white"
                        value={rule.port}
                        onChange={(e) => {
                          const updated = data.rules.map((r) =>
                            r.id === rule.id ? { ...r, port: e.target.value } : r
                          )
                          upd({ rules: updated })
                        }}
                        placeholder="80 or *"
                      />
                    </div>
                    {/* Src IP */}
                    <div>
                      <div className="text-gray-500 mb-0.5">Source IP</div>
                      <input
                        className="w-full border border-gray-200 rounded px-1 py-0.5 text-xs font-mono bg-white"
                        value={rule.srcIp}
                        onChange={(e) => {
                          const updated = data.rules.map((r) =>
                            r.id === rule.id ? { ...r, srcIp: e.target.value } : r
                          )
                          upd({ rules: updated })
                        }}
                        placeholder="* or IP"
                      />
                    </div>
                    {/* Dst IP */}
                    <div>
                      <div className="text-gray-500 mb-0.5">Dest IP</div>
                      <input
                        className="w-full border border-gray-200 rounded px-1 py-0.5 text-xs font-mono bg-white"
                        value={rule.dstIp}
                        onChange={(e) => {
                          const updated = data.rules.map((r) =>
                            r.id === rule.id ? { ...r, dstIp: e.target.value } : r
                          )
                          upd({ rules: updated })
                        }}
                        placeholder="* or IP"
                      />
                    </div>
                    {/* Action */}
                    <div>
                      <div className="text-gray-500 mb-0.5">Action</div>
                      <select
                        className="w-full border border-gray-200 rounded px-1 py-0.5 text-xs bg-white"
                        value={rule.action}
                        onChange={(e) => {
                          const updated = data.rules.map((r) =>
                            r.id === rule.id ? { ...r, action: e.target.value as FirewallRule['action'] } : r
                          )
                          upd({ rules: updated })
                        }}
                      >
                        <option value="allow">Allow</option>
                        <option value="deny">Deny</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
