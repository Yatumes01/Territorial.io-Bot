import React, { useState, useEffect } from 'react';

const API_URL = '';

function App() {
  const [state, setState] = useState({
    running: false,
    currentStep: 'idle',
    stepTimer: 0,
    currentLoop: 0,
    totalLoops: 20,
    account: null,
    previewEnabled: false
  });
  const [screenshot, setScreenshot] = useState(null);

  useEffect(() => {
    const startBot = async () => {
      await fetch(`${API_URL}/api/start`, { method: 'POST' });
    };
    startBot();
  }, []);

  useEffect(() => {
    const fetchState = async () => {
      try {
        const res = await fetch(`${API_URL}/api/state`);
        const data = await res.json();
        setState(data);
      } catch (e) {}
    };

    const fetchScreenshot = async () => {
      if (state.previewEnabled) {
        try {
          const res = await fetch(`${API_URL}/api/screenshot`);
          const data = await res.json();
          if (data.screenshot) setScreenshot(data.screenshot);
        } catch (e) {}
      }
    };

    const stateInterval = setInterval(fetchState, 1000);
    const screenshotInterval = setInterval(fetchScreenshot, 10000);

    fetchState();

    return () => {
      clearInterval(stateInterval);
      clearInterval(screenshotInterval);
    };
  }, [state.previewEnabled]);

  const togglePreview = async () => {
    const newEnabled = !state.previewEnabled;
    await fetch(`${API_URL}/api/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newEnabled })
    });
  };

  const renderLoopProgress = () => {
    const dots = [];
    for (let i = 1; i <= 20; i++) {
      let className = 'loop-dot';
      if (i < state.currentLoop) className += ' completed';
      else if (i === state.currentLoop) className += ' current';
      dots.push(<div key={i} className={className}>{i}</div>);
    }
    return dots;
  };

  return (
    <div className="container">
      <h1>Territorial.io Bot</h1>

      <div className="status-card">
        <div className="status-row">
          <span className="label">Status</span>
          <span className={`value ${state.running ? 'running' : 'stopped'}`}>
            {state.running ? 'RUNNING' : 'STOPPED'}
          </span>
        </div>
        <div className="status-row">
          <span className="label">Current Step</span>
          <span className="value">{state.currentStep}</span>
        </div>
        <div className="status-row">
          <span className="label">Step Timer</span>
          <span className="timer">{state.stepTimer}s</span>
        </div>
        <div className="status-row">
          <span className="label">Loop Progress</span>
          <span className="value">{state.currentLoop} / {state.totalLoops}</span>
        </div>
      </div>

      <div className="loop-progress">
        {renderLoopProgress()}
      </div>

      {state.account && state.account.d105 && (
        <div className="status-card">
          <h3>Account Credentials</h3>
          <div className="status-row">
            <span className="label">Username (d105)</span>
            <span className="value">{state.account.d105}</span>
          </div>
          <div className="status-row">
            <span className="label">Password (d106)</span>
            <span className="value">{state.account.d106}</span>
          </div>
        </div>
      )}

      <div className="controls">
        <button 
          className="btn-preview" 
          onClick={togglePreview}
        >
          {state.previewEnabled ? 'Disable Preview' : 'Enable Preview'}
        </button>
      </div>

      <div className="preview-container">
        <h3>Bot Preview {state.previewEnabled ? '(Updates every 10s)' : '(Disabled)'}</h3>
        {state.previewEnabled && screenshot ? (
          <img 
            src={`data:image/jpeg;base64,${screenshot}`} 
            alt="Bot Preview" 
            className="preview-image"
          />
        ) : (
          <div className="no-preview">
            {state.previewEnabled 
              ? 'Waiting for screenshot...' 
              : 'Click "Enable Preview" to see bot activity'}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
