import type {
  ActivityCoordinatesCollection,
  DeviationActivitySize,
  DeviationActivitySizeProfile,
  ElementCoordinates,
  LaneElements
} from '@/types/analysis-frontend'
import type {
  ActivitiesRoles,
  DeviationPredecessors,
  PerformanceActivityMetric,
  PerformanceFlowMetric,
  RolesLanes
} from '@/types/analysis-backend'
import { normalizeActivityName } from './functions'
import { bpmnAugmentationSelector, setBpmnAugmentationAttributes, stripFrequencySuffix } from './bpmn-utils'

const ACTIVITY_WIDTH = 100
const ACTIVITY_HEIGHT = 80
const HEIGHT_OVERFLOW_TOLERANCE = 20
const DEFAULT_DEVIATION_SIZE_PROFILE: DeviationActivitySizeProfile = {
  baseWidth: ACTIVITY_WIDTH,
  baseHeight: ACTIVITY_HEIGHT,
  endEventWidth: 36,
  endEventHeight: 36,
  minWidth: ACTIVITY_WIDTH,
  maxWidth: 220,
  paddingX: 16,
  paddingY: 14,
  lineHeight: 13,
  horizontalExpansionPadding: 70
}

type SelectedPerformanceFlowMetric = PerformanceFlowMetric & { selected_sojourn: number }

export type GenericDeviationActivityMetric = {
  originalActivity?: string
  label: string
}

export type GenericDeviationFlowMetric = {
  from: string
  to: string
  value: number
  label: string
}

export type GenericDeviationArrow = {
  from: string
  to: string
  value: number
  label: string
  isSecondary?: boolean
}

type CreateDeviationLaneResult = {
  xml: string
  activitiesCoordinates: ActivityCoordinatesCollection
  allElementsCoordinates: ElementCoordinates[]
  lanes: LaneElements
  newLaneId: string
}

type LayoutShiftResult = {
  xml: string
  activitiesCoordinates: ActivityCoordinatesCollection
  allElementsCoordinates: ElementCoordinates[]
  lanes: LaneElements
}

type SafePositionResult = {
  x: number
  y: number
  safe: boolean
  reason?: 'lane-not-found' | 'no-free-position'
}

type HorizontalExpansionDirection = 'right' | 'left'

type FindPredecessorCoordinatesResult = {
  activity: string
  coordinates: { x: number; y: number }
  lane: string
}

const replaceNumericAttribute = (
  text: string,
  attribute: string,
  updater: (value: number) => number
) => text.replace(new RegExp(`${attribute}="([^"]+)"`), (match, value) => {
  const numericValue = parseFloat(value)
  if (!Number.isFinite(numericValue)) return match
  return `${attribute}="${updater(numericValue)}"`
})

const getMedianNumber = (values: number[], fallback: number) => {
  const sortedValues = values
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)

  if (sortedValues.length === 0) return fallback

  const middleIndex = Math.floor(sortedValues.length / 2)
  if (sortedValues.length % 2 === 1) {
    return sortedValues[middleIndex]
  }

  return (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2
}

const getMeasuredTextWidth = (text: string) => {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (context) {
      context.font = '11px Arial'
      return context.measureText(text).width
    }
  }

  return text.length * 6.2
}

const wrapLabelLines = (label: string, maxLineWidth: number) => {
  const words = label
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

  if (words.length === 0) return ['']

  const lines: string[] = []
  let currentLine = ''

  words.forEach(word => {
    const candidateLine = currentLine ? `${currentLine} ${word}` : word
    if (!currentLine || getMeasuredTextWidth(candidateLine) <= maxLineWidth) {
      currentLine = candidateLine
      return
    }

    lines.push(currentLine)
    currentLine = word
  })

  if (currentLine) {
    lines.push(currentLine)
  }

  return lines
}

const getExplicitLabelLines = (label: string) => {
  const explicitLines = label
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  return explicitLines.length > 0 ? explicitLines : ['']
}

// Read the imported BPMN DI bounds once so generated deviation elements follow the model scale.
export const createDeviationActivitySizeProfile = (xmlString?: string | null): DeviationActivitySizeProfile => {
  if (!xmlString || typeof DOMParser === 'undefined') {
    return DEFAULT_DEVIATION_SIZE_PROFILE
  }

  try {
    const xmlDocument = new DOMParser().parseFromString(xmlString, 'application/xml')
    // Tasks and subprocesses define the visual baseline for generated deviation activities.
    const taskElementNames = new Set([
      'task',
      'userTask',
      'serviceTask',
      'sendTask',
      'receiveTask',
      'manualTask',
      'businessRuleTask',
      'scriptTask',
      'callActivity',
      'subProcess'
    ])
    const taskIds = new Set(
      Array.from(xmlDocument.getElementsByTagName('*'))
        .filter(element => taskElementNames.has(element.localName))
        .map(element => element.getAttribute('id'))
        .filter((id): id is string => Boolean(id))
    )
    const endEventIds = new Set(
      Array.from(xmlDocument.getElementsByTagName('*'))
        .filter(element => element.localName === 'endEvent')
        .map(element => element.getAttribute('id'))
        .filter((id): id is string => Boolean(id))
    )

    const getBoundsForElements = (elementIds: Set<string>) => Array.from(xmlDocument.getElementsByTagName('*'))
      .filter(element => element.localName === 'BPMNShape' && elementIds.has(element.getAttribute('bpmnElement') ?? ''))
      .map(shape => {
        const bounds = Array.from(shape.children).find(child => child.localName === 'Bounds')
        if (!bounds) return null

        const width = parseFloat(bounds.getAttribute('width') ?? '')
        const height = parseFloat(bounds.getAttribute('height') ?? '')

        if (!Number.isFinite(width) || !Number.isFinite(height)) return null
        return { width, height }
      })
      .filter((bounds): bounds is DeviationActivitySize => Boolean(bounds))

    const activityBounds = getBoundsForElements(taskIds)
    const endEventBounds = getBoundsForElements(endEventIds)

    // Medians avoid letting one unusually large/small BPMN shape dominate generated element sizing.
    const medianWidth = Math.round(getMedianNumber(
      activityBounds.map(bounds => bounds.width),
      ACTIVITY_WIDTH
    ))
    const medianHeight = Math.round(getMedianNumber(
      activityBounds.map(bounds => bounds.height),
      ACTIVITY_HEIGHT
    ))
    const medianEndEventWidth = Math.round(getMedianNumber(
      endEventBounds.map(bounds => bounds.width),
      DEFAULT_DEVIATION_SIZE_PROFILE.endEventWidth
    ))
    const medianEndEventHeight = Math.round(getMedianNumber(
      endEventBounds.map(bounds => bounds.height),
      DEFAULT_DEVIATION_SIZE_PROFILE.endEventHeight
    ))

    return {
      ...DEFAULT_DEVIATION_SIZE_PROFILE,
      baseWidth: medianWidth,
      baseHeight: medianHeight,
      endEventWidth: medianEndEventWidth,
      endEventHeight: medianEndEventHeight,
      minWidth: medianWidth,
      maxWidth: Math.max(220, medianWidth)
    }
  } catch (error) {
    console.warn('[DEVIATION SIZING] Could not compute size profile from BPMN XML:', error)
    return DEFAULT_DEVIATION_SIZE_PROFILE
  }
}

export const getDeviationActivitySize = (
  label: string,
  profile: DeviationActivitySizeProfile = DEFAULT_DEVIATION_SIZE_PROFILE
): DeviationActivitySize => {
  const resolvedProfile = {
    ...DEFAULT_DEVIATION_SIZE_PROFILE,
    ...profile
  }
  const width = Math.ceil(resolvedProfile.baseWidth)
  const maxTextWidth = Math.max(1, width - resolvedProfile.paddingX * 2)
  const wrappedLines = getExplicitLabelLines(label).flatMap(line =>
    wrapLabelLines(line, maxTextWidth)
  )
  const requiredHeight = wrappedLines.length * resolvedProfile.lineHeight + resolvedProfile.paddingY * 2
  // Keep width fixed to the model median and grow height only for clear label overflow.
  const height = Math.ceil(
    requiredHeight > resolvedProfile.baseHeight + HEIGHT_OVERFLOW_TOLERANCE
      ? requiredHeight
      : resolvedProfile.baseHeight
  )

  return { width, height }
}

export const getDeviationEndEventSize = (
  profile: DeviationActivitySizeProfile = DEFAULT_DEVIATION_SIZE_PROFILE
): DeviationActivitySize => {
  const resolvedProfile = {
    ...DEFAULT_DEVIATION_SIZE_PROFILE,
    ...profile
  }

  return {
    width: Math.ceil(resolvedProfile.endEventWidth),
    height: Math.ceil(resolvedProfile.endEventHeight)
  }
}

const shiftLaneBoundsBelowY = (
  lanesCoords: LaneElements,
  shiftY: number,
  shiftAmount: number
): LaneElements => {
  const updatedLanes = { ...lanesCoords }

  // Keep the in-memory lane map aligned with the BPMN DI changes below.
  Object.keys(updatedLanes).forEach(laneId => {
    const lane = updatedLanes[laneId]
    if (lane.fromY >= shiftY) {
      updatedLanes[laneId] = {
        ...lane,
        fromY: lane.fromY + shiftAmount,
        toY: lane.toY + shiftAmount
      }
    }
  })

  return updatedLanes
}

// Collect diagram geometry used by lane resolution, placement and collision checks.
export const getBpmnCoordinates = async ({
  viewer
}: {
  viewer: any
}): Promise<{
  coordinates: ActivityCoordinatesCollection
  allElements: ElementCoordinates[]
  lanes: LaneElements
  activitiesLanes: Record<string, string>
} | undefined> => {
  if (!viewer) {
    console.warn('Viewer not initialized')
    return
  }

  await new Promise(resolve => setTimeout(resolve, 100))

  try {
    const elementRegistry = viewer.get('elementRegistry') as any
    const elements = elementRegistry.getAll()
    const laneElements = elements.filter((el: any) => {
      const bo = el.businessObject
      return bo && bo.$type === 'bpmn:Lane'
    })

    const laneToElements: Record<string, string[]> = {}
    let lanesWithCoordinates: LaneElements = {}

    if (laneElements.length !== 0) {
      const sortedLanes = laneElements.sort((a: any, b: any) => a.y - b.y)

      sortedLanes.forEach((lane: any) => {
        const refs = lane.businessObject.flowNodeRef || []
        const elements = refs.map((activityRef: any) => activityRef.id || activityRef)

        laneToElements[lane.id] = elements
        lanesWithCoordinates[lane.id] = {
          fromX: lane.x,
          toX: lane.x + lane.width,
          fromY: lane.y,
          toY: lane.y + lane.height
        }
      })
    }

    const activityElements = elements.filter((el: any) => {
      const bo = el.businessObject
      if (!bo) return false

      const isActivity = bo.$type && (
        bo.$type.includes('Task') ||
        bo.$type === 'bpmn:Activity' ||
        bo.$type === 'bpmn:SubProcess'
      )

      return isActivity && bo.name
    })

    const allCoordinates: ActivityCoordinatesCollection = {}
    const allElementsCoords: ElementCoordinates[] = []

    activityElements.forEach((activity: any) => {
      if (!activity.businessObject?.name) return

      const element = elementRegistry.get(activity.id)
      if (!element) return

      const normalizedName = normalizeActivityName(
        stripFrequencySuffix(activity.businessObject.name)
      )
      const activityLaneId = Object.keys(laneToElements).find(laneId =>
        laneToElements[laneId].includes(activity.id)
      )

      allCoordinates[normalizedName] = {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        centerX: element.x + element.width / 2,
        centerY: element.y + element.height / 2,
        lane: activityLaneId || ''
      }
    })

    const activitiesLanes: Record<string, string> = {}
    Object.keys(laneToElements).forEach(laneId => {
      laneToElements[laneId].forEach(activityId => {
        const normalizedName = Object.keys(allCoordinates).find(name => {
          const activityElement = activityElements.find((el: any) => {
            const normalized = normalizeActivityName(
              stripFrequencySuffix(el.businessObject?.name || '')
            )
            return normalized === name && el.id === activityId
          })

          return !!activityElement
        })

        if (normalizedName) {
          activitiesLanes[normalizedName] = laneId
        }
      })
    })

    elements.forEach((element: any) => {
      const bo = element.businessObject
      if (!bo) return

      const isActivity = bo.$type && (
        bo.$type.includes('Task') ||
        bo.$type === 'bpmn:Activity' ||
        bo.$type === 'bpmn:SubProcess'
      )
      const isSequenceFlow = bo.$type === 'bpmn:SequenceFlow'

      if (
        isActivity &&
        element.x !== undefined &&
        element.y !== undefined &&
        element.width !== undefined &&
        element.height !== undefined
      ) {
        allElementsCoords.push({
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height
        })
      } else if (isSequenceFlow && element.waypoints && element.waypoints.length >= 2) {
        const waypoints = element.waypoints
        const lineThickness = 4

        // Treat sequence-flow segments as thin occupied boxes so deviations avoid model flows.
        for (let i = 0; i < waypoints.length - 1; i++) {
          const p1 = waypoints[i]
          const p2 = waypoints[i + 1]
          const minX = Math.min(p1.x, p2.x)
          const maxX = Math.max(p1.x, p2.x)
          const minY = Math.min(p1.y, p2.y)
          const maxY = Math.max(p1.y, p2.y)

          allElementsCoords.push({
            x: minX - lineThickness,
            y: minY - lineThickness,
            width: (maxX - minX) + (lineThickness * 2),
            height: (maxY - minY) + (lineThickness * 2)
          })
        }
      }
    })

    const startEvent = elements.find((el: any) => {
      const bo = el.businessObject
      return bo && bo.$type === 'bpmn:StartEvent'
    })

    if (startEvent && startEvent.x !== undefined && startEvent.y !== undefined) {
      const width = startEvent.width || 36
      const height = startEvent.height || 36

      allCoordinates['<<start>>'] = {
        x: startEvent.x,
        y: startEvent.y,
        width,
        height,
        centerX: startEvent.x + width / 2,
        centerY: startEvent.y + height / 2,
        lane: ''
      }

      const startId = startEvent.id
      let startLaneId: string | undefined = Object.keys(laneToElements).find(laneId =>
        laneToElements[laneId].includes(startId)
      )

      if (!startLaneId) {
        const sc = allCoordinates['<<start>>']
        const found = Object.entries(lanesWithCoordinates).find(([, lane]) => (
          sc.centerX >= lane.fromX &&
          sc.centerX <= lane.toX &&
          sc.centerY >= lane.fromY &&
          sc.centerY <= lane.toY
        ))

        if (found) startLaneId = found[0]
      }

      if (startLaneId) {
        activitiesLanes['<<start>>'] = startLaneId
      }
    }

    return {
      coordinates: allCoordinates,
      allElements: allElementsCoords,
      lanes: lanesWithCoordinates,
      activitiesLanes
    }
  } catch (error) {
    console.error('Error fetching BPMN coordinates:', error)
  }
}

export const isColliding = (
  x: number,
  y: number,
  width: number,
  height: number,
  elements: ElementCoordinates[],
  padding: number = 10,
  modelBounds?: { minX: number; maxX: number; minY: number; maxY: number }
) => {
  if (modelBounds) {
    const outsideBounds = (
      x < modelBounds.minX ||
      x + width > modelBounds.maxX ||
      y < modelBounds.minY ||
      y + height > modelBounds.maxY
    )

    if (outsideBounds) {
      console.log(`Element would be outside model bounds: x=${x}, y=${y}, width=${width}, height=${height}, bounds=[${modelBounds.minX}, ${modelBounds.maxX}, ${modelBounds.minY}, ${modelBounds.maxY}]`)
      return true
    }
  }

  return elements.some(el => {
    const hasCollision = !(
      x + width + padding < el.x - padding ||
      x - padding > el.x + el.width + padding ||
      y + height + padding < el.y - padding ||
      y - padding > el.y + el.height + padding
    )

    if (hasCollision) {
      console.log(`Collision detected with element at (${el.x}, ${el.y}) size ${el.width}x${el.height}`)
    }

    return hasCollision
  })
}

// Search from the contextual anchor and return an explicit failure reason when no safe point exists.
export const findSafePosition = (
  refX: number,
  refY: number,
  width: number,
  height: number,
  elements: ElementCoordinates[],
  lanes: LaneElements,
  lane: string,
  isToActivityOnRight: boolean | null,
  horizontalOffset: number = 170,
  isEndEvent: boolean = false,
  useLaneCenterY: boolean = true,
  laneCenterBounds?: LaneElements
): SafePositionResult => {
  let attempt = 0
  const effectiveHorizontalOffset = isEndEvent ? 80 : horizontalOffset
  const collisionPadding = isEndEvent ? 10 : 20
  const verticalStepSize = 20
  const horizontalStepSize = 20

  const targetLaneData = lanes[lane]
  if (!targetLaneData) {
    console.warn(`Lane "${lane}" not found in lanes object`)
    return { x: refX, y: refY, safe: false, reason: 'lane-not-found' }
  }

  // Search only within the chosen direction so the layout still follows process flow orientation.
  const maxHorizontalTravel = Math.max(
    0,
    isToActivityOnRight === false
      ? refX - targetLaneData.fromX
      : targetLaneData.toX - refX - width
  )
  const horizontalOffsets = isEndEvent
    ? Array.from({ length: 7 }, (_, index) => index * effectiveHorizontalOffset)
    : Array.from(
      { length: Math.floor(maxHorizontalTravel / horizontalStepSize) + 1 },
      (_, index) => index * horizontalStepSize
    )
  const attemptsPerHorizontalPosition = horizontalOffsets.length

  const minY = targetLaneData.fromY
  const maxY = targetLaneData.toY - height
  const laneValues = Object.values(lanes)
  const modelBounds = laneValues.length > 0 ? {
    minX: Math.min(...laneValues.map(l => l.fromX)),
    maxX: Math.max(...laneValues.map(l => l.toX)),
    minY: Math.min(...laneValues.map(l => l.fromY)),
    maxY: Math.max(...laneValues.map(l => l.toY))
  } : undefined

  if (!isEndEvent && useLaneCenterY) {
    // Deviation activities prefer the lane centre; end events keep the source-aligned Y.
    const centerLaneData = laneCenterBounds?.[lane] ?? targetLaneData
    const laneCenterY = (centerLaneData.fromY + centerLaneData.toY) / 2
    const preferredY = laneCenterY - (height / 2)
    refY = Math.max(minY, Math.min(maxY, preferredY))
  } else {
    refY = Math.max(minY, Math.min(maxY, refY))
  }

  // Try the preferred Y first, then alternate below and above it within the lane.
  const yPositionsToTry: number[] = [refY]
  for (let step = 1; step * verticalStepSize < (maxY - minY); step++) {
    const yUp = refY + (step * verticalStepSize)
    const yDown = refY - (step * verticalStepSize)

    if (yUp <= maxY) yPositionsToTry.push(yUp)
    if (yDown >= minY) yPositionsToTry.push(yDown)
  }

  while (attempt < yPositionsToTry.length * attemptsPerHorizontalPosition) {
    const yIndex = Math.floor(attempt / attemptsPerHorizontalPosition)
    const horizontalAttempt = attempt % attemptsPerHorizontalPosition
    const finalY = yPositionsToTry[yIndex] || refY
    const horizontalOffsetToTry = horizontalOffsets[horizontalAttempt] ?? 0
    const finalX = (isToActivityOnRight === false)
      ? refX - horizontalOffsetToTry
      : refX + horizontalOffsetToTry

    // Collision checks include activity bounds and sequence-flow segment boxes collected earlier.
    if (
      finalY >= minY &&
      finalY + height <= targetLaneData.toY &&
      !isColliding(finalX, finalY, width, height, elements, collisionPadding, modelBounds)
    ) {
      return { x: finalX, y: finalY, safe: true }
    }

    attempt++
  }

  console.warn('No safe position found within lane bounds, returning clamped reference position')
  return { x: refX, y: refY, safe: false, reason: 'no-free-position' }
}

// Shared vertical shift used when inserting generated deviation lanes.
const shiftBpmnLayoutBelowY = (
  originalXML: string,
  shiftY: number,
  shiftAmount: number,
  activitiesCoords: ActivityCoordinatesCollection,
  allElementsCoords: ElementCoordinates[],
  lanesCoords: LaneElements
): LayoutShiftResult => {
  const updatedLanes = { ...lanesCoords }

  Object.keys(updatedLanes).forEach(laneId => {
    const lane = updatedLanes[laneId]
    if (lane.fromY >= shiftY) {
      updatedLanes[laneId] = {
        fromX: lane.fromX,
        toX: lane.toX,
        fromY: lane.fromY + shiftAmount,
        toY: lane.toY + shiftAmount
      }
    }
  })

  const updatedActivitiesCoords = { ...activitiesCoords }
  Object.keys(updatedActivitiesCoords).forEach(activityName => {
    const coords = updatedActivitiesCoords[activityName]
    if (coords.y >= shiftY) {
      updatedActivitiesCoords[activityName] = {
        ...coords,
        y: coords.y + shiftAmount,
        centerY: coords.centerY + shiftAmount
      }
    }
  })

  const updatedAllElementsCoords = allElementsCoords.map(element => {
    if (element.y >= shiftY) {
      return {
        ...element,
        y: element.y + shiftAmount
      }
    }

    return element
  })

  let modifiedXML = originalXML

  // Shift BPMN shapes below the insertion point, including activities, gateways and events.
  const shapeRegex = /<bpmndi:BPMNShape[^>]*id="([^"]+)"[^>]*>[\s\S]*?<dc:Bounds[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*width="([^"]+)"[^>]*height="([^"]+)"[^>]*\/>/g
  modifiedXML = modifiedXML.replace(shapeRegex, (match, _id, _x, y) => {
    const numY = parseFloat(y)
    if (numY >= shiftY) {
      return match.replace(`y="${y}"`, `y="${numY + shiftAmount}"`)
    }
    return match
  })

  // Sequence-flow waypoints and labels move with the shifted lower diagram region.
  const waypointRegex = /<di:waypoint[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*\/>/g
  modifiedXML = modifiedXML.replace(waypointRegex, (match, _x, y) => {
    const numY = parseFloat(y)
    if (numY >= shiftY) {
      return match.replace(`y="${y}"`, `y="${numY + shiftAmount}"`)
    }
    return match
  })

  const labelBoundsRegex = /<bpmndi:BPMNLabel>[\s\S]*?<dc:Bounds[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*width="([^"]+)"[^>]*height="([^"]+)"[^>]*\/>[\s\S]*?<\/bpmndi:BPMNLabel>/g
  modifiedXML = modifiedXML.replace(labelBoundsRegex, (match, _x, y) => {
    const numY = parseFloat(y)
    if (numY >= shiftY) {
      return match.replace(`y="${y}"`, `y="${numY + shiftAmount}"`)
    }
    return match
  })

  const participantShapeRegex = /<bpmndi:BPMNShape[^>]*bpmnElement="([^"]+)"[^>]*>[\s\S]*?<dc:Bounds[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*width="([^"]+)"[^>]*height="([^"]+)"[^>]*\/>/g
  modifiedXML = modifiedXML.replace(participantShapeRegex, (match, elementId, _x, _y, _width, height) => {
    const isParticipant = modifiedXML.includes(`<bpmn:participant id="${elementId}"`) ||
      modifiedXML.includes('<bpmn:participant name=') && match.includes(elementId)

    if (isParticipant) {
      return match.replace(`height="${height}"`, `height="${parseFloat(height) + shiftAmount}"`)
    }

    return match
  })

  return {
    xml: modifiedXML,
    activitiesCoordinates: updatedActivitiesCoords,
    allElementsCoordinates: updatedAllElementsCoords,
    lanes: updatedLanes
  }
}

// Insert a generated deviation lane below an anchor lane and move lower diagram content down.
export const createDeviationLane = (
  originalXML: string,
  lastActivityLane: string,
  laneName: string,
  activitiesCoords: ActivityCoordinatesCollection,
  allElementsCoords: ElementCoordinates[],
  lanesCoords: LaneElements,
  laneHeight: number = 120
): CreateDeviationLaneResult => {
  const newLaneHeight = Math.max(120, laneHeight)
  const lastLane = lanesCoords[lastActivityLane]
  if (!lastLane) {
    console.warn(`[CREATE DEVIATION LANE] Last activity lane "${lastActivityLane}" not found`)
    return { xml: originalXML, activitiesCoordinates: activitiesCoords, allElementsCoordinates: allElementsCoords, lanes: lanesCoords, newLaneId: '' }
  }

  const newLaneY = lastLane.toY
  const newLaneFromX = lastLane.fromX
  const newLaneToX = lastLane.toX
  const newLaneWidth = newLaneToX - newLaneFromX
  // Open vertical space first, then insert the lane into that gap.
  const shiftedLayout = shiftBpmnLayoutBelowY(
    originalXML,
    newLaneY,
    newLaneHeight,
    activitiesCoords,
    allElementsCoords,
    lanesCoords
  )

  const newLaneId = `Lane_Deviation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const updatedLanes = {
    ...shiftedLayout.lanes,
    [newLaneId]: {
      fromX: newLaneFromX,
      toX: newLaneToX,
      fromY: newLaneY,
      toY: newLaneY + newLaneHeight
    }
  }

  try {
    const newLaneXML = `
        <bpmn:lane id="${newLaneId}" name="${laneName}">
          <bpmn:flowNodeRef></bpmn:flowNodeRef>
        </bpmn:lane>
      `

    const newLaneShapeXML = `
        <bpmndi:BPMNShape id="${newLaneId}_di" bpmnElement="${newLaneId}">
          <dc:Bounds x="${newLaneFromX}" y="${newLaneY}" width="${newLaneWidth}" height="${newLaneHeight}" />
          <bpmndi:BPMNLabel />
        </bpmndi:BPMNShape>
      `

    const laneSetMatch = shiftedLayout.xml.match(/(<bpmn:laneSet[^>]*>[\s\S]*?)(<\/bpmn:laneSet>)/i)
    let modifiedXML = shiftedLayout.xml

    if (laneSetMatch) {
      modifiedXML = shiftedLayout.xml.replace(laneSetMatch[2], newLaneXML + laneSetMatch[2])
    } else {
      console.warn('[CREATE DEVIATION LANE] Could not find laneSet in XML')
    }

    const planeMatch = modifiedXML.match(/(<bpmndi:BPMNPlane[^>]*>)/i)
    if (planeMatch) {
      modifiedXML = modifiedXML.replace(planeMatch[0], planeMatch[0] + newLaneShapeXML)
    }

    return {
      xml: modifiedXML,
      activitiesCoordinates: shiftedLayout.activitiesCoordinates,
      allElementsCoordinates: shiftedLayout.allElementsCoordinates,
      lanes: updatedLanes,
      newLaneId
    }
  } catch (error) {
    console.error('[CREATE DEVIATION LANE] Error modifying BPMN XML:', error)
    return { xml: originalXML, activitiesCoordinates: activitiesCoords, allElementsCoordinates: allElementsCoords, lanes: lanesCoords, newLaneId: '' }
  }
}

// Widen the whole pool when an existing lane has no collision-free position in the chosen direction.
export const expandBpmnHorizontally = (
  originalXML: string,
  direction: HorizontalExpansionDirection,
  activitiesCoords: ActivityCoordinatesCollection,
  allElementsCoords: ElementCoordinates[],
  lanesCoords: LaneElements,
  widthIncrement: number = ACTIVITY_WIDTH + DEFAULT_DEVIATION_SIZE_PROFILE.horizontalExpansionPadding
): LayoutShiftResult => {
  const shouldShiftExistingElements = direction === 'left'
  const laneIds = new Set(Object.keys(lanesCoords))
  const participantIds = new Set(
    Array.from(originalXML.matchAll(/<bpmn:participant[^>]*id="([^"]+)"/g))
      .map(match => match[1])
  )

  // All lane outlines are widened together so the pool remains visually rectangular.
  const updatedLanes = Object.fromEntries(
    Object.entries(lanesCoords).map(([laneId, lane]) => [
      laneId,
      {
        ...lane,
        toX: lane.toX + widthIncrement
      }
    ])
  )

  // Left expansion creates space before the diagram, so existing content must move right.
  const updatedActivitiesCoords = shouldShiftExistingElements
    ? Object.fromEntries(
      Object.entries(activitiesCoords).map(([activityName, coords]) => [
        activityName,
        {
          ...coords,
          x: coords.x + widthIncrement,
          centerX: coords.centerX + widthIncrement
        }
      ])
    )
    : activitiesCoords

  const updatedAllElementsCoords = shouldShiftExistingElements
    ? allElementsCoords.map(element => ({
      ...element,
      x: element.x + widthIncrement
    }))
    : allElementsCoords

  let modifiedXML = originalXML
  const shapeRegex = /<bpmndi:BPMNShape[^>]*bpmnElement="([^"]+)"[^>]*>[\s\S]*?<dc:Bounds[^>]*\/>[\s\S]*?<\/bpmndi:BPMNShape>/g

  modifiedXML = modifiedXML.replace(shapeRegex, (match, bpmnElementId) => {
    const isLaneOrParticipant = laneIds.has(bpmnElementId) || participantIds.has(bpmnElementId)
    if (isLaneOrParticipant) {
      return replaceNumericAttribute(match, 'width', value => value + widthIncrement)
    }

    if (shouldShiftExistingElements) {
      return replaceNumericAttribute(match, 'x', value => value + widthIncrement)
    }

    return match
  })

  if (shouldShiftExistingElements) {
    const waypointRegex = /<di:waypoint[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*\/>/g
    modifiedXML = modifiedXML.replace(waypointRegex, match =>
      replaceNumericAttribute(match, 'x', value => value + widthIncrement)
    )

    const labelBoundsRegex = /<bpmndi:BPMNLabel>[\s\S]*?<dc:Bounds[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*width="([^"]+)"[^>]*height="([^"]+)"[^>]*\/>[\s\S]*?<\/bpmndi:BPMNLabel>/g
    modifiedXML = modifiedXML.replace(labelBoundsRegex, match =>
      replaceNumericAttribute(match, 'x', value => value + widthIncrement)
    )
  }

  return {
    xml: modifiedXML,
    activitiesCoordinates: updatedActivitiesCoords,
    allElementsCoordinates: updatedAllElementsCoords,
    lanes: updatedLanes
  }
}

export const createActivityXML = (
  originalXML: string,
  activityName: string,
  x: number = 400,
  y: number = -10,
  size: DeviationActivitySize = { width: ACTIVITY_WIDTH, height: ACTIVITY_HEIGHT }
) => {
  try {
    const width = Math.ceil(size.width)
    const height = Math.ceil(size.height)
    const id = `Activity${Date.now()}${Math.random().toString(36).substr(2, 9)}`
    const testActivityXML = `
        <bpmn:task id="${id}" name="${activityName}" />
      `
    const testShapeXML = `
        <bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}">
          <dc:Bounds x="${x}" y="${y}" width="${width}" height="${height}" />
          <bpmndi:BPMNLabel>
            <dc:Bounds x="${x}" y="${y}" width="${width}" height="${height}" />
          </bpmndi:BPMNLabel>
        </bpmndi:BPMNShape>
      `

    const processMatch = originalXML.match(/(<bpmn:process[^>]*>)/i)
    if (!processMatch) {
      console.warn('Could not find insertion points in BPMN XML, returning original')
      return originalXML
    }

    const modifiedXML = originalXML.replace(processMatch[0], processMatch[0] + testActivityXML)
    const planeMatch = modifiedXML.match(/(<bpmndi:BPMNPlane[^>]*>)/i)
    if (!planeMatch) return originalXML

    return modifiedXML.replace(planeMatch[0], planeMatch[0] + testShapeXML)
  } catch (error) {
    console.error('Error modifying BPMN XML:', error)
    return originalXML
  }
}

export const createEndEventXML = (
  originalXML: string,
  x: number,
  y: number,
  size: DeviationActivitySize = {
    width: DEFAULT_DEVIATION_SIZE_PROFILE.endEventWidth,
    height: DEFAULT_DEVIATION_SIZE_PROFILE.endEventHeight
  }
): { xml: string; id: string } => {
  try {
    const id = `EndEvent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const endEventXML = `
        <bpmn:endEvent id="${id}" name="" />
      `
    const endEventShapeXML = `
        <bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}">
          <dc:Bounds x="${x}" y="${y}" width="${size.width}" height="${size.height}" />
          <bpmndi:BPMNLabel />
        </bpmndi:BPMNShape>
      `

    const processMatch = originalXML.match(/(<bpmn:process[^>]*>)/i)
    if (!processMatch) {
      console.warn('Could not find insertion points in BPMN XML for end event, returning original')
      return { xml: originalXML, id: '' }
    }

    const modifiedXML = originalXML.replace(processMatch[0], processMatch[0] + endEventXML)
    const planeMatch = modifiedXML.match(/(<bpmndi:BPMNPlane[^>]*>)/i)
    if (!planeMatch) return { xml: originalXML, id: '' }

    return { xml: modifiedXML.replace(planeMatch[0], planeMatch[0] + endEventShapeXML), id }
  } catch (error) {
    console.error('Error modifying BPMN XML for end event:', error)
    return { xml: originalXML, id: '' }
  }
}

// Resolve the contextual anchor from observed predecessor evidence, falling back to the start event.
export const findPredecessorCoordinates = (
  activityName: string,
  coordinates: ActivityCoordinatesCollection,
  deviationPredecessors: DeviationPredecessors
): FindPredecessorCoordinatesResult | null => {
  const activityPredecessors = deviationPredecessors[activityName] || []

  if (activityPredecessors.length === 0) {
    // Deviations without an observed predecessor are anchored at the process start.
    return {
      activity: '<<start>>',
      coordinates: coordinates['<<start>>'],
      lane: coordinates['<<start>>'].lane
    }
  }

  if (activityPredecessors.length === 1) {
    const predecessor = activityPredecessors[0].predecessor
    if (coordinates[predecessor]) {
      return {
        activity: predecessor,
        coordinates: coordinates[predecessor],
        lane: coordinates[predecessor].lane
      }
    }
    return null
  }

  // For multiple predecessors, wait until enough anchors are already available to avoid unstable placement.
  const requiredPlacedCount = Math.max(1, Math.floor(activityPredecessors.length * 0.7))
  const placedPredecessors = activityPredecessors.filter(pred => coordinates[pred.predecessor] !== undefined)
  if (placedPredecessors.length < requiredPlacedCount) return null

  const placedCoords = placedPredecessors.map(pred => coordinates[pred.predecessor])
  const xCoords = placedCoords.map(coord => coord.x)
  const yCoords = placedCoords.map(coord => coord.y)
  const referenceActivity = [...placedPredecessors]
    .sort((a, b) => b.frequency - a.frequency)[0].predecessor

  return {
    activity: referenceActivity,
    coordinates: {
      x: (Math.min(...xCoords) + Math.max(...xCoords)) / 2,
      y: yCoords.reduce((sum, y) => sum + y, 0) / yCoords.length
    },
    lane: coordinates[referenceActivity].lane
  }
}

// Resolve the target lane from role/lane evidence before falling back to generated deviation lanes.
export const findLaneForActivity = ({
  deviationActivity,
  lastActivity,
  activitiesLanesMap,
  lanesMap,
  activitiesRoles,
  rolesLanes,
  getLaneName
}: {
  deviationActivity: string
  lastActivity: string
  activitiesLanesMap: Record<string, string>
  lanesMap: LaneElements
  activitiesRoles: ActivitiesRoles
  rolesLanes: RolesLanes
  getLaneName?: (laneId: string) => string | undefined
}): { lane: string; inModel: boolean } => {
  const laneRolesDeviation = activitiesRoles.all[deviationActivity]
    ? [...activitiesRoles.all[deviationActivity]].sort((a, b) => b.frequency - a.frequency)
    : undefined
  const laneFromLastActivity = activitiesLanesMap[lastActivity]

  if (!laneRolesDeviation?.length) {
    // Unknown roles cannot be assigned to a model lane, so they become generated deviation lanes.
    return { lane: 'deviation_lane', inModel: false }
  }

  if (laneRolesDeviation.length === 1) {
    const onlyRole = rolesLanes[laneRolesDeviation[0].role]
    return onlyRole
      ? { lane: onlyRole[0].lane_id, inModel: true }
      : { lane: laneRolesDeviation[0].role, inModel: false }
  }

  const highestFreq = laneRolesDeviation[0].frequency
  const threshold = highestFreq * 0.1
  const isCloseFrequency = highestFreq - laneRolesDeviation[1].frequency <= threshold

  const getLaneCenterY = (laneId: string) => {
    const lane = lanesMap[laneId]
    if (!lane) return 0

    const top = Math.min(lane.fromY, lane.toY)
    const bottom = Math.max(lane.fromY, lane.toY)
    const centerY = (top + bottom) / 2

    return Number.isFinite(centerY) ? centerY : 0
  }

  if (isCloseFrequency) {
    // Close role frequencies are resolved by preferring model evidence, then nearby lanes.
    let inModelSum = 0
    let notInModelSum = 0
    const inModelRoles: { role: string; frequency: number }[] = []

    laneRolesDeviation.forEach(roleFreq => {
      const role = roleFreq.role
      const frequency = roleFreq.frequency
      const isInModel = rolesLanes[role]

      if (isInModel) {
        inModelSum += frequency
        inModelRoles.push({ role, frequency })
      } else {
        notInModelSum += frequency
      }
    })

    if (inModelSum >= notInModelSum) {
      for (const roleFreq of inModelRoles) {
        const role = roleFreq.role
        const rolesLanesData = rolesLanes[role]
        const matchingLane = rolesLanesData?.find((laneInfo) => {
          const laneName = getLaneName?.(laneInfo.lane_id)?.toLowerCase()
          return laneName?.includes(role.toLowerCase())
        })

        if (matchingLane) {
          return { lane: matchingLane.lane_id, inModel: true }
        }
      }

      const lastActivityLaneY = getLaneCenterY(laneFromLastActivity)
      const laneCandidates: { laneId: string; laneFrequency: number; distance: number }[] = []
      let maxFrequency = 0
      let maxDistance = 0

      inModelRoles.forEach(roleFreq => {
        const roleFrequency = roleFreq.frequency
        const rolesLanesData = rolesLanes[roleFreq.role]

        rolesLanesData?.forEach(laneInfo => {
          const laneId = laneInfo.lane_id
          if (!lanesMap[laneId]) return

          const combinedFrequency = roleFrequency * laneInfo.frequency
          const distance = Math.abs(getLaneCenterY(laneId) - lastActivityLaneY)

          laneCandidates.push({ laneId, laneFrequency: combinedFrequency, distance })
          maxFrequency = Math.max(maxFrequency, combinedFrequency)
          maxDistance = Math.max(maxDistance, distance)
        })
      })

      if (laneCandidates.length > 0) {
        return {
          lane: laneCandidates
            .map((candidate) => {
              const normalizedFrequency = maxFrequency > 0 ? candidate.laneFrequency / maxFrequency : 0
              const normalizedProximity = maxDistance > 0 ? 1 - (candidate.distance / maxDistance) : 1
              // Proximity carries more weight so close-frequency deviations stay near their context.
              return {
                laneId: candidate.laneId,
                score: (normalizedFrequency * 0.4) + (normalizedProximity * 0.6)
              }
            })
            .reduce((best, current) => current.score > best.score ? current : best).laneId,
          inModel: true
        }
      }
    }
  } else {
    const highestFreqRole = laneRolesDeviation[0].role
    const roleInModel = rolesLanes[highestFreqRole]

    if (roleInModel) {
      if (roleInModel.length === 1) {
        return { lane: roleInModel[0].lane_id, inModel: true }
      }

      const highestLaneFreq = roleInModel[0].frequency
      const secondHighestLaneFreq = roleInModel[1].frequency
      const freqThreshold = highestLaneFreq * 0.1

      if (highestLaneFreq - secondHighestLaneFreq > freqThreshold) {
        return { lane: roleInModel[0].lane_id, inModel: true }
      }

      // If one role maps to several lanes, proximity to the predecessor breaks the tie.
      const lastActivityLaneY = getLaneCenterY(laneFromLastActivity)
      let closestLane = roleInModel[0].lane_id
      let minDistance = Infinity

      roleInModel.forEach(laneInfo => {
        const laneId = laneInfo.lane_id
        if (!lanesMap[laneId]) return

        const distance = Math.abs(getLaneCenterY(laneId) - lastActivityLaneY)
        if (distance < minDistance) {
          minDistance = distance
          closestLane = laneId
        }
      })

      return { lane: closestLane, inModel: true }
    }
  }

  return { lane: isCloseFrequency ? 'deviation_lane' : laneRolesDeviation[0].role, inModel: false }
}

// Place deviations with stable model predecessors first so later deviations can anchor to inserted nodes.
export const orderDeviationActivitiesByModelPredecessors = ({
  deviationActivities,
  deviationPredecessors,
  modelActivities
}: {
  deviationActivities: PerformanceActivityMetric
  deviationPredecessors: DeviationPredecessors
  modelActivities: PerformanceActivityMetric
}): string[] => {
  return Object.entries(deviationActivities)
    .map(([activityName, deviation], index) => {
      const predecessors = deviationPredecessors[activityName] || []
      const modelPredecessors = predecessors.filter(pred => !!modelActivities[pred.predecessor])
      const maxAllPredecessorFrequency = predecessors.length > 0
        ? Math.max(...predecessors.map(pred => pred.frequency))
        : 0
      const maxModelPredecessorFrequency = modelPredecessors.length > 0
        ? Math.max(...modelPredecessors.map(pred => pred.frequency))
        : 0
      const hasModelPredecessor = modelPredecessors.length > 0

      return {
        activityName,
        deviation,
        hasNoPredecessor: predecessors.length === 0,
        hasModelPredecessor,
        modelPredecessorIsMax: hasModelPredecessor && maxModelPredecessorFrequency === maxAllPredecessorFrequency,
        frequencyDifference: hasModelPredecessor
          ? maxAllPredecessorFrequency - maxModelPredecessorFrequency
          : Number.POSITIVE_INFINITY,
        maxModelPredecessorFrequency,
        index
      }
    })
    .sort((a, b) => {
      if (a.hasNoPredecessor !== b.hasNoPredecessor) {
        return a.hasNoPredecessor ? -1 : 1
      }

      if (a.hasModelPredecessor !== b.hasModelPredecessor) {
        return a.hasModelPredecessor ? -1 : 1
      }

      if (!a.hasModelPredecessor && !b.hasModelPredecessor) {
        return a.index - b.index
      }

      if (a.modelPredecessorIsMax !== b.modelPredecessorIsMax) {
        // Prefer deviations whose strongest predecessor already exists in the imported model.
        return a.modelPredecessorIsMax ? -1 : 1
      }

      if (a.frequencyDifference !== b.frequencyDifference) {
        return a.frequencyDifference - b.frequencyDifference
      }

      if (a.maxModelPredecessorFrequency !== b.maxModelPredecessorFrequency) {
        return b.maxModelPredecessorFrequency - a.maxModelPredecessorFrequency
      }

      return a.activityName.localeCompare(b.activityName)
    })
    .map(({ activityName }) => activityName)
}

export const applyDeviationActivityColorStyles = ({
  gfx,
  backgroundColor,
  labelColor,
  strokeColor
}: {
  gfx: any
  backgroundColor: string
  labelColor: string
  strokeColor?: string
}) => {
  const bbox = gfx.getBBox()
  const backgroundRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')

  backgroundRect.setAttribute('x', String(bbox.x))
  backgroundRect.setAttribute('y', String(bbox.y))
  backgroundRect.setAttribute('width', String(bbox.width))
  backgroundRect.setAttribute('height', String(bbox.height))
  backgroundRect.setAttribute('rx', '10')
  backgroundRect.setAttribute('ry', '10')
  backgroundRect.setAttribute('fill', backgroundColor)
  backgroundRect.setAttribute('stroke', 'none')
  setBpmnAugmentationAttributes(backgroundRect, 'activity-background', { view: 'deviations' })
  backgroundRect.style.pointerEvents = 'none'

  const existingBg = gfx.querySelector(`rect${bpmnAugmentationSelector('activity-background')}`)
  if (existingBg) {
    existingBg.remove()
  }

  if (gfx.firstChild) {
    gfx.insertBefore(backgroundRect, gfx.firstChild)
  } else {
    gfx.appendChild(backgroundRect)
  }

  const shapes = gfx.querySelectorAll(`rect:not(${bpmnAugmentationSelector('activity-background')}), path, circle, ellipse, polygon`)
  shapes.forEach((shape: any) => {
    shape.style.fill = 'rgba(0, 0, 0, 0)'
    shape.setAttribute('fill', 'rgba(0, 0, 0, 0)')

    if (strokeColor) {
      shape.style.stroke = strokeColor
      shape.style.strokeWidth = '2px'
      shape.setAttribute('stroke', strokeColor)
      shape.setAttribute('stroke-width', '2')
      shape.style.setProperty('stroke', strokeColor, 'important')
      shape.style.setProperty('stroke-width', '2px', 'important')
    }

    if (shape.tagName === 'rect') {
      shape.setAttribute('rx', '10')
      shape.setAttribute('ry', '10')
    }

    shape.style.setProperty('fill', 'rgba(0, 0, 0, 0)', 'important')
  })

  const textElements = gfx.querySelectorAll('text')
  textElements.forEach((text: any) => {
    text.style.fill = labelColor
    text.style.fontWeight = '500'
    text.style.fontSize = '11px'
    text.style.fontFamily = 'Arial, sans-serif'
    text.setAttribute('fill', labelColor)
    text.style.pointerEvents = 'none'

    const tspans = text.querySelectorAll('tspan')
    if (tspans.length > 1) {
      tspans.forEach((tspan: any, index: number) => {
        const content = (tspan.textContent || '').trim()
        const isMetricLine = index === tspans.length - 1 && content.startsWith('(') && content.endsWith(')')

        tspan.style.fontWeight = isMetricLine ? '700' : '500'
        tspan.style.fontSize = isMetricLine ? '13px' : '11px'
      })
    }
  })

  gfx.style.display = 'none'
  gfx.offsetHeight
  gfx.style.display = ''
}

export const styleDeviationActivityElement = ({
  viewer,
  activityName,
  isSecondary,
  getActivityColor
}: {
  viewer: any
  activityName: string
  isSecondary: boolean
  getActivityColor: (activityName: string) => string
}) => {
  if (!viewer) return

  const normalizedTargetName = activityName || 'no-label'
  const elementRegistry = viewer.get('elementRegistry') as any
  const activityElements = elementRegistry.getAll().filter((el: any) => {
    const bo = el.businessObject
    const isActivity = bo?.$type && (
      bo.$type.includes('Task') ||
      bo.$type === 'bpmn:Activity' ||
      bo.$type === 'bpmn:SubProcess'
    )

    return isActivity && bo.name
  })
  const activity = activityElements.find((el: any) => {
    const normalizedName = normalizeActivityName(
      stripFrequencySuffix(el.businessObject?.name || '')
    )

    return normalizedName === normalizedTargetName
  })

  if (!activity) return

  const gfx = elementRegistry.getGraphics(activity)
  if (!gfx) return

  applyDeviationActivityColorStyles({
    gfx,
    backgroundColor: isSecondary ? 'rgba(136, 136, 136, 0.12)' : getActivityColor(normalizedTargetName),
    labelColor: isSecondary ? '#666666' : '#000000',
    strokeColor: isSecondary ? '#888888' : '#ff0000'
  })
}

export const styleDeviationLaneElements = ({
  viewer,
  deviationLanes
}: {
  viewer: any
  deviationLanes: Set<string>
}) => {
  if (!viewer) return

  const elementRegistry = viewer.get('elementRegistry') as any
  deviationLanes.forEach(laneId => {
    const lane = elementRegistry.get(laneId)
    if (!lane) return

    const gfx = elementRegistry.getGraphics(lane)
    if (!gfx) return

    const rects = gfx.querySelectorAll('rect')
    rects.forEach((rect: any) => {
      rect.style.fill = 'rgba(255, 0, 0, 0.1)'
      rect.setAttribute('fill', 'rgba(255, 0, 0, 0.1)')
    })
  })
}

export const styleDeviationEndEventElements = ({
  viewer,
  endEventIds
}: {
  viewer: any
  endEventIds: Map<string, boolean>
}) => {
  if (!viewer) return

  const elementRegistry = viewer.get('elementRegistry') as any
  endEventIds.forEach((isSecondary, eventId) => {
    const endEvent = elementRegistry.get(eventId)
    if (!endEvent) return

    const gfx = elementRegistry.getGraphics(endEvent)
    if (!gfx) return

    const strokeColor = isSecondary ? '#888888' : '#ff0000'
    const shapes = gfx.querySelectorAll('circle, ellipse, path')

    shapes.forEach((shape: any) => {
      shape.style.stroke = strokeColor
      shape.style.strokeWidth = '4px'
      shape.setAttribute('stroke', strokeColor)
      shape.setAttribute('stroke-width', '4')
    })
  })
}

type ConnectionPointUsage = {
  origins: number
  destinations: number
}

type ConnectionPointUsageMap = Map<string, ConnectionPointUsage>

const measureSvgTextWidth = (text: SVGTextElement, fallbackText: string) => {
  try {
    const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    tempSvg.style.position = 'absolute'
    tempSvg.style.visibility = 'hidden'
    document.body.appendChild(tempSvg)
    const tempText = text.cloneNode(true) as SVGTextElement
    tempSvg.appendChild(tempText)
    const textWidth = tempText.getBBox().width
    document.body.removeChild(tempSvg)
    return textWidth
  } catch {
    return fallbackText.length * 7
  }
}

const appendDeviationArrowGroup = (
  container: HTMLDivElement | null,
  group: SVGGElement
) => {
  const svg = container?.querySelector('svg')
  const viewport = svg?.querySelector('g.viewport') || svg?.querySelector('g')
  viewport?.appendChild(group)
}

// Draw deviation arrows as SVG overlays without changing the BPMN model structure.
export const createSmartDeviationArrowElement = ({
  container,
  activitiesCoordinates,
  connectionPointsUsage,
  onConnectionPointsUsageChange,
  from,
  to,
  label,
  isSecondary = false,
  primaryStroke = '#1D1D1D',
  secondaryStroke = '#1D1D1D'
}: {
  container: HTMLDivElement | null
  activitiesCoordinates: ActivityCoordinatesCollection
  connectionPointsUsage: ConnectionPointUsageMap
  onConnectionPointsUsageChange: (connectionPointsUsage: ConnectionPointUsageMap) => void
  from: string
  to: string
  label: string
  isSecondary?: boolean
  primaryStroke?: string
  secondaryStroke?: string
}) => {
  const sourceCoord = activitiesCoordinates[from]
  const targetCoord = activitiesCoordinates[to]
  if (!sourceCoord || !targetCoord) return

  const arrowStroke = isSecondary ? secondaryStroke : primaryStroke
  const labelColor = arrowStroke
  const labelBgFill = 'white'
  const labelBgStroke = arrowStroke
  const arrowheadSize = 12

  if (from === to) {
    const edgeSpacing = 15
    const loopHeight = 50
    const sourcePoint = {
      x: sourceCoord.x + sourceCoord.width - edgeSpacing,
      y: sourceCoord.y
    }
    const targetPoint = {
      x: sourceCoord.x + edgeSpacing,
      y: sourceCoord.y
    }
    const midX = sourceCoord.centerX
    const topY = sourceCoord.y - loopHeight

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const arrowId = `arrow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    setBpmnAugmentationAttributes(group, 'deviation-arrow', {
      view: 'deviations',
      from,
      to,
      id: arrowId
    })
    group.style.pointerEvents = 'none'

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', `M ${sourcePoint.x} ${sourcePoint.y} C ${sourcePoint.x} ${topY}, ${targetPoint.x} ${topY}, ${targetPoint.x} ${targetPoint.y}`)
    path.setAttribute('stroke', arrowStroke)
    path.setAttribute('stroke-width', '2')
    path.setAttribute('stroke-dasharray', '8,4')
    path.setAttribute('fill', 'none')
    path.setAttribute('opacity', '0.8')

    const arrowhead = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    arrowhead.setAttribute('points', [
      `${targetPoint.x},${targetPoint.y}`,
      `${targetPoint.x - arrowheadSize * 0.5},${targetPoint.y - arrowheadSize}`,
      `${targetPoint.x + arrowheadSize * 0.5},${targetPoint.y - arrowheadSize}`
    ].join(' '))
    arrowhead.setAttribute('fill', arrowStroke)
    arrowhead.setAttribute('stroke', arrowStroke)
    arrowhead.setAttribute('stroke-width', '1')
    arrowhead.setAttribute('stroke-linejoin', 'round')
    arrowhead.setAttribute('stroke-linecap', 'round')
    arrowhead.setAttribute('opacity', '0.8')

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('x', String(midX))
    text.setAttribute('y', String(topY - 10))
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('dominant-baseline', 'middle')
    text.setAttribute('fill', labelColor)
    text.setAttribute('font-size', '14')
    text.setAttribute('font-weight', 'bold')
    text.setAttribute('font-family', 'Arial, sans-serif')
    text.textContent = label
    text.style.pointerEvents = 'none'

    const labelWidth = measureSvgTextWidth(text, label) + 16
    const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    labelBg.setAttribute('x', String(midX - labelWidth / 2))
    labelBg.setAttribute('y', String(topY - 18))
    labelBg.setAttribute('width', String(labelWidth))
    labelBg.setAttribute('height', '16')
    labelBg.setAttribute('rx', '2')
    labelBg.setAttribute('ry', '2')
    labelBg.setAttribute('fill', labelBgFill)
    labelBg.setAttribute('stroke', labelBgStroke)
    labelBg.setAttribute('stroke-width', '2')
    labelBg.setAttribute('opacity', '0.9')
    labelBg.style.pointerEvents = 'none'

    group.appendChild(path)
    group.appendChild(arrowhead)
    group.appendChild(labelBg)
    group.appendChild(text)
    appendDeviationArrowGroup(container, group)
    return
  }

  const createLabel = (x: number, y: number) => {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('x', String(x))
    text.setAttribute('y', String(y))
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('dominant-baseline', 'middle')
    text.setAttribute('fill', labelColor)
    text.setAttribute('font-size', '14')
    text.setAttribute('font-weight', 'bold')
    text.setAttribute('font-family', 'Arial, sans-serif')
    text.textContent = label
    text.style.pointerEvents = 'none'

    const labelWidth = measureSvgTextWidth(text, label) + 16
    const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    labelBg.setAttribute('x', String(x - labelWidth / 2))
    labelBg.setAttribute('y', String(y - 10))
    labelBg.setAttribute('width', String(labelWidth))
    labelBg.setAttribute('height', '16')
    labelBg.setAttribute('rx', '2')
    labelBg.setAttribute('ry', '2')
    labelBg.setAttribute('fill', labelBgFill)
    labelBg.setAttribute('stroke', labelBgStroke)
    labelBg.setAttribute('stroke-width', '2')
    labelBg.setAttribute('opacity', '0.9')
    labelBg.style.pointerEvents = 'none'

    return { text, labelBg }
  }

  const isEndEvent = to.startsWith('<<end>>:')
  if (isEndEvent) {
    const sourcePoint = {
      x: sourceCoord.x + sourceCoord.width,
      y: sourceCoord.centerY
    }
    const targetPoint = {
      x: targetCoord.x,
      y: targetCoord.centerY
    }
    const endAngle = Math.atan2(targetPoint.y - sourcePoint.y, targetPoint.x - sourcePoint.x)
    const labelX = (sourcePoint.x + targetPoint.x) / 2
    const labelY = sourcePoint.y - 10

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    setBpmnAugmentationAttributes(group, 'deviation-arrow', {
      view: 'deviations',
      from,
      to
    })
    group.style.pointerEvents = 'none'

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', `M ${sourcePoint.x} ${sourcePoint.y} L ${targetPoint.x} ${targetPoint.y}`)
    path.setAttribute('stroke', arrowStroke)
    path.setAttribute('stroke-width', '2')
    path.setAttribute('stroke-dasharray', '8,4')
    path.setAttribute('fill', 'none')
    path.setAttribute('opacity', '0.8')

    const arrowhead = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    arrowhead.setAttribute('points', [
      `${targetPoint.x},${targetPoint.y}`,
      `${targetPoint.x - arrowheadSize * Math.cos(endAngle - 0.4)},${targetPoint.y - arrowheadSize * Math.sin(endAngle - 0.4)}`,
      `${targetPoint.x - arrowheadSize * Math.cos(endAngle + 0.4)},${targetPoint.y - arrowheadSize * Math.sin(endAngle + 0.4)}`
    ].join(' '))
    arrowhead.setAttribute('fill', arrowStroke)
    arrowhead.setAttribute('stroke', arrowStroke)
    arrowhead.setAttribute('stroke-width', '1')
    arrowhead.setAttribute('stroke-linejoin', 'round')
    arrowhead.setAttribute('stroke-linecap', 'round')
    arrowhead.setAttribute('opacity', '0.8')

    const { text, labelBg } = createLabel(labelX, labelY)
    group.appendChild(path)
    group.appendChild(arrowhead)
    group.appendChild(labelBg)
    group.appendChild(text)
    appendDeviationArrowGroup(container, group)
    return
  }

  const getSmartConnectionPoints = (source: any, target: any, isStartEvent: boolean = false) => {
    // Pick the nearest face of each box so deviation arrows attach naturally around activities.
    const sourceCenterX = source.centerX
    const sourceCenterY = source.centerY
    const targetCenterX = target.centerX
    const targetCenterY = target.centerY
    const angle = Math.atan2(targetCenterY - sourceCenterY, targetCenterX - sourceCenterX)
    let sourceX: number
    let sourceY: number

    if (isStartEvent) {
      sourceX = source.x + source.width
      sourceY = sourceCenterY
    } else if (angle >= -Math.PI / 4 && angle <= Math.PI / 4) {
      sourceX = source.x + source.width
      sourceY = sourceCenterY
    } else if (angle > Math.PI / 4 && angle < 3 * Math.PI / 4) {
      sourceX = sourceCenterX
      sourceY = source.y + source.height
    } else if (angle >= 3 * Math.PI / 4 || angle <= -3 * Math.PI / 4) {
      sourceX = source.x
      sourceY = sourceCenterY
    } else {
      sourceX = sourceCenterX
      sourceY = source.y
    }

    let targetX: number
    let targetY: number
    if (angle >= -Math.PI / 4 && angle <= Math.PI / 4) {
      targetX = target.x
      targetY = targetCenterY
    } else if (angle > Math.PI / 4 && angle < 3 * Math.PI / 4) {
      targetX = targetCenterX
      targetY = target.y
    } else if (angle >= 3 * Math.PI / 4 || angle <= -3 * Math.PI / 4) {
      targetX = target.x + target.width
      targetY = targetCenterY
    } else {
      targetX = targetCenterX
      targetY = target.y + target.height
    }

    return {
      source: { x: sourceX, y: sourceY },
      target: { x: targetX, y: targetY }
    }
  }

  const getConnectionFace = (point: { x: number; y: number }, coord: any): 'top' | 'bottom' | 'left' | 'right' => {
    if (Math.abs(point.y - coord.y) < 1) return 'top'
    if (Math.abs(point.y - (coord.y + coord.height)) < 1) return 'bottom'
    if (Math.abs(point.x - coord.x) < 1) return 'left'
    if (Math.abs(point.x - (coord.x + coord.width)) < 1) return 'right'
    return 'right'
  }

  const applyFaceOffset = (
    point: { x: number; y: number },
    coord: { x: number; y: number; width: number; height: number },
    face: string,
    isOrigin: boolean,
    usageCount: number
  ) => {
    // Spread repeated arrows on the same face so labels and arrowheads do not stack exactly.
    const maxOffset = face === 'top' || face === 'bottom'
      ? Math.max(0, coord.width / 2 - 8)
      : Math.max(0, coord.height / 2 - 8)
    const offset = Math.min((usageCount + 1) * 10, maxOffset)

    switch (face) {
      case 'top':
      case 'bottom':
        return { x: isOrigin ? point.x - offset : point.x + offset, y: point.y }
      case 'left':
      case 'right':
        return { x: point.x, y: isOrigin ? point.y - offset : point.y + offset }
      default:
        return point
    }
  }

  const isStartEvent = from === '<<start>>'
  let { source: sourcePoint, target: targetPoint } = getSmartConnectionPoints(sourceCoord, targetCoord, isStartEvent)
  const sourceFace = getConnectionFace(sourcePoint, sourceCoord)
  const targetFace = getConnectionFace(targetPoint, targetCoord)
  const sourceKey = `${from}_${sourceFace}`
  const targetKey = `${to}_${targetFace}`
  const sourceUsage = connectionPointsUsage.get(sourceKey) || { origins: 0, destinations: 0 }
  const targetUsage = connectionPointsUsage.get(targetKey) || { origins: 0, destinations: 0 }
  const nextUsageMap = new Map(connectionPointsUsage)
  nextUsageMap.set(sourceKey, { origins: sourceUsage.origins + 1, destinations: sourceUsage.destinations })
  nextUsageMap.set(targetKey, { origins: targetUsage.origins, destinations: targetUsage.destinations + 1 })
  onConnectionPointsUsageChange(nextUsageMap)

  if (!isStartEvent) {
    sourcePoint = applyFaceOffset(sourcePoint, sourceCoord, sourceFace, true, sourceUsage.origins)
  }
  targetPoint = applyFaceOffset(targetPoint, targetCoord, targetFace, false, targetUsage.destinations)

  const deltaX = targetPoint.x - sourcePoint.x
  const deltaY = targetPoint.y - sourcePoint.y
  const distance = Math.max(1, Math.sqrt(deltaX * deltaX + deltaY * deltaY))
  const baseArchHeight = Math.max(40, Math.min(80, distance * 0.25))
  const midX = (sourcePoint.x + targetPoint.x) / 2
  const midY = (sourcePoint.y + targetPoint.y) / 2
  const perpX = -deltaY / distance
  const perpY = deltaX / distance
  const controlX = midX + perpX * baseArchHeight
  const controlY = midY + perpY * baseArchHeight
  const tangentX = 2 * (targetPoint.x - controlX)
  const tangentY = 2 * (targetPoint.y - controlY)
  const endAngle = Math.atan2(tangentY, tangentX)
  const labelX = controlX - 4
  const labelY = controlY - 10

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  const arrowId = `arrow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  setBpmnAugmentationAttributes(group, 'deviation-arrow', {
    view: 'deviations',
    from,
    to,
    id: arrowId
  })
  group.style.pointerEvents = 'none'

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', `M ${sourcePoint.x} ${sourcePoint.y} Q ${controlX} ${controlY} ${targetPoint.x} ${targetPoint.y}`)
  path.setAttribute('stroke', arrowStroke)
  path.setAttribute('stroke-width', '2')
  path.setAttribute('stroke-dasharray', '8,4')
  path.setAttribute('fill', 'none')
  path.setAttribute('opacity', '0.8')

  const arrowhead = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
  arrowhead.setAttribute('points', [
    `${targetPoint.x},${targetPoint.y}`,
    `${targetPoint.x - arrowheadSize * Math.cos(endAngle - 0.4)},${targetPoint.y - arrowheadSize * Math.sin(endAngle - 0.4)}`,
    `${targetPoint.x - arrowheadSize * Math.cos(endAngle + 0.4)},${targetPoint.y - arrowheadSize * Math.sin(endAngle + 0.4)}`
  ].join(' '))
  arrowhead.setAttribute('fill', arrowStroke)
  arrowhead.setAttribute('stroke', arrowStroke)
  arrowhead.setAttribute('stroke-width', '1')
  arrowhead.setAttribute('stroke-linejoin', 'round')
  arrowhead.setAttribute('stroke-linecap', 'round')
  arrowhead.setAttribute('opacity', '0.8')

  const { text, labelBg } = createLabel(labelX, labelY)
  group.appendChild(path)
  group.appendChild(arrowhead)
  group.appendChild(labelBg)
  group.appendChild(text)
  appendDeviationArrowGroup(container, group)
}

// When a deviation filter is active, keep adjacent deviation nodes visible as context.
export const getSecondaryDeviationActivities = ({
  isDeviationFilterActive,
  primaryDeviationActivities,
  deviationActivitiesNames,
  deviationFlows
}: {
  isDeviationFilterActive: boolean
  primaryDeviationActivities: Set<string>
  deviationActivitiesNames: Set<string>
  deviationFlows: SelectedPerformanceFlowMetric[]
}) => {
  const secondaryDeviationActivities = new Set<string>()

  if (!isDeviationFilterActive) {
    return secondaryDeviationActivities
  }

  const adjacentActivities = new Set<string>()

  deviationFlows.forEach(flow => {
    const toActivity = flow.to === '<<end>>' ? `<<end>>:${flow.from}` : flow.to
    if (primaryDeviationActivities.has(flow.from) || primaryDeviationActivities.has(toActivity)) {
      adjacentActivities.add(flow.from)
      adjacentActivities.add(toActivity)
    }
  })

  adjacentActivities.forEach(activity => {
    if (deviationActivitiesNames.has(activity) && !primaryDeviationActivities.has(activity)) {
      secondaryDeviationActivities.add(activity)
    }
  })

  return secondaryDeviationActivities
}

// Shared deviation-activity placement pipeline used by performance, frequency and alignments views.
export const buildGenericDeviationActivitiesAndLanes = ({
  xmlString,
  coordinates,
  allElements,
  lanes,
  activitiesLanes,
  deviationActivities,
  primaryDeviationActivities,
  secondaryDeviationActivities,
  orderedDeviationActivities,
  findPredecessorCoordinates,
  findLaneForActivity,
  getPlacementDirection,
  createDeviationLane,
  findSafePosition,
  createActivityXML,
  deviationSizeProfile,
  onCoordinatesChange,
  onLanesChange
}: {
  xmlString: string
  coordinates: ActivityCoordinatesCollection
  allElements: ElementCoordinates[]
  lanes: LaneElements
  activitiesLanes: Record<string, string>
  deviationActivities: Record<string, GenericDeviationActivityMetric>
  primaryDeviationActivities: Set<string>
  secondaryDeviationActivities: Set<string>
  orderedDeviationActivities: string[]
  findPredecessorCoordinates: (
    activityName: string,
    coordinates: ActivityCoordinatesCollection
  ) => FindPredecessorCoordinatesResult | null
  findLaneForActivity: (
    activityName: string,
    predecessorActivity: string,
    activitiesLanes: Record<string, string>,
    lanes: LaneElements
  ) => { lane: string; inModel: boolean }
  getPlacementDirection?: (
    activityName: string,
    predecessor: FindPredecessorCoordinatesResult
  ) => boolean | null
  createDeviationLane: (
    originalXML: string,
    lastActivityLane: string,
    laneName: string,
    activitiesCoords: ActivityCoordinatesCollection,
    allElementsCoords: ElementCoordinates[],
    lanesCoords: LaneElements,
    laneHeight?: number
  ) => CreateDeviationLaneResult
  findSafePosition: (
    refX: number,
    refY: number,
    width: number,
    height: number,
    elements: ElementCoordinates[],
    lanes: LaneElements,
    lane: string,
    isToActivityOnRight: boolean | null,
    horizontalOffset?: number,
    isEndEvent?: boolean,
    useLaneCenterY?: boolean,
    laneCenterBounds?: LaneElements
  ) => SafePositionResult
  createActivityXML: (originalXML: string, activityName: string, x?: number, y?: number, size?: DeviationActivitySize) => string
  deviationSizeProfile?: DeviationActivitySizeProfile
  onCoordinatesChange?: (coordinates: ActivityCoordinatesCollection) => void
  onLanesChange?: (lanes: LaneElements) => void
}) => {
  const newActivitiesToStyleSet = new Set<string>()
  const newDeviationLanesSet = new Set<string>()
  const deviatedLanesNames: string[] = []
  const newSecondaryActivitiesSet = new Set<string>()

  let modifiedXML = xmlString
  let updatedCoordinates = coordinates
  let updatedAllElements = allElements
  let updatedLanes = lanes
  let updatedLaneCenterBounds = lanes
  let updatedActivitiesLanes = activitiesLanes

  const retryCounts = new Map<string, number>()
  let pendingActivities = [...orderedDeviationActivities]
  let madeProgress = true

  // Some deviation chains can only be placed after their predecessor deviation has been inserted.
  while (pendingActivities.length > 0 && madeProgress) {
    madeProgress = false
    const nextPending: string[] = []

    pendingActivities.forEach(activityName => {
      const isPrimaryActivity = primaryDeviationActivities.has(activityName)
      const isSecondaryActivity = secondaryDeviationActivities.has(activityName)

      if (!isPrimaryActivity && !isSecondaryActivity) return

      const retryCount = retryCounts.get(activityName) ?? 0
      const predecessor = findPredecessorCoordinates(activityName, updatedCoordinates)

      if (!predecessor) {
        // Defer this activity to the next pass instead of placing it without an anchor.
        retryCounts.set(activityName, retryCount + 1)
        nextPending.push(activityName)
        return
      }

      const lane = findLaneForActivity(activityName, predecessor.activity, updatedActivitiesLanes, updatedLanes)
      const deviationActivity = deviationActivities[activityName]
      const activityLabel = deviationActivity?.label ?? activityName
      const activitySize = getDeviationActivitySize(activityLabel, deviationSizeProfile)
      // Generated lanes must be tall enough for the computed deviation activity height.
      const generatedLaneHeight = activitySize.height + (deviationSizeProfile ?? DEFAULT_DEVIATION_SIZE_PROFILE).paddingY * 2

      if (!updatedLanes[lane.lane]) {
        // Stale or unknown lanes get a dedicated deviation lane before normal safe placement runs.
        const fallbackLane = Object.entries(updatedLanes)
          .sort(([, a], [, b]) => a.fromY - b.fromY)[0]?.[0]
        const lastActivityLane = updatedActivitiesLanes[predecessor.activity] || predecessor.lane || fallbackLane
        const deviationLaneName = !lane.inModel && lane.lane
          ? lane.lane
          : `Deviation - ${activityLabel}`

        if (!lastActivityLane) {
          console.warn(`[DEVIATION PLACEMENT] Could not create deviation lane for "${activityName}" because no insertion anchor lane was found`)
          retryCounts.set(activityName, retryCount + 1)
          nextPending.push(activityName)
          return
        }

        const insertionY = updatedLanes[lastActivityLane]?.toY
        const updatedVariables = createDeviationLane(
          modifiedXML,
          lastActivityLane,
          deviationLaneName,
          updatedCoordinates,
          updatedAllElements,
          updatedLanes,
          generatedLaneHeight
        )

        modifiedXML = updatedVariables.xml
        updatedCoordinates = updatedVariables.activitiesCoordinates
        updatedAllElements = updatedVariables.allElementsCoordinates
        updatedLanes = updatedVariables.lanes
        lane.lane = updatedVariables.newLaneId
        // Preserve original lane centres for existing lanes; only new lanes receive the inserted bounds.
        updatedLaneCenterBounds = insertionY !== undefined
          ? shiftLaneBoundsBelowY(updatedLaneCenterBounds, insertionY, Math.max(120, generatedLaneHeight))
          : updatedLaneCenterBounds

        if (!updatedVariables.newLaneId || !updatedLanes[updatedVariables.newLaneId]) {
          console.warn(`[DEVIATION PLACEMENT] Could not create a valid deviation lane for "${activityName}"`)
          retryCounts.set(activityName, retryCount + 1)
          nextPending.push(activityName)
          return
        }
        updatedLaneCenterBounds = {
          ...updatedLaneCenterBounds,
          [updatedVariables.newLaneId]: updatedLanes[updatedVariables.newLaneId]
        }

        deviatedLanesNames.push(deviationLaneName)
        newDeviationLanesSet.add(updatedVariables.newLaneId)
        onCoordinatesChange?.(updatedCoordinates)
        onLanesChange?.(updatedLanes)
      }

      const placementDirection = getPlacementDirection?.(activityName, predecessor) ?? null

      let safePosition = findSafePosition(
        predecessor.coordinates.x,
        predecessor.coordinates.y,
        activitySize.width,
        activitySize.height,
        updatedAllElements,
        updatedLanes,
        lane.lane,
        placementDirection,
        undefined,
        false,
        true,
        updatedLaneCenterBounds
      )

      if (!safePosition.safe && safePosition.reason === 'no-free-position') {
        // If the lane is full in this direction, widen the pool and retry the same placement search.
        const expansionDirection: HorizontalExpansionDirection = placementDirection === false ? 'left' : 'right'
        const horizontalExpansionWidth = activitySize.width + (deviationSizeProfile ?? DEFAULT_DEVIATION_SIZE_PROFILE).horizontalExpansionPadding
        const expandedVariables = expandBpmnHorizontally(
          modifiedXML,
          expansionDirection,
          updatedCoordinates,
          updatedAllElements,
          updatedLanes,
          horizontalExpansionWidth
        )

        modifiedXML = expandedVariables.xml
        updatedCoordinates = expandedVariables.activitiesCoordinates
        updatedAllElements = expandedVariables.allElementsCoordinates
        updatedLanes = expandedVariables.lanes
        updatedLaneCenterBounds = Object.fromEntries(
          Object.entries(updatedLaneCenterBounds).map(([laneId, laneBounds]) => [
            laneId,
            {
              ...laneBounds,
              toX: laneBounds.toX + horizontalExpansionWidth
            }
          ])
        )
        onCoordinatesChange?.(updatedCoordinates)
        onLanesChange?.(updatedLanes)

        // Left expansion shifts existing content, so the predecessor anchor must be read again.
        const updatedPredecessorCoordinates = updatedCoordinates[predecessor.activity] || predecessor.coordinates
        safePosition = findSafePosition(
          updatedPredecessorCoordinates.x,
          updatedPredecessorCoordinates.y,
          activitySize.width,
          activitySize.height,
          updatedAllElements,
          updatedLanes,
          lane.lane,
          placementDirection,
          undefined,
          false,
          true,
          updatedLaneCenterBounds
        )
      }

      if (!safePosition.safe) {
        console.warn(`[DEVIATION PLACEMENT] Using unsafe fallback position for "${activityName}" after horizontal lane expansion attempt failed with reason "${safePosition.reason}"`)
      }

      modifiedXML = createActivityXML(
        modifiedXML,
        activityLabel,
        safePosition.x,
        safePosition.y,
        activitySize
      )

      if (isPrimaryActivity) {
        newActivitiesToStyleSet.add(activityName)
      } else {
        newSecondaryActivitiesSet.add(activityName)
      }

      // Newly inserted deviations become anchors and collision obstacles for later placements.
      updatedCoordinates[activityName] = {
        x: safePosition.x,
        y: safePosition.y,
        width: activitySize.width,
        height: activitySize.height,
        centerX: safePosition.x + activitySize.width / 2,
        centerY: safePosition.y + activitySize.height / 2,
        lane: lane.lane
      }

      updatedAllElements.push({
        x: safePosition.x,
        y: safePosition.y,
        width: activitySize.width,
        height: activitySize.height
      })

      updatedActivitiesLanes[activityName] = lane.lane

      madeProgress = true
    })

    pendingActivities = nextPending
  }

  return {
    modifiedXML,
    coordinates: updatedCoordinates,
    allElements: updatedAllElements,
    lanes: updatedLanes,
    activitiesLanes: updatedActivitiesLanes,
    newActivitiesToStyleSet,
    newDeviationLanesSet,
    deviatedLanesNames,
    newSecondaryActivitiesSet
  }
}

// Shared deviation-flow and synthetic end-event builder used by all augmented views.
export const buildGenericDeviationArrows = ({
  xmlString,
  coordinates,
  allElements,
  lanes,
  activitiesLanes,
  deviationFlows,
  allDeviationFlows,
  primaryDeviationActivities,
  isDeviationFilterActive,
  filterMin,
  filterMax,
  findSafePosition,
  createEndEventXML,
  deviationSizeProfile
}: {
  xmlString: string
  coordinates: ActivityCoordinatesCollection
  allElements: ElementCoordinates[]
  lanes: LaneElements
  activitiesLanes: Record<string, string>
  deviationFlows: GenericDeviationFlowMetric[]
  allDeviationFlows: GenericDeviationFlowMetric[]
  primaryDeviationActivities: Set<string>
  isDeviationFilterActive: boolean
  filterMin: number
  filterMax: number
  findSafePosition: (
    refX: number,
    refY: number,
    width: number,
    height: number,
    elements: ElementCoordinates[],
    lanes: LaneElements,
    lane: string,
    isToActivityOnRight: boolean | null,
    horizontalOffset?: number,
    isEndEvent?: boolean,
    useLaneCenterY?: boolean,
    laneCenterBounds?: LaneElements
  ) => SafePositionResult
  createEndEventXML: (originalXML: string, x: number, y: number, size?: DeviationActivitySize) => { xml: string; id: string }
  deviationSizeProfile?: DeviationActivitySizeProfile
}) => {
  let modifiedXML = xmlString
  const arrowsToCreate: GenericDeviationArrow[] = []
  const endEventIdsToStyle = new Map<string, boolean>()
  let updatedCoordinates = coordinates
  let updatedAllElements = allElements
  let updatedLanes = lanes

  const addArrow = (connection: GenericDeviationFlowMetric, isSecondary: boolean) => {
    // Multiple filters can select the same relation; render each deviation arrow only once.
    const isDuplicate = arrowsToCreate.some(arrow =>
      arrow.from === connection.from && arrow.to === connection.to
    )

    if (!isDuplicate) {
      arrowsToCreate.push({
        from: connection.from,
        to: connection.to,
        value: connection.value,
        label: connection.label,
        isSecondary
      })
    }
  }

  const placeSyntheticEndEvent = (
    flow: GenericDeviationFlowMetric,
    coordinateKey: string,
    isSecondary: boolean
  ) => {
    const fromCoordinates = updatedCoordinates[flow.from]
    if (!fromCoordinates) return false

    // Synthetic termination events inherit the imported BPMN end-event size profile.
    const endEventSize = getDeviationEndEventSize(deviationSizeProfile)
    const desiredCoordinates = {
      key: coordinateKey,
      x: fromCoordinates.x + fromCoordinates.width + 20,
      y: fromCoordinates.y + (fromCoordinates.height - endEventSize.height) / 2
    }

    const laneId = activitiesLanes[flow.from] || fromCoordinates.lane

    let endPosition = findSafePosition(
      desiredCoordinates.x,
      desiredCoordinates.y,
      endEventSize.width,
      endEventSize.height,
      updatedAllElements,
      updatedLanes,
      laneId,
      true,
      170,
      true
    )

    if (!endPosition.safe && endPosition.reason === 'no-free-position') {
      // Termination artefacts use the same horizontal expansion fallback as deviation activities.
      const horizontalExpansionWidth = endEventSize.width + (deviationSizeProfile ?? DEFAULT_DEVIATION_SIZE_PROFILE).horizontalExpansionPadding
      const expandedVariables = expandBpmnHorizontally(
        modifiedXML,
        'right',
        updatedCoordinates,
        updatedAllElements,
        updatedLanes,
        horizontalExpansionWidth
      )

      modifiedXML = expandedVariables.xml
      updatedCoordinates = expandedVariables.activitiesCoordinates
      updatedAllElements = expandedVariables.allElementsCoordinates
      updatedLanes = expandedVariables.lanes

      const shiftedFromCoordinates = updatedCoordinates[flow.from] || fromCoordinates
      endPosition = findSafePosition(
        shiftedFromCoordinates.x + shiftedFromCoordinates.width + 20,
        shiftedFromCoordinates.y + (shiftedFromCoordinates.height - endEventSize.height) / 2,
        endEventSize.width,
        endEventSize.height,
        updatedAllElements,
        updatedLanes,
        laneId,
        true,
        170,
        true
      )
    }

    if (!endPosition.safe) {
      console.warn(`[DEVIATION END EVENT] Using unsafe fallback position for "${flow.from}" after horizontal lane expansion attempt failed with reason "${endPosition.reason}"`)
    }

    const endEventResult = createEndEventXML(modifiedXML, endPosition.x, endPosition.y, endEventSize)

    modifiedXML = endEventResult.xml
    endEventIdsToStyle.set(endEventResult.id, isSecondary)

    updatedCoordinates[desiredCoordinates.key] = {
      x: endPosition.x,
      y: endPosition.y,
      width: endEventSize.width,
      height: endEventSize.height,
      centerX: endPosition.x + endEventSize.width / 2,
      centerY: endPosition.y + endEventSize.height / 2,
      lane: laneId
    }

    updatedAllElements.push({
      x: endPosition.x,
      y: endPosition.y,
      width: endEventSize.width,
      height: endEventSize.height
    })

    return true
  }

  deviationFlows.forEach(flow => {
    if (flow.to === '<<end>>') {
      const desiredCoordinatesKey = `<<end>>:${flow.from}`
      const endEventPlaced = placeSyntheticEndEvent(flow, desiredCoordinatesKey, false)
      if (!endEventPlaced) return

      arrowsToCreate.push({
        from: flow.from,
        to: desiredCoordinatesKey,
        value: flow.value,
        label: flow.label,
        isSecondary: false
      })
    } else {
      addArrow(flow, false)
    }
  })

  if (isDeviationFilterActive) {
    // Add out-of-range flows only when they connect directly to the filtered deviation context.
    allDeviationFlows.forEach(flow => {
      const isWithinFilterRange = flow.value >= filterMin && flow.value <= filterMax
      if (isWithinFilterRange) return

      const alreadyAdded = arrowsToCreate.some(arrow =>
        arrow.from === flow.from && arrow.to === flow.to
      )
      if (alreadyAdded) return

      const fromIsPrimary = primaryDeviationActivities.has(flow.from)
      const toActivity = flow.to === '<<end>>' ? `<<end>>:${flow.from}` : flow.to
      const toIsPrimary = primaryDeviationActivities.has(toActivity)
      const isSecondaryFlow = fromIsPrimary || toIsPrimary

      if (isSecondaryFlow) {
        if (flow.to === '<<end>>') {
          if (!updatedCoordinates[toActivity]) {
            placeSyntheticEndEvent(flow, toActivity, true)
          }

          if (updatedCoordinates[toActivity]) {
            addArrow({ ...flow, to: toActivity }, true)
          }
        } else {
          addArrow(flow, true)
        }
      }
    })
  }

  return {
    modifiedXML,
    coordinates: updatedCoordinates,
    allElements: updatedAllElements,
    lanes: updatedLanes,
    arrowsToCreate,
    endEventIdsToStyle
  }
}
