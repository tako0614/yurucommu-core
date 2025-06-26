import './App.css'
import { createSignal, For } from 'solid-js'

interface TestResult {
  success: boolean
  message: string
  data?: Record<string, unknown>
  error?: string
  timestamp: number
}

function App() {
  const [activeTab, setActiveTab] = createSignal('activitypub')
  const [logs, setLogs] = createSignal<string[]>([])
  const [isLoading, setIsLoading] = createSignal(false)

  // API Test Results
  const [activityPubResults, setActivityPubResults] = createSignal<TestResult | null>(null)
  const [kvResults, setKvResults] = createSignal<TestResult | null>(null)
  const [cdnResults, setCdnResults] = createSignal<TestResult | null>(null)
  const [eventsResults, setEventsResults] = createSignal<TestResult | null>(null)
  const [extensionsResults, setExtensionsResults] = createSignal<TestResult | null>(null)

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`])
  }

  const testActivityPub = async () => {
    setIsLoading(true)
    addLog('ActivityPub APIテストを開始しています...')
    
    try {
      // ActivityPub APIテストの実装
      const response = await fetch('/api/test/activitypub', { method: 'POST' })
      const result = await response.json()
      setActivityPubResults(result)
      addLog('ActivityPub APIテスト完了')
    } catch (error) {
      addLog(`ActivityPub APIテストでエラーが発生: ${error}`)
    }
    
    setIsLoading(false)
  }

  const testKV = async () => {
    setIsLoading(true)
    addLog('KV Storage APIテストを開始しています...')
    
    try {
      const response = await fetch('/api/test/kv', { method: 'POST' })
      const result = await response.json()
      setKvResults(result)
      addLog('KV Storage APIテスト完了')
    } catch (error) {
      addLog(`KV Storage APIテストでエラーが発生: ${error}`)
    }
    
    setIsLoading(false)
  }

  const testCDN = async () => {
    setIsLoading(true)
    addLog('CDN APIテストを開始しています...')
    
    try {
      const response = await fetch('/api/test/cdn', { method: 'POST' })
      const result = await response.json()
      setCdnResults(result)
      addLog('CDN APIテスト完了')
    } catch (error) {
      addLog(`CDN APIテストでエラーが発生: ${error}`)
    }
    
    setIsLoading(false)
  }

  const testEvents = async () => {
    setIsLoading(true)
    addLog('Events APIテストを開始しています...')
    
    try {
      const response = await fetch('/api/test/events', { method: 'POST' })
      const result = await response.json()
      setEventsResults(result)
      addLog('Events APIテスト完了')
    } catch (error) {
      addLog(`Events APIテストでエラーが発生: ${error}`)
    }
    
    setIsLoading(false)
  }

  const testExtensions = async () => {
    setIsLoading(true)
    addLog('Extensions APIテストを開始しています...')
    
    try {
      const response = await fetch('/api/test/extensions', { method: 'POST' })
      const result = await response.json()
      setExtensionsResults(result)
      addLog('Extensions APIテスト完了')
    } catch (error) {
      addLog(`Extensions APIテストでエラーが発生: ${error}`)
    }
    
    setIsLoading(false)
  }

  const runAllTests = async () => {
    await testActivityPub()
    await testKV()
    await testCDN()
    await testEvents()
    await testExtensions()
  }

  return (
    <div class="app">
      <header class="header">
        <h1>Takos API Test Extension</h1>
        <p>すべてのTakos APIの包括的テストツール</p>
      </header>

      <nav class="nav-tabs">
        <button 
          type="button"
          class={activeTab() === 'activitypub' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('activitypub')}
        >
          ActivityPub
        </button>
        <button 
          type="button"
          class={activeTab() === 'kv' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('kv')}
        >
          KV Storage
        </button>
        <button 
          type="button"
          class={activeTab() === 'cdn' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('cdn')}
        >
          CDN
        </button>
        <button 
          type="button"
          class={activeTab() === 'events' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('events')}
        >
          Events
        </button>
        <button 
          type="button"
          class={activeTab() === 'extensions' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('extensions')}
        >
          Extensions
        </button>
      </nav>

      <main class="main-content">
        <div class="controls">
          <button 
            type="button"
            onClick={runAllTests} 
            disabled={isLoading()}
            class="btn btn-primary"
          >
            {isLoading() ? 'テスト実行中...' : 'すべてのテストを実行'}
          </button>
          <button type="button" onClick={() => setLogs([])} class="btn btn-secondary">
            ログをクリア
          </button>
        </div>

        <div class="content-area">
          <div class="test-results">
            {activeTab() === 'activitypub' && (
              <div class="test-section">
                <h2>ActivityPub API テスト</h2>
                <button type="button" onClick={testActivityPub} disabled={isLoading()} class="btn">
                  ActivityPubテストを実行
                </button>
                <div class="results">
                  <pre>{JSON.stringify(activityPubResults(), null, 2)}</pre>
                </div>
              </div>
            )}

            {activeTab() === 'kv' && (
              <div class="test-section">
                <h2>KV Storage API テスト</h2>
                <button type="button" onClick={testKV} disabled={isLoading()} class="btn">
                  KVテストを実行
                </button>
                <div class="results">
                  <pre>{JSON.stringify(kvResults(), null, 2)}</pre>
                </div>
              </div>
            )}

            {activeTab() === 'cdn' && (
              <div class="test-section">
                <h2>CDN API テスト</h2>
                <button type="button" onClick={testCDN} disabled={isLoading()} class="btn">
                  CDNテストを実行
                </button>
                <div class="results">
                  <pre>{JSON.stringify(cdnResults(), null, 2)}</pre>
                </div>
              </div>
            )}

            {activeTab() === 'events' && (
              <div class="test-section">
                <h2>Events API テスト</h2>
                <button type="button" onClick={testEvents} disabled={isLoading()} class="btn">
                  Eventsテストを実行
                </button>
                <div class="results">
                  <pre>{JSON.stringify(eventsResults(), null, 2)}</pre>
                </div>
              </div>
            )}

            {activeTab() === 'extensions' && (
              <div class="test-section">
                <h2>Extensions API テスト</h2>
                <button type="button" onClick={testExtensions} disabled={isLoading()} class="btn">
                  Extensionsテストを実行
                </button>
                <div class="results">
                  <pre>{JSON.stringify(extensionsResults(), null, 2)}</pre>
                </div>
              </div>
            )}
          </div>

          <div class="logs-section">
            <h3>ログ</h3>
            <div class="logs">
              <For each={logs()}>
                {(log) => <div class="log-entry">{log}</div>}
              </For>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
