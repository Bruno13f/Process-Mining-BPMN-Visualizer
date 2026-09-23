import { formatSecondsFull } from "@/utils/functions"
import { RadioGroup, RadioGroupItem } from "./ui/radio-group"
import { useTranslation } from "react-i18next";

interface BpmnPerformancePathTooltipProps {
  elementId: string, 
  x: string,
  y: string,
  selected_sojourn: number,
  paths?: Record<string, { elements: string[]; selected_sojourn?: number; average?: number }>,
  checkedByPath?: Record<string, boolean>,
  onPathSelected?: (pathKey: string) => void
}

export function BpmnPerformancePathTooltip({ elementId, x, y, selected_sojourn, paths, checkedByPath, onPathSelected }: BpmnPerformancePathTooltipProps) {
  
  const {t} = useTranslation()
  const getPathSojourn = (path: { selected_sojourn?: number; average?: number }) =>
    path.selected_sojourn ?? path.average ?? Number.NaN
  
  const sortedPaths = paths
    ? Object.entries(paths).sort(([, pathA], [, pathB]) => getPathSojourn(pathB) - getPathSojourn(pathA))
    : []

  const selectedPathKey = Object.entries(checkedByPath || {}).find(([, isChecked]) => isChecked)?.[0] || sortedPaths[0]?.[0] || ''
  const shouldScrollPaths = sortedPaths.length > 6

  return (
    <div
      data-flow-tooltip="true"
      className={`${x} ${y} fixed z-50 bg-white border-1 border-[#808080] rounded-md pointer-events-auto w-fit max-w-[400px]`}
    >
      <div className="text-base font-semibold mb-2 border-b border-[#808080] pb-1 px-3 pt-1">
        {elementId}
      </div>

      <div className="space-y-2 px-3 pb-3">
        {paths && Object.keys(paths).length === 1 ? (
          <div className="flex items-center justify-start gap-2">
            <span className="text-sm font-medium text-black">{t("performanceFlowTooltip.averageTime")}</span>
            <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded shrink-0 whitespace-nowrap">{Number.isFinite(selected_sojourn) ? formatSecondsFull(selected_sojourn, false) : 'N/A'}</span>
          </div>
        ) : (
          <span className="text-sm font-base text-black wrap-break-words">
            {t("performanceFlowTooltip.description")}
          </span>
        )}
        <div>
          <span className="text-sm font-medium mb-1 text-black">{t("performanceFlowTooltip.flows")}</span>
          <div
            className={`space-y-1 ml-1 ${shouldScrollPaths ? 'max-h-[224px] overflow-y-auto pr-1' : ''}`}
            style={shouldScrollPaths ? { scrollbarWidth: 'thin', scrollbarColor: '#808080 #D8D8D8' } : undefined}
          >
            {sortedPaths.length > 0 ? (
              <RadioGroup value={selectedPathKey} onValueChange={(value) => onPathSelected?.(value)}>
                {sortedPaths.map(([key, value], index) => {
                  const radioId = `flow-path-${index}-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`

                  return (
                    <div key={key} className="flex items-center gap-2 justify-between">
                      <label htmlFor={radioId} className="flex items-center gap-2 min-w-0 mt-1 hover:cursor-pointer">
                        <RadioGroupItem
                          id={radioId}
                          value={key}
                          className="hover:cursor-pointer border-red-600 data-[state=checked]:border-red-600 data-[state=checked]:bg-red-600 data-[state=checked]:text-white data-[state=unchecked]:border-red-600 data-[state=unchecked]:bg-white data-[state=unchecked]:text-red-700"
                        />
                        <span className="text-sm text-black break-words max-w-[95%]">{key}</span>
                      </label>
                      <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-0.5 rounded shrink-0 whitespace-nowrap">{formatSecondsFull(getPathSojourn(value), false)}</span>
                    </div>
                  )
                })}
              </RadioGroup>
            ) : (
              <span className="text-sm px-2 py-0.5">{t("performanceFlowTooltip.noPaths")}</span>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
