import type { FrequencyActivityMetric, FrequencyFlowMetric } from '@/types/analysis-backend'

export type ModelFrequencyLabelData = Record<string, {
  frequency: number
  paths: Record<string, number>
}>

export const buildModelFrequencyLabelData = ({
  activityPaths,
  modelFlows,
  modelActivities
}: {
  activityPaths: Record<string, Record<string, string[]>>
  modelFlows: FrequencyFlowMetric[]
  modelActivities: FrequencyActivityMetric
}): ModelFrequencyLabelData => {
  const elementFrequencies: ModelFrequencyLabelData = {}

  modelFlows.forEach(flow => {
    console.log("[MODEL VIEW] Processing flow:", flow)

    const fromActivityName = flow.from === '<<start>>' ?
      "Start Event" :
      modelActivities[flow.from].originalActivity

    const toActivityName = flow.to === '<<end>>' ?
      "End Event" :
      modelActivities[flow.to].originalActivity

    const flowFrequency = flow.frequency
    const pathKey = `${fromActivityName} → ${toActivityName}`

    if (activityPaths[flow.from]) {
      const path = activityPaths[flow.from][flow.to]

      if (path) {
        path.forEach(elementId => {
          if (elementId.startsWith('Gateway')) {
            return
          }

          if (elementFrequencies[elementId]) {
            elementFrequencies[elementId].frequency += flowFrequency

            if (elementFrequencies[elementId].paths[pathKey]) {
              elementFrequencies[elementId].paths[pathKey] += flowFrequency
            } else {
              elementFrequencies[elementId].paths[pathKey] = flowFrequency
            }
          } else {
            elementFrequencies[elementId] = {
              frequency: flowFrequency,
              paths: {
                [pathKey]: flowFrequency
              }
            }
          }
        })
      }
    }
  })

  return elementFrequencies
}
