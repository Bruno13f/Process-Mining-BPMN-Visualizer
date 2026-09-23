import { useTranslation } from 'react-i18next'

interface MoveTypeTooltipProps {
  type: 'synchronous' | 'model' | 'log'
}

export function MoveTypeTooltip({ type }: MoveTypeTooltipProps) {
  const { t } = useTranslation()
  
  return (
    <div className="absolute border border-[#808080] bg-white left-6 top-0 z-50 w-80 rounded-md text-black text-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
      <div className="text-base font-semibold mb-1 border-b border-[#808080] px-2 py-1">{t(`tooltips.${type}.title`)}</div>
      <div className="px-2 pb-2 pt-1 text-black text-sm font-normal">{t(`tooltips.${type}.description`)}</div>
    </div>
  )
}