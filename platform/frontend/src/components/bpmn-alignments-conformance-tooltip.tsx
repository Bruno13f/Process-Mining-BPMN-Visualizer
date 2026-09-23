import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ActivityMoveData {
  model_moves: number
  log_moves: number
  synchronous_moves: number
  model_moves_percentage: number
  log_moves_percentage: number
  synchronous_moves_percentage: number
}

interface BpmnAlignmentsConformanceTooltipProps {
  activityName: string
  type: string,
  moveData: ActivityMoveData
  position: { x: number; y: number }
}

export function BpmnAlignmentsConformanceTooltip({
  activityName,
  type,
  moveData,
  position
}: BpmnAlignmentsConformanceTooltipProps) {
  const { t } = useTranslation()
  const [currentPosition, setCurrentPosition] = useState(position)

  useEffect(() => {
    setCurrentPosition(position)
  }, [position])

  return (
    <div
      className="fixed z-50 bg-white border-1 border-[#808080] rounded-md pointer-events-none"
      style={{
        left: `${currentPosition.x}px`,
        top: `${currentPosition.y - 10}px`,
        transform: 'translate(-50%, -100%)',
        width: 'fit-content'
      }}
    >
      <div className="text-base font-semibold mb-2 border-b border-[#808080] pb-1 px-3 pt-1">
        {activityName}
      </div>
      
      <div className="space-y-2 px-3 pb-3">
        {type === "moves" ? (
          <>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full shrink-0"></div>
              <span className="text-sm text-black">
                {t('conformanceTooltip.synchronousMoves')}: <span className="font-semibold">{moveData.synchronous_moves}</span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-800 rounded-full shrink-0"></div>
              <span className="text-sm text-black">
                {t('conformanceTooltip.modelMoves')}: <span className="font-semibold">{moveData.model_moves}</span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-purple-600 rounded-full shrink-0"></div>
              <span className="text-sm text-black">
                {t('conformanceTooltip.logMoves')}: <span className="font-semibold">{moveData.log_moves}</span>
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full shrink-0"></div>
              <span className="text-sm text-black">
                {t('conformanceTooltip.conformantMoves')}: <span className="font-semibold">{moveData.synchronous_moves_percentage?.toFixed(2)}%</span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-red-500 rounded-full shrink-0"></div>
              <span className="text-sm text-black">
                {t('conformanceTooltip.nonConformantMoves')}: <span className="font-semibold">{(moveData.model_moves_percentage + moveData.log_moves_percentage).toFixed(2)}%</span>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
