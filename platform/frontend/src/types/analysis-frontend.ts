export interface LaneElements {
  [laneId: string]: {
    fromX: number
    toX: number
    fromY: number
    toY: number
  }
}

export interface ElementCoordinates {
  x: number
  y: number
  width: number
  height: number
}

export interface ActivityCoordinates {
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
  lane: string
}

export interface ActivityCoordinatesCollection {
  [activityName: string]: ActivityCoordinates
}

export type DeviationActivitySizeProfile = {
  baseWidth: number
  baseHeight: number
  endEventWidth: number
  endEventHeight: number
  minWidth: number
  maxWidth: number
  paddingX: number
  paddingY: number
  lineHeight: number
  horizontalExpansionPadding: number
}

export type DeviationActivitySize = {
  width: number
  height: number
}
