import { CircleCheck, CircleStop, CircleX } from "lucide-react"
import { Card } from "./ui/card"
import { useEffect, useState, useRef } from "react"
import { VariableRetrievalModal } from "./variable-retrieval-modal"
import { MappingApprovalModal } from "./mapping-approval-modal"
import type { AnalysisVariables } from "../types/analysis-backend"
import { useTranslation } from "react-i18next"


interface AnalysisModalProps {
    jobId: string
    onClose: () => void
    onStopAnalysis: () => void
    onAnalysisComplete: (variables: AnalysisVariables) => void
}

export function AnalysisModal({ jobId, onClose, onStopAnalysis, onAnalysisComplete }: AnalysisModalProps) {
    const { t } = useTranslation()
    const [messages, setMessages] = useState<string[]>([])
    const [isAnalyzing, setIsAnalyzing] = useState(true)
    const [analysisStatus, setAnalysisStatus] = useState<'running' | 'completed' | 'failed' | 'cancelled'>('running')
    const [isStopping, setIsStopping] = useState(false)
    const [progress, setProgress] = useState<{current_cell: number, total_cells: number, percentage: number} | null>(null)
    const [showVariableModal, setShowVariableModal] = useState(false)
    const [showMappingModal, setShowMappingModal] = useState(false)
    const [mappingsSuggested, setMappingsSuggested] = useState<string[]>([])
    const [mappingsNonSuggested, setMappingsNonSuggested] = useState<string[]>([])
    const [bpmn_activities, setBpmn_activities] = useState<string[]>([])
    const [log_activities, setLog_activities] = useState<string[]>([])
    const [appliedMappings, setAppliedMappings] = useState<Array<{ log: string, model: string }>>([])
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const socketRef = useRef<WebSocket | null>(null)
    const isAnalyzingRef = useRef(true)
    const intentionalCloseRef = useRef(false)

    const HTTP_BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000') as string
    const BACKEND_URL = (import.meta.env.VITE_BACKEND_WS ?? 'ws://localhost:8000/ws') as string

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    useEffect(() => {
        isAnalyzingRef.current = isAnalyzing
    }, [isAnalyzing])

    useEffect(() => {
        if (!jobId) {
            return
        }

        if (jobId === 'initializing') {
            setMessages(['⏳ Preparing analysis...', '📤 Uploading files to server...'])
            return
        }

        if (!isAnalyzing) {
            return
        }

        const connectWithRetry = async () => {
            let retries = 0
            const maxRetries = 5
            
            const connect = () => {
                return new Promise<WebSocket>((resolve, reject) => {
                    const ws = new WebSocket(`${BACKEND_URL}/${jobId}`)
                    
                    
                    const timeout = setTimeout(() => {
                        ws.close()
                        reject(new Error('Connection timeout'))
                    }, 5000)
                    
                    ws.onopen = () => {
                        clearTimeout(timeout)
                        console.log(`✅ Connected to WebSocket for job ${jobId}`)
                        setMessages(prev => [...prev, '🔗 Connected to analysis server...'])
                        resolve(ws)
                    }
                    
                    ws.onerror = (err) => {
                        clearTimeout(timeout)
                        console.error('❌ WebSocket connection failed:', err)
                        reject(err)
                    }
                })
            }
            
            while (retries < maxRetries) {
                try {
                    const ws = await connect()
                    socketRef.current = ws
                    
                    ws.onmessage = (event) => {
                        const data = JSON.parse(event.data)
                        console.log('📩 WebSocket message:', data)
                        
                        if (data.event === 'cell_output') {
                            setMessages(prev => [...prev, data.message])
                            
                            if (data.progress) {
                                setProgress(data.progress)
                            }
                        } else if (data.event === 'mapping_approval_required') {
                            setMappingsSuggested(data.mappings_suggested || [])
                            setMappingsNonSuggested(data.mappings_non_suggested || [])
                            setBpmn_activities(data.bpmn_activities || [])
                            setLog_activities(data.log_activities || [])
                            setShowMappingModal(true)
                        } else if (data.event === 'completed') {
                            setIsAnalyzing(false)
                            setAnalysisStatus('completed')
                            setProgress(null)
                            setMessages(prev => [...prev, '✅ Analysis completed successfully!'])
                            intentionalCloseRef.current = true
                            setMessages(prev => [...prev, '🔌Closing connection...'])
                            ws.close()
                        } else if (data.event === 'error') {
                            setShowMappingModal(false)
                            setIsAnalyzing(false)
                            setIsStopping(false)
                            setAnalysisStatus('failed')
                            setProgress(null)
                            setMessages(prev => [...prev, data.message])
                            intentionalCloseRef.current = true
                            setMessages(prev => [...prev, '🔌Closing connection...'])
                            ws.close()
                        } else if (data.event === 'cancelled') {
                            setIsAnalyzing(false)
                            setIsStopping(false)
                            setAnalysisStatus('cancelled')
                            setProgress(null)
                            setMessages(prev => [...prev, data.message])
                        }
                    }

                    ws.onclose = () => {
                        console.log('🔌 WebSocket connection closed')
                        if (!intentionalCloseRef.current && isAnalyzingRef.current) {
                            setMessages(prev => [...prev, '🔌 Connection lost, analysis may still be running...'])
                        }
                    }
                    
                    return
                } catch (error) {
                    retries++
                    console.log(`🔄 Connection attempt ${retries}/${maxRetries} failed, retrying in ${retries}s...`)
                    setMessages(prev => [...prev, `🔄 Connecting to server... (attempt ${retries}/${maxRetries})`])
                    
                    if (retries < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, retries * 1000))
                    } else {
                        setMessages(prev => [...prev, '❌ Failed to connect after multiple attempts'])
                        setIsAnalyzing(false)
                        setAnalysisStatus('failed')
                    }
                }
            }
        }
        
        setTimeout(connectWithRetry, 1000)
        
        return () => {
            if (socketRef.current) {
                socketRef.current.close()
            }
        }
    }, [jobId, isAnalyzing])

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    const handleStopAnalysis = async () => {
        if (!isAnalyzing) {
            onStopAnalysis()
            onClose()
            return
        }

        try {
            setIsStopping(true)
            setMessages(prev => [...prev, '🛑 Stop requested, cancelling pipeline...'])

            const response = await fetch(`${HTTP_BACKEND_URL}/cancel/${jobId}`, {
                method: 'POST',
            })

            if (!response.ok) {
                const data = await response.json().catch(() => ({}))
                throw new Error(data?.error || data?.message || `Cancel failed (${response.status})`)
            }

            // Fallback: poll status in case a websocket "cancelled" event is missed.
            for (let i = 0; i < 30; i++) {
                await sleep(500)

                const statusResponse = await fetch(`${HTTP_BACKEND_URL}/status/${jobId}`)
                if (!statusResponse.ok) {
                    continue
                }

                const statusData = await statusResponse.json()
                const status = statusData?.status

                if (status === 'cancelled') {
                    setIsAnalyzing(false)
                    setIsStopping(false)
                    setAnalysisStatus('cancelled')
                    setProgress(null)
                    return
                }

                if (status === 'failed') {
                    setIsAnalyzing(false)
                    setIsStopping(false)
                    setAnalysisStatus('failed')
                    setProgress(null)
                    return
                }

                if (status === 'completed') {
                    setIsAnalyzing(false)
                    setIsStopping(false)
                    setAnalysisStatus('completed')
                    setProgress(null)
                    return
                }
            }

            setIsStopping(false)
            setMessages(prev => [
                ...prev,
                '⚠️ Cancellation requested, waiting for backend to acknowledge...',
            ])
        } catch (error) {
            setIsStopping(false)
            setMessages(prev => [
                ...prev,
                `❌ Failed to cancel pipeline: ${error instanceof Error ? error.message : String(error)}`,
            ])
        }
    }

    const handleCreateVisualization = () => {
        if (analysisStatus === 'completed') {
            setShowVariableModal(true)
        }
    }

    const handleVariablesReceived = (variables: AnalysisVariables) => {
        setShowVariableModal(false)
        const variablesWithMappings = {
            ...variables,
            applied_mappings: appliedMappings
        }
        onAnalysisComplete(variablesWithMappings)
        onClose()
    }

    const handleCloseVariableModal = () => {
        setShowVariableModal(false)
    }

    const handleMappingContinue = async (mappings: Array<{ log: string, model: string }>) => {
        try {
            // Normalize "No Label" back to empty strings before sending to backend
            const normalizedMappings = mappings.map(mapping => ({
                log: mapping.log === "No Label" ? "" : mapping.log,
                model: mapping.model === "No Label" ? "" : mapping.model
            }))
            
            setAppliedMappings(normalizedMappings)
            
            const response = await fetch(`${HTTP_BACKEND_URL}/confirm-mappings/${jobId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ mappings: normalizedMappings })
            })

            if (response.ok) {
                setShowMappingModal(false)
                setMessages(prev => [...prev, `✅ Mappings confirmed (${mappings.length} mappings), continuing analysis...`])
            } else {
                const error = await response.json()
                setShowMappingModal(false)
                setIsAnalyzing(false)
                setIsStopping(false)
                setAnalysisStatus('failed')
                setProgress(null)
                setMessages(prev => [...prev, `❌ Failed to confirm mappings: ${error.error || 'Unknown error'}`])
                intentionalCloseRef.current = true
                socketRef.current?.close()
            }
        } catch (error) {
            console.error('Error confirming mappings:', error)
            setShowMappingModal(false)
            setIsAnalyzing(false)
            setIsStopping(false)
            setAnalysisStatus('failed')
            setProgress(null)
            setMessages(prev => [...prev, `❌ Failed to confirm mappings: ${error}`])
            intentionalCloseRef.current = true
            socketRef.current?.close()
        }
    }

    const handleOverlayClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose()
        }
    }
    const canStopAnalysis = isAnalyzing && analysisStatus === 'running'

    return (
        <div 
            className="absolute z-99 flex-1 w-full h-full bg-black/50 flex items-center justify-center"
            onClick={handleOverlayClick}
        >
            <Card className="h-[80%] w-[60%] py-0 flex flex-col gap-y-0 bg-[#D8D8D8] border-[#808080]">
                <div className="px-6 pt-2 pb-6 pt-6 rounded-t-lg bg-[#D8D8D8] border-b border-[#808080]">
                    <h1 className="text-3xl font-semibold">{t('conformance.title')}</h1>
                </div>
                
                <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex-1 overflow-y-auto p-4 bg-[#f0f0f0] relative" style={{ scrollbarWidth: 'thin', scrollbarColor: '#808080 #D8D8D8' }}>
                        <div className="space-y-2">
                            {messages.filter(msg => !msg.startsWith('📊 Display:')).map((message, index) => (
                                <div key={index} className="bg-background border-1 border-[#808080] rounded-lg p-3 shadow-sm">
                                    <pre className="text-sm whitespace-pre-wrap font-mono text-gray-800">
                                        {message}
                                    </pre>
                                </div>
                            ))}
                            {messages.length === 0 && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div role="status">
                                        <svg aria-hidden="true" className="w-8 h-8 text-gray-200 animate-spin dark:text-gray-600 fill-primary dark:fill-background" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/>
                                            <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/>
                                        </svg>
                                        <span className="sr-only">({t('conformance.connecting')})</span>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>
                    </div>

                    {progress && (
                        <div className="px-4 py-2 border-t border-[#808080] bg-[#f0f0f0]">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm text-gray-600">
                                    {t('conformance.progressCell', { current: progress.current_cell, total: progress.total_cells })}
                                </span>
                                <span className="text-sm font-medium text-gray-800">
                                    {progress.percentage}%
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                                <div 
                                    className={`h-2 rounded-full transition-all duration-500 ease-out ${
                                        progress.percentage >= 100 ? 'bg-green-500' : 'bg-blue-500'
                                    }`}
                                    style={{ width: `${progress.percentage}%` }}
                                ></div>
                            </div>
                        </div>
                    )}

                    <div className="p-4 py-8 border-t bg-[#d8d8d8] border-t border-[#808080] flex justify-between items-center rounded-b-lg">
                        <div className="flex items-center gap-2">
                            {isAnalyzing ? (
                                <>
                                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                                    <span className="text-sm text-gray-600">{t('conformance.progress')}</span>
                                </>
                            ) : analysisStatus === 'completed' ? (
                                <>
                                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                    <span className="text-sm text-green-600">{t('conformance.complete')}</span>
                                </>
                            ) : analysisStatus === 'cancelled' ? (
                                <>
                                    <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
                                    <span className="text-sm text-amber-700">Cancelled</span>
                                </>
                            ) : (
                                <>
                                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                                    <span className="text-sm text-red-600">{t('conformance.failed')}</span>
                                </>
                            )}
                        </div>
                        
                        <div className="flex flex-row gap-x-2">
                            {analysisStatus === 'completed' && <div 
                                className="bg-primary hover:bg-primary/90 cursor-pointer px-3 py-2 rounded-md flex items-center gap-2"
                                onClick={handleCreateVisualization}
                            >
                                <CircleCheck size={18} className="text-white"/>
                                <span className="text-white text-sm font-medium">
                                    {t('conformance.create')}
                                </span>
                            </div>}
                            <div 
                                className={`px-3 py-2 rounded-md flex items-center gap-2 transition-colors ${
                                    canStopAnalysis && isStopping
                                        ? 'bg-red-400 cursor-not-allowed'
                                        : 'bg-red-600 hover:bg-red-500 cursor-pointer'
                                }`}
                                onClick={handleStopAnalysis}
                            >
                                {canStopAnalysis ? <CircleStop size={18} className="text-white"/> : <CircleX size={18} className="text-white"/>}
                                <span className="text-white text-sm font-medium">
                                    {canStopAnalysis ? (isStopping ? 'Stopping...' : t('conformance.stop')) : t('conformance.close')}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </Card>

            {showVariableModal && (
                <VariableRetrievalModal 
                    jobId={jobId}
                    onClose={handleCloseVariableModal}
                    onVariablesReceived={handleVariablesReceived}
                />
            )}

            {showMappingModal && (
                <MappingApprovalModal 
                    mappingsSuggested={mappingsSuggested}
                    mappingsNonSuggested={mappingsNonSuggested}
                    bpmn_activities={bpmn_activities}
                    log_activities={log_activities}
                    onContinue={handleMappingContinue}
                />
            )}
        </div>
    )
}  
