import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface DeviationTypeTooltipProps {
  type: 'activities' | 'flow' | 'lanes' | 'endEvent' | 'unexpectedFrequency' | 'unexpectedPerformance' | 'unexpectedLanes' | 'modelMismatch'
}

export function DeviationTypeTooltip({ type }: DeviationTypeTooltipProps) {
  const { t } = useTranslation()
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current
    const parent = tooltip?.parentElement
    if (!tooltip || !parent) return

    const tooltipWidth = tooltip.offsetWidth
    const tooltipHeight = tooltip.offsetHeight
    const padding = 10
    const horizontalOffset = 10
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    const parentRect = parent.getBoundingClientRect()

    let left = parentRect.right + horizontalOffset
    if (left + tooltipWidth > viewportWidth - padding) {
      left = parentRect.left - horizontalOffset - tooltipWidth
    }

    let top = parentRect.top
    if (top + tooltipHeight > viewportHeight - padding) {
      top = viewportHeight - padding - tooltipHeight
    }
    if (top < padding) {
      top = padding
    }

    setPosition({ left, top })
  }, [type])
  
  return (
    <div
      ref={tooltipRef}
      className="fixed border border-[#808080] bg-white z-50 w-80 rounded-md text-black text-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
      style={{ left: position.left, top: position.top }}
    >
      <div className="text-base font-semibold mb-1 border-b border-[#808080] px-2 py-1">{t(`tooltips.${type}.title`)}</div>
      <div className="px-2 pb-2 pt-1 text-black text-sm font-normal">{t(`tooltips.${type}.description`)}</div>
    </div>
  )
}