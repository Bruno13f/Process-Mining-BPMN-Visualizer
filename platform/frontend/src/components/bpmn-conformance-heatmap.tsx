import { useTranslation } from 'react-i18next';

interface BpmnConformanceHeatmapProps {
  isVisible: boolean
  titleConformanceKey: string
  lessConformanceKey: string
  higherConformanceKey: string
  gradient: string
}

export function BpmnConformanceHeatmap({
  isVisible,
  titleConformanceKey,
  lessConformanceKey ,
  higherConformanceKey,
  gradient
}: BpmnConformanceHeatmapProps) {

  const { t } = useTranslation()

  return (
    <div className={
      `absolute top-2 right-2 z-10 min-w-[320px] max-w-[600px] max-h-[calc(100%-1rem)] bg-white border-[#808080] rounded-md shadow-md border flex flex-col gap-y-2 items-center justify-center px-3 py-3 ${isVisible ? '' : 'hidden'}`
    }>
      <div className="w-full flex flex-col items-start">
        <span className="text-lg font-medium mb-2">{t(titleConformanceKey)}</span>
        <div className="w-full flex flex-col gap-2">
          <div
            className="w-full h-4 rounded-xl"
            style={{
              background: gradient
            }}
          />
          <div className="relative w-full h-5 mt-1">
            <span className="absolute left-0 text-xs text-gray-600">
              {t(lessConformanceKey)}
            </span>
            <span className="absolute right-0 text-xs text-gray-600">
              {t(higherConformanceKey)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
