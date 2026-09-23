export interface AnalysisVariables {
  conformance_metrics: ConformanceMetrics,
  performance_metrics: PerformanceMetrics,
  frequency_metrics: FrequencyMetrics,
  helper_variables: HelperVariables,
}

export interface AlignmentsMetrics {
  activities_moves: ActivitiesMoves,
}

export interface ActivitiesMoves {
  [activityName: string]: {
    model_moves: number
    log_moves: number
    synchronous_moves: number
    model_moves_percentage: number
    log_moves_percentage: number
    synchronous_moves_percentage: number
  }
}

export interface ConformanceMetrics {
  conformance_profile: ConformanceProfile,
  conformance_statistics: ConformanceStatistics,
  alignments_metrics: AlignmentsMetrics
  time_conformance: TimeConformanceMetrics
}

export interface TimeConformanceMetrics {
  model: TimeConformanceFlowMetrics
  deviations: TimeConformanceFlowMetrics
  all: TimeConformanceFlowMetrics
}

export type TimeConformanceFlowMetrics = TimeConformanceFlowMetric[]

export interface TimeConformanceFlowMetric {
  from: string
  to: string
  avg_waiting_time: number
  avg_target_time: number
  median_waiting_time: number
  median_target_time: number
  cycle_time: number
}

export interface ConformanceProfile {
  fitness: number
  precision: number
  generalization: number
  simplicity: number
}

export interface ConformanceStatistics {
  perfect_fitting_traces: number
  total_traces: number
}

export interface PerformanceMetrics {
  activities: {
    model: PerformanceActivityMetric
    deviations: PerformanceActivityMetric
    all: PerformanceActivityMetric
  }
  flows: {
    model: PerformanceFlowMetric[]
    deviations: PerformanceFlowMetric[]
    all: PerformanceFlowMetric[]
  }
  general: PerformanceGeneralStats
}

export interface PerformanceActivityMetric {
  [activityName: string]: {
    avg_sojourn: number
    min_sojourn: number
    max_sojourn: number
    event_count: number
    median_sojourn: number
    inModel: boolean
    originalActivity: string
  }
}

export interface PerformanceFlowMetric {
  from: string
  to: string
  avg_sojourn: number
  median_sojourn: number
}

export interface PerformanceGeneralStats {
  avg_trace_time: number
  min_trace_time: number
  max_trace_time: number
  total_traces: number
  total_events: number
}

export interface FrequencyMetrics {
  activities: {
    model: FrequencyActivityMetric
    deviations: FrequencyActivityMetric
    all: FrequencyActivityMetric
  }
  flows: {
    model: FrequencyFlowMetric[]
    deviations: FrequencyFlowMetric[]
    all: FrequencyFlowMetric[]
  }
}

export interface FrequencyActivityMetric {
  [activityName: string]: {
    frequency: number
    inModel: boolean
    originalActivity: string
    mismatch_incoming: number
    mismatch_outgoing: number
  }
}

export interface FrequencyFlowMetric {
  from: string
  to: string
  frequency: number
}

export interface HelperVariables {
  activities_roles: ActivitiesRoles
  roles_lanes: RolesLanes
  model_next_activities: ModelNextActivities
  deviation_predecessors: DeviationPredecessors
  deviation_successors: DeviationSuccessors
}

export interface RoleLane {
  lane_id: string,
  lane_name: string,
  frequency: number
}

export interface RolesLanes {
  [role_name: string]: RoleLane[]
}

export interface ActivityRole {
  role: string
  frequency: number
}

export interface ActivitiesRoles {
  model: ActivitiesRolesMapping
  all: ActivitiesRolesMapping
}

export interface ActivitiesRolesMapping {
  [activityName: string]: ActivityRole[]
}

export interface ModelNextActivities {
  [activityName: string]: string[]
}

export interface DeviationPredecessors {
  [activityName: string]: {
    predecessor: string
    frequency: number
  }[]
}

export interface DeviationSuccessors {
  [activityName: string]: {
    successor: string
    frequency: number
  }[]
}

export interface Deviation {
  fromActivity: string
  path: PathActivity[]
  toActivity: string | null
  frequency: number
  type: 'expected' | 'unexpected'
}

export interface PathActivity {
  activity: string,
  originalActivity: string,
  inModel: boolean
}
