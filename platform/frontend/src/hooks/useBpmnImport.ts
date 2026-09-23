import { useCallback } from 'react'
import type NavigatedViewer from 'bpmn-js/lib/NavigatedViewer'

/**
 * Custom hook for importing BPMN XML with consistent zoom settings
 */
export function useBpmnImport(viewerRef: React.RefObject<NavigatedViewer | null>) {
  const importAndSetupXML = useCallback((modifiedXML: string) => {
    if (!viewerRef.current) return Promise.reject('Viewer not initialized')

    return viewerRef.current.importXML(modifiedXML).then(() => {
      const canvas = viewerRef.current!.get('canvas') as any
      canvas.zoom('fit-viewport', 'auto')
      return new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          const currentZoom = canvas.zoom()
          canvas.zoom(currentZoom * 0.9, 'auto')
          resolve()
        })
      })
    })
  }, [viewerRef])

  return { importAndSetupXML }
}
