import { useState, useRef, useEffect } from 'react'
import { Button } from './components/ui/button'
import { FaFileCode, FaFileLines } from "react-icons/fa6";
import { BpmnViewer } from './components/bpmn-viewer'
import { BpmnAlignmentsViewer } from './components/bpmn-alignments-viewer'
import { AnalysisModal } from './components/analysis-modal'
import type { AnalysisVariables } from './types/analysis-backend'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BpmnFrequencyViewer } from './components/bpmn-frequency-viewer'
import { useTranslation } from 'react-i18next'
import { CountryDropdown } from './components/ui/country-dropdown'
import { FilesUpload } from './components/files-upload';
import { BpmnPerformanceViewer } from './components/bpmn-performance-viewer';
import { Toaster } from 'react-hot-toast';
import { createDeviationActivitySizeProfile } from './utils/bpmn-viewer-deviations';
import type { DeviationActivitySizeProfile } from './types/analysis-frontend';

function App() {
  const { t, i18n } = useTranslation()
  const [showModel, setShowModel] = useState(false)
  const [modelFileName, setModelFileName] = useState<string | null>(null)
  const [logFileName, setLogFileName] = useState<string | null>(null)
  const [modelContent, setModelContent] = useState<string | null>(null)
  const [logContent, setLogContent] = useState<string | null>(null)
  const [modelFileSize, setModelFileSize] = useState<number | null>(null)
  const [modelProgress, setModelProgress] = useState<number | null>(null)
  const [logProgress, setLogProgress] = useState<number | null>(null)
  const [jobId, setJobId] = useState<string>('')
  const [isConnected, setIsConnected] = useState(false)
  const [analysisVariables, setAnalysisVariables] = useState<AnalysisVariables | null>(null)
  const [deviationSizeProfile, setDeviationSizeProfile] = useState<DeviationActivitySizeProfile | null>(null)
  const [language, setLanguage] = useState<string>(i18n.language || 'en')
  const [tabsKey, setTabsKey] = useState<number>(0)
  const [activeTab, setActiveTab] = useState<string>('original')

  const modelInputRef = useRef<HTMLInputElement | null>(null)
  const logInputRef = useRef<HTMLInputElement | null>(null)

  const HTTP_BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000') as string

  useEffect(() => {
    const connectToServer = async () => {
      try {
        const response = await fetch(`${HTTP_BACKEND_URL}/server/connect`)
        const data = await response.json()
        if (data.status === 'connected') {
          setIsConnected(true)
          console.log('✅ Connected to backend server:', data.message)
        }
      } catch (error) {
        console.error('❌ Failed to connect to backend server:', error)
        setIsConnected(false)
      }
    }

    connectToServer()
  }, [])

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const handleRemoveModel = () => {
    setModelFileName(null)
    setModelContent(null)
    setModelFileSize(null)
    setModelProgress(null)
    setAnalysisVariables(null)
    setDeviationSizeProfile(null)
    setTabsKey(prev => prev + 1)
    setActiveTab('original')
    if (modelInputRef.current) modelInputRef.current.value = ''
  }

  const handleRemoveLog = () => {
    setLogFileName(null)
    setLogContent(null)
    setLogProgress(null)
    setAnalysisVariables(null)
    setDeviationSizeProfile(null)
    setTabsKey(prev => prev + 1)
    setActiveTab('original')
    if (logInputRef.current) logInputRef.current.value = ''
  }

  const handleStartAnalysis = async () => {
    if (!isConnected) {
      console.error('❌ Not connected to backend server')
      return
    }

    if (!modelContent || !logContent || !modelFileName || !logFileName) {
      console.error('❌ Both model and log files are required')
      return
    }

    setAnalysisVariables(null)
    setDeviationSizeProfile(null)
    setTabsKey(prev => prev + 1)
    setActiveTab('original')

    setShowModel(true)
    setJobId('initializing')

    try {
      const formData = new FormData()
      
      const bpmnBlob = new Blob([modelContent], { type: 'application/xml' })
      const logBlob = new Blob([logContent], { type: 'application/xml' })
      
      formData.append('bpmn_file', bpmnBlob, modelFileName)
      formData.append('xes_file', logBlob, logFileName)

      console.log('📤 Uploading files...')
      const uploadResponse = await fetch(`${HTTP_BACKEND_URL}/upload`, {
        method: 'POST',
        body: formData
      })

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`)
      }

      const uploadData = await uploadResponse.json()
      console.log('✅ Files uploaded successfully:', uploadData)

      const analysisFormData = new FormData()
      analysisFormData.append('bpmn_path', uploadData.bpmn_path)
      analysisFormData.append('xes_path', uploadData.xes_path)

      console.log('🚀 Starting analysis with uploaded files...')
      const analysisResponse = await fetch(`${HTTP_BACKEND_URL}/run`, {
        method: 'POST',
        body: analysisFormData
      })

      if (!analysisResponse.ok) {
        throw new Error(`Analysis start failed: ${analysisResponse.statusText}`)
      }

      const analysisData = await analysisResponse.json()
      console.log('✅ Analysis started:', analysisData)
      
      setJobId(analysisData.job_id)
    } catch (error) {
      console.error('❌ Failed to start analysis:', error)
      alert(`Failed to start analysis: ${error instanceof Error ? error.message : 'Unknown error'}`)
      setShowModel(false)
      setJobId('')
    }
  }

  const handleStopAnalysis = () => {
    setJobId('')
  }

  const handleAnalysisComplete = (variables: AnalysisVariables) => {
    // Compute the BPMN-derived deviation sizing profile before any augmented viewer renders.
    const nextDeviationSizeProfile = createDeviationActivitySizeProfile(modelContent)
    setDeviationSizeProfile(nextDeviationSizeProfile)
    setAnalysisVariables(variables)
    setActiveTab('conformance')
    console.log('📊 Analysis variables received:', variables)
  }

  return (
    <div className="h-screen bg-background w-full flex flex-col items-center justify-center p-2">
      <Toaster />
      <div className='w-full h-full rounded-lg border border-[#808080]'>
        <div className="px-4 h-20 bg-[#D8D8D8] flex flex-row justify-center items-center gap-x-5 rounded-t-lg border-b border-[#808080]">
          <div className="absolute right-10 flex items-center gap-x-2 bg-background rounded-lg border border-[#808080] px-3 py-1">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className={`text-sm ${isConnected ? 'text-green-600' : 'text-red-600'}`}>
              {isConnected ? t('app.connected') : t('app.disconnected')}
            </span>
          </div>
          <div className="absolute left-10 flex items-center bg-background rounded-lg border border-[#808080]">
            <CountryDropdown
              defaultValue={language === 'en' ? 'GBR' : 'PRT'}
              onChange={(country) => {
                const newLang = country.alpha2 === 'PT' ? 'pt' : 'en'
                setLanguage(newLang)
                i18n.changeLanguage(newLang)
                localStorage.setItem('lang', newLang)
              }}
            />
          </div>
          <FilesUpload
            icon={<FaFileCode size={40} className='text-[#666666]' />}
            title={t('upload.bpmnModelFile')}
            btnText={t('upload.uploadModel')}
            onUploadClick={() => modelInputRef.current?.click()}
            fileName={modelFileName}
            onRemove={handleRemoveModel}
            trashTooltip={t('upload.removeModelTooltip') || 'Remove Model'}
            isUploading={modelProgress !== null}
          />
          <input
            ref={modelInputRef}
            type="file"
            accept=".bpmn,application/xml,text/xml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setModelFileName(file.name);
              setModelFileSize(file.size);
              setModelProgress(0);
              setAnalysisVariables(null);
              setDeviationSizeProfile(null);
              setTabsKey(prev => prev + 1);
              setActiveTab('original');
              const reader = new FileReader();
              reader.onprogress = (ev) => {
                if (ev.lengthComputable)
                  setModelProgress(Math.round((ev.loaded / ev.total) * 100));
              };
              reader.onload = () => setModelContent(String(reader.result ?? ''));
              reader.onloadend = () => setModelProgress(100);
              reader.readAsText(file);
            }}
          />
          <div className='h-[80%] bg-[#808080] w-[1px]'/>
          <FilesUpload
            icon={<FaFileLines size={40} className='text-[#666666]' />}
            title={t('upload.logFile')}
            btnText={t('upload.uploadLog')}
            onUploadClick={() => logInputRef.current?.click()}
            fileName={logFileName}
            onRemove={handleRemoveLog}
            trashTooltip={t('upload.removeLogTooltip') || 'Remove Log'}
            isUploading={logProgress !== null}
          />
          <input
            ref={logInputRef}
            type="file"
            accept=".xes,application/xml,text/xml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;

              const allowedTypes = [
                'application/xml',
                'text/xml',
                'application/xes+xml'
              ];
              const allowedExtensions = ['.xes', '.xml'];
              const fileName = file.name.toLowerCase();
              const isValidType =
                allowedTypes.includes(file.type) ||
                allowedExtensions.some(ext => fileName.endsWith(ext));
              if (!isValidType) {
                alert('Invalid file type. Please upload a .xes or XML file.');
                return;
              }

              const maxSize = 10 * 1024 * 1024;
              if (file.size > maxSize) {
                alert('File is too large. Maximum allowed size is 10MB.');
                return;
              }

              setLogFileName(file.name);
              setLogProgress(0);
              setAnalysisVariables(null);
              setDeviationSizeProfile(null);
              setTabsKey(prev => prev + 1);
              setActiveTab('original');
              const reader = new FileReader();
              reader.onprogress = (ev) => {
                if (ev.lengthComputable)
                  setLogProgress(Math.round((ev.loaded / ev.total) * 100));
              };
              reader.onload = () => setLogContent(String(reader.result ?? ''));
              reader.onloadend = () => setLogProgress(100);
              reader.readAsText(file);
            }}
          />
          {analysisVariables == null ? (
            <Button 
              className='text-lg font-semibold cursor-pointer h-9 px-2 bg-[#f0f0f0] border-[#808080] shadow-none active:shadow-[inset_0_0px_8px_#979797] transition-shadow' variant={'outline'}
              disabled={!modelContent || !logContent || !isConnected}
              onClick={handleStartAnalysis}
            >
              {t('analysis.startAnalysis')}
            </Button>
          ) : 

          (() => {
            const percentage = ( analysisVariables.conformance_metrics.conformance_statistics.perfect_fitting_traces / analysisVariables.conformance_metrics.conformance_statistics.total_traces) * 100
            const size = 60;
            const strokeWidth = 10;
            const radius = (size - strokeWidth) / 2;
            const circumference = 2 * Math.PI * radius;

            const progress = percentage / 100;
            const strokeDashoffset = circumference * (1 - progress);

            return (
              <div className="flex flex-row justify-center items-center gap-6 gap-x-4">
                <div className='flex flex-row items-center justify-center gap-2'>
                  <div
                    className="relative flex items-center justify-center"
                    style={{ width: size, height: size }}
                  >
                    <svg
                      width={size}
                      height={size}
                      viewBox={`0 0 ${size} ${size}`}
                      style={{ transform: "rotate(-90deg)" }}
                    >
                      <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="none"
                        stroke="#fff"
                        strokeWidth={strokeWidth}
                      />

                      <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="none"
                        stroke="oklch(72.3% 0.219 149.579)"
                        strokeWidth={strokeWidth}
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                      />
                    </svg>

                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="text-sm font-bold text-primary select-none">
                        {percentage.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className='text-start'>
                    <h3 className='text-base font-medium mb-1'>{t('metrics.processQuality')}</h3>
                    <div className='flex flex-row gap-x-2'>
                      <p className='text-sm text-gray-800'>
                        {t('metrics.processQualityFittingTraces')} <span className='font-semibold text-green-500'>{analysisVariables.conformance_metrics.conformance_statistics.perfect_fitting_traces}</span>
                      </p>
                      <p className='text-sm text-gray-800'>
                        {t('metrics.processQualityAllTraces')} <span className='font-semibold text-primary'>{analysisVariables.conformance_metrics.conformance_statistics.total_traces}</span>
                      </p>
                    </div>
                  </div>
                </div>
                <div className='w-fit flex flex-col items-start justify-between bg-background rounded-lg border border-[#808080] py-1 px-2'>
                  <h3 className='text-sm font-medium'>{t('metrics.fitness')}</h3>
                  <p className='text-xs text-gray-500'>{t('metrics.fitnessDescription')}</p>
                  <span className='font-medium'>{(analysisVariables.conformance_metrics.conformance_profile.fitness * 100).toFixed(2)}%</span>
                </div>

                <div className='w-fit flex flex-col items-start justify-between bg-background rounded-lg border border-[#808080] py-1 px-2'>
                  <h3 className='text-sm font-medium'>{t('metrics.precision')}</h3>
                  <p className='text-xs text-gray-500'>{t('metrics.precisionDescription')}</p>
                  <span className='font-medium'>{(analysisVariables.conformance_metrics.conformance_profile.precision * 100).toFixed(2)}%</span>
                </div>

                <div className='w-fit flex flex-col items-start justify-between bg-background rounded-lg border border-[#808080] py-1 px-2'>
                  <h3 className='text-sm font-medium'>{t('metrics.generalization')}</h3>
                  <p className='text-xs text-gray-500'>{t('metrics.generalizationDescription')}</p>
                  <span className='font-medium'>{(analysisVariables.conformance_metrics.conformance_profile.generalization * 100).toFixed(2)}%</span>
                </div>

                <div className='w-fit flex flex-col items-start justify-between bg-background rounded-lg border border-[#808080] py-1 px-2'>
                  <h3 className='text-sm font-medium'>{t('metrics.simplicity')}</h3>
                  <p className='text-xs text-gray-500'>{t('metrics.simplicityDescription')}</p>
                  <span className='font-medium'>{(analysisVariables.conformance_metrics.conformance_profile.simplicity * 100).toFixed(2)}%</span>
                </div>
              </div>
          )})()}
        </div>
        <main className="flex-1 w-full h-[92%] pb-4">
          <div className="flex h-full gap-x-2">
            <div className="flex-1 flex w-full h-full flex-col gap-y-4">
              {modelContent ? (
                <Tabs key={tabsKey} value={activeTab} onValueChange={setActiveTab} className="flex-1 w-full overflow-hidden flex flex-col">
                  <div className="flex relative bg-[#f0f0f0] flex-row items-start justify-center py-3 border-b border-[#808080]">
                    <div className='absolute left-4 flex mt-[5px]'>
                      <TabsList className='bg-[#f0f0f0] flex items-end min-h-[36px] p-0'>
                        <TabsTrigger
                          className={`hover:cursor-pointer px-4 py-2 text-sm font-normal border border-b-0 border-[#b0b0b0] rounded-t-md rounded-b-none
                            data-[state=active]:bg-background data-[state=active]:font-semibold data-[state=active]:text-black
                            data-[state=inactive]:bg-[#f0f0f0] data-[state=inactive]:text-black data-[state=inactive]:font-normal
                            data-[state=inactive]:border-0 data-[state=inactive]:border-b-1 data-[state=inactive]:border-b-[#808080]`}
                          value="original"
                        >
                          {analysisVariables ? t('tabs.performance') : t('tabs.original')}
                        </TabsTrigger>
                        {analysisVariables && 
                        <>
                          <TabsTrigger
                            className={`hover:cursor-pointer px-4 py-2 text-sm font-normal border border-b-0 border-[#b0b0b0] rounded-t-md rounded-b-none
                              data-[state=active]:bg-background data-[state=active]:font-semibold data-[state=active]:text-black
                              data-[state=inactive]:bg-[#f0f0f0] data-[state=inactive]:text-black data-[state=inactive]:font-normal
                              data-[state=inactive]:border-0 data-[state=inactive]:border-b-1 data-[state=inactive]:border-b-[#808080]`}
                            value="conformance"
                            disabled={!analysisVariables}
                          >
                            {t('tabs.conformance')}
                          </TabsTrigger>
                          <TabsTrigger
                            className={`hover:cursor-pointer px-4 py-2 text-sm font-normal border border-b-0 border-[#b0b0b0] rounded-t-md rounded-b-none
                              data-[state=active]:bg-background data-[state=active]:font-semibold data-[state=active]:text-black
                              data-[state=inactive]:bg-[#f0f0f0] data-[state=inactive]:text-black data-[state=inactive]:font-normal
                              data-[state=inactive]:border-0 data-[state=inactive]:border-b-1 data-[state=inactive]:border-b-[#808080]`}
                            value="deviations"
                            disabled={!analysisVariables}
                          >
                            {t('tabs.frequency')}
                          </TabsTrigger>
                        </>}
                      </TabsList>
                    </div>
                    <h1 className="text-xl font-medium text-center">
                      {modelFileName || t('viewer.bpmnModel')} {modelFileSize ? `(${formatBytes(modelFileSize)})` : ''}
                    </h1>
                  </div>
                  <TabsContent value="original" className="flex-1 w-full overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
                    <div className="flex-1 w-full overflow-hidden">
                      {
                        analysisVariables ? (
                          <BpmnPerformanceViewer 
                            xml={modelContent} 
                            performance_metrics={analysisVariables.performance_metrics}
                            helper_variables={analysisVariables.helper_variables}
                            deviationSizeProfile={deviationSizeProfile ?? undefined}
                          />
                        ) :
                        <BpmnViewer xml={modelContent} />
                      }
                    </div>
                  </TabsContent>
                  <TabsContent value="conformance" className="flex-1 w-full overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
                    <div className="flex-1 w-full overflow-hidden">
                      {analysisVariables ? (
                        <BpmnAlignmentsViewer 
                          xml={modelContent} 
                          performance_metrics={analysisVariables.performance_metrics}
                          conformance_metrics={analysisVariables.conformance_metrics}
                          helper_variables={analysisVariables.helper_variables}
                          deviationSizeProfile={deviationSizeProfile ?? undefined}
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full text-gray-400">
                          <div className="text-center">
                            <span className="text-4xl mb-2 block">📊</span>
                            <p>{t('analysis.completeAnalysis')}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </TabsContent>
                  <TabsContent value="deviations" className="flex-1 w-full overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
                    <div className="flex-1 w-full overflow-hidden">
                      {analysisVariables ? (
                        <BpmnFrequencyViewer 
                          xml={modelContent} 
                          frequency_metrics={analysisVariables.frequency_metrics}
                          helper_variables={analysisVariables.helper_variables}
                          deviationSizeProfile={deviationSizeProfile ?? undefined}
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full text-gray-400">
                          <div className="text-center">
                            <span className="text-4xl mb-2 block">📊</span>
                            <p>{t('analysis.completeAnalysisDeviations')}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="flex-1 flex items-center justify-center text-zinc-400">
                  <div className="text-center">
                    <FaFileCode className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>{t('upload.noBpmnModel')}</p>
                    <p className="text-sm">{t('upload.uploadBpmnFile')}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {showModel && jobId && (
        <AnalysisModal 
          jobId={jobId} 
          onClose={() => setShowModel(false)} 
          onStopAnalysis={handleStopAnalysis}
          onAnalysisComplete={handleAnalysisComplete}
        />
      )}
    </div>
  )
}

export default App
