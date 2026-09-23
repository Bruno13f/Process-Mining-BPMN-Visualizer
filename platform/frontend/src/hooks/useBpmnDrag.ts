import { useState, useCallback } from 'react'

/**
 * Custom hook to manage drag interaction state for BPMN viewer
 */
export function useBpmnDrag() {
  const [isDragging, setIsDragging] = useState(false)

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true)
    e.currentTarget.style.cursor = 'grabbing'
    e.preventDefault()
  }, [])

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(false)
    e.currentTarget.style.cursor = 'grab'
  }, [])

  const handleMouseLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(false)
    e.currentTarget.style.cursor = 'grab'
  }, [])

  return {
    isDragging,
    handleMouseDown,
    handleMouseUp,
    handleMouseLeave
  }
}
