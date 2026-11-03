import { useEffect, useRef } from 'react'
import { X, StepForward, FastForward } from 'lucide-react'
import { useNetworkStore } from '../store'
import { describeFrame, BROADCAST } from '../simulation/frames'
import type { StepRecord } from '../simulation/frames'

const KIND_STYLE: Record<string, string> = {
  ARP_REQUEST: 'bg-green-50 text-green-700 border-green-200',
  ARP_REPLY: 'bg-green-50 text-green-700 border-green-200',
  ICMP_ECHO_REQUEST: 'bg-orange-50 text-orange-700 border-orange-200',
  ICMP_ECHO_REPLY: 'bg-orange-50 text-orange-700 border-orange-200',
}

const KIND_NAME: Record<string, string> = {
  ARP_REQUEST: 'ARP request',
  ARP_REPLY: 'ARP reply',
  ICMP_ECHO_REQUEST: 'ICMP echo request',
  ICMP_ECHO_REPLY: 'ICMP echo reply',
}

/** Layers of the TCP/IP stack the current frame carries, bottom-up. */
function layersFor(rec: StepRecord): { layer: string; detail: string }[] {
  const f = rec.delivery.frame
  const l2 = {
    layer: 'Link (Ethernet)',
    detail: `src ${f.srcMac} → dst ${f.dstMac === BROADCAST ? 'ff:ff:ff:ff:ff:ff (broadcast)' : f.dstMac}`,
  }
  if (f.kind === 'ARP_REQUEST' || f.kind === 'ARP_REPLY') {
    return [
      l2,
      {
        layer: 'ARP',
        detail: f.kind === 'ARP_REQUEST'
          ? `who has ${f.targetIp}? tell ${f.senderIp}`
          : `${f.senderIp} is at ${f.senderMac}`,
      },
    ]
  }
  return [
    l2,
    { layer: 'Internet (IPv4)', detail: `${f.srcIp} → ${f.dstIp}, TTL ${f.ttl}` },
    { layer: 'ICMP', detail: `${f.kind === 'ICMP_ECHO_REQUEST' ? 'echo request' : 'echo reply'}, seq ${f.seq}` },
  ]
}

export default function FrameStepper({ left = 12 }: { left?: number }) {
  const { stepper, stepFrame, runStepper, closeStepper } = useNetworkStore()
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [stepper?.history.length])

  if (!stepper) return null
  const { sim, title, history, summary } = stepper
  const current = history[history.length - 1]
  const currentText = current ? current.actions.join(' ') : ''
  const done = !!summary

  const switchTables = [...sim.macTables.keys()].map((id) => ({ id, rows: sim.macTableEntries(id) }))
  const arpTables = [...sim.arpCaches.keys()]
    .map((id) => ({ id, rows: sim.arpEntries(id) }))
    .filter((t) => t.rows.length > 0)

  return (
    <div style={{ left }} className="absolute bottom-3 z-30 w-[480px] max-h-[78vh] flex flex-col bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
        <div>
          <div className="text-sm font-semibold text-gray-800">Frame stepper</div>
          <div className="text-xs text-gray-500">{title} · step {sim.steps} · {sim.inFlight} frame{sim.inFlight === 1 ? '' : 's'} on the wire</div>
        </div>
        <button onClick={closeStepper} className="text-gray-400 hover:text-gray-600" aria-label="Close stepper">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Before the first frame: what the sender decided */}
        {!current && (
          <div className="text-xs text-gray-600 space-y-1">
            {sim.launchNotes.length > 0
              ? sim.launchNotes.map((n, i) => <p key={i}>• {n}</p>)
              : <p>Nothing to send.</p>}
            <p className="text-gray-400">Press <b>Next frame</b> to put the first frame on the wire.</p>
          </div>
        )}

        {/* Current frame */}
        {current && (
          <div className={`border rounded-lg p-2.5 ${KIND_STYLE[current.delivery.frame.kind] ?? ''}`}>
            <div className="text-xs font-semibold">
              Step {current.step}: {KIND_NAME[current.delivery.frame.kind]}
            </div>
            <div className="text-xs mt-0.5">
              {sim.label(current.delivery.fromNodeId)} <span className="font-mono">{current.delivery.fromIface}</span>
              {' → '}
              {sim.label(current.delivery.toNodeId)} <span className="font-mono">{current.delivery.toIface}</span>
            </div>
            <table className="w-full mt-2 text-[11px]">
              <tbody>
                {layersFor(current).reverse().map((l) => (
                  <tr key={l.layer} className="border-t border-black/5">
                    <td className="py-0.5 pr-2 font-semibold whitespace-nowrap align-top">{l.layer}</td>
                    <td className="py-0.5 font-mono break-all">{l.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="mt-2 text-xs text-gray-700 space-y-0.5">
              {current.actions.map((a, i) => <li key={i}>• {a}</li>)}
            </ul>
          </div>
        )}

        {/* Ping result */}
        {summary && (
          <pre className="text-[11px] bg-gray-900 text-green-300 rounded-lg p-2 whitespace-pre-wrap">{summary.join('\n')}</pre>
        )}

        {/* Live tables */}
        <div className="grid grid-cols-2 gap-2">
          {switchTables.map((t) => (
            <div key={t.id} className="border border-gray-100 rounded-lg p-2">
              <div className="text-[11px] font-semibold text-gray-700 mb-1">{sim.label(t.id)} — MAC table</div>
              {t.rows.length === 0 ? (
                <div className="text-[11px] text-gray-400">empty</div>
              ) : (
                <table className="w-full text-[10px] font-mono">
                  <tbody>
                    {t.rows.map((r) => (
                      <tr key={r.mac} className={currentText.includes(r.mac) && currentText.includes('learns') ? 'bg-yellow-100' : ''}>
                        <td className="pr-1">{r.mac}</td>
                        <td className="text-right">{r.port}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
          {arpTables.map((t) => (
            <div key={t.id} className="border border-gray-100 rounded-lg p-2">
              <div className="text-[11px] font-semibold text-gray-700 mb-1">{sim.label(t.id)} — ARP cache</div>
              <table className="w-full text-[10px] font-mono">
                <tbody>
                  {t.rows.map((r) => (
                    <tr key={r.ip}>
                      <td className="pr-1">{r.ip}</td>
                      <td className="text-right">{r.mac}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* History */}
        {history.length > 1 && (
          <details>
            <summary className="text-xs text-gray-500 cursor-pointer">Earlier frames ({history.length - 1})</summary>
            <div ref={listRef} className="mt-1 max-h-32 overflow-y-auto text-[10px] font-mono text-gray-600 space-y-0.5">
              {history.slice(0, -1).map((r) => (
                <div key={r.step}>
                  [{r.step}] {sim.label(r.delivery.fromNodeId)} → {sim.label(r.delivery.toNodeId)}: {describeFrame(r.delivery.frame)}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-2 px-3 py-2 border-t border-gray-100 bg-gray-50">
        <button
          onClick={stepFrame}
          disabled={done}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
        >
          <StepForward size={13} /> Next frame
        </button>
        <button
          onClick={runStepper}
          disabled={done}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 disabled:opacity-40"
        >
          <FastForward size={13} /> Run to end
        </button>
        <span className="ml-auto self-center text-[11px] text-gray-400">
          {done ? 'Finished' : 'One frame per click'}
        </span>
      </div>
    </div>
  )
}
