import type { AnalysisVariables } from "@/types/analysis-backend"
import { Card } from "./ui/card"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

interface VariableRetrievalModalProps {
    jobId: string
    onClose: () => void
    onVariablesReceived: (variables: AnalysisVariables) => void
}

export function VariableRetrievalModal({ jobId, onClose, onVariablesReceived }: VariableRetrievalModalProps) {
    const {t} = useTranslation()
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000') as string

    useEffect(() => {
        const fetchVariables = async () => {
            try {
                setIsLoading(true)
                setError(null)

                const response = await fetch(`${BACKEND_URL}/results/${jobId}`)
                
                if (!response.ok) {
                    const errorData = await response.json()
                    throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
                }

                const results = await response.json()
                console.log('📊 Analysis results retrieved:', results)

                onVariablesReceived(results)
                
                setTimeout(() => {
                    onClose()
                }, 1000)

            } catch (error) {
                console.error('❌ Error fetching variables:', error)
                setError(error instanceof Error ? error.message : 'Unknown error occurred')
                setIsLoading(false)
            }
        }

        fetchVariables()
    }, [jobId, onVariablesReceived, onClose])

    const handleOverlayClick = (e: React.MouseEvent) => {
        if (!isLoading && error) {
            if (e.target === e.currentTarget) {
                onClose()
            }
        }
    }

    return (
        <div 
            className="absolute z-99 flex-1 w-full h-full bg-black/50 flex items-center justify-center"
            onClick={handleOverlayClick}
        >
            <Card className="w-96 p-8">
                <div className="flex flex-col items-center space-y-4">
                    {isLoading ? (
                        <>
                            <div role="status">
                                <svg 
                                    aria-hidden="true" 
                                    className="w-12 h-12 text-gray-200 animate-spin fill-primary" 
                                    viewBox="0 0 100 101" 
                                    fill="none" 
                                    xmlns="http://www.w3.org/2000/svg"
                                >
                                    <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/>
                                    <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/>
                                </svg>
                                <span className="sr-only">{t('variables.retrieving')}...</span>
                            </div>
                            
                            <h3 className="text-lg font-semibold text-gray-800">{t('variables.retrieving')}</h3>
                            <p className="text-sm text-gray-600 text-center">
                                {t('variables.loading')}
                            </p>
                        </>
                    ) : error ? (
                        <>
                            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-semibold text-red-800">{t('variables.failed')}</h3>
                            <p className="text-sm text-red-600 text-center">
                                {error}
                            </p>
                            <button
                                onClick={onClose}
                                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                            >
                                ({t('variables.close')})
                            </button>
                        </>
                    ) : (
                        <>
                            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-semibold text-green-800">{t('variables.successVariables')}</h3>
                            <p className="text-sm text-green-600 text-center">
                                ({t('variables.success')})
                            </p>
                        </>
                    )}
                </div>
            </Card>
        </div>
    )
}
