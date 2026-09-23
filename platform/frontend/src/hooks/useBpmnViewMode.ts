import { useState, useRef, useEffect } from 'react'

export function useBpmnViewMode(initialMode: 'model' | 'deviations' = 'deviations') {
  const [viewMode, setViewMode] = useState<'model' | 'deviations'>(initialMode)
  const viewModeRef = useRef(viewMode)

  useEffect(() => {
    viewModeRef.current = viewMode
  }, [viewMode])

  return {
    viewMode,
    setViewMode,
    viewModeRef
  }
}
