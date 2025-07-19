const { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer } = require('electron');
const path = require('path');
const MatchTraderOCR = require('./ocr/MatchTraderOCR');
const TradingEngine = require('./trading/TradingEngine');

class TradingAssistant {
  constructor() {
    this.mainWindow = null;
    this.overlayWindow = null;
    this.isMonitoring = false;
    this.ocrEngine = new MatchTraderOCR();
    this.tradingEngine = new TradingEngine();
    this.monitoringInterval = null;
    this.lastScreenshot = null;
    
    // Legacy trading data structure for backward compatibility
    this.tradingData = {
      balance: 0,
      equity: 0,
      profit: 0,
      tradesCount: 0,
      lastBalance: 0
    };
    
    // Legacy rules structure
    this.rules = {
      maxTrades: 2,
      riskPercent: 1,
      timeoutMinutes: 15
    };
  }

  async createMainWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true
      },
      titleBarStyle: 'hiddenInset',
      vibrancy: 'dark'
    });

    await this.mainWindow.loadFile('src/renderer/index.html');
    
    if (process.argv.includes('--dev')) {
      this.mainWindow.webContents.openDevTools();
    }

    // Handle window closed
    this.mainWindow.on('closed', () => {
      this.cleanup();
    });
  }

  createOverlayWindow() {
    this.overlayWindow = new BrowserWindow({
      width: 500,
      height: 400,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      show: false
    });

    this.overlayWindow.loadFile('src/renderer/overlay.html');
    this.overlayWindow.setIgnoreMouseEvents(false);
  }

  async startScreenMonitoring() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    console.log('🎯 Starting MatchTrader monitoring...');
    
    try {
      // Initialize OCR engine
      await this.ocrEngine.initialize();
      
      // Get initial balance for session
      const initialData = await this.captureAndAnalyze();
      if (initialData && initialData.balance > 0) {
        this.tradingEngine.startSession(initialData.balance);
        
        // Update legacy structure
        this.tradingData.balance = initialData.balance;
        this.tradingData.equity = initialData.equity;
        this.tradingData.lastBalance = initialData.balance;
      }
      
      // Monitor every 3 seconds (balance between accuracy and performance)
      this.monitoringInterval = setInterval(async () => {
        if (this.isMonitoring) {
          await this.captureAndAnalyze();
        }
      }, 3000);
      
    } catch (error) {
      console.error('❌ Failed to start monitoring:', error);
      this.isMonitoring = false;
    }
  }

  async stopScreenMonitoring() {
    this.isMonitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    console.log('⏹️ Screen monitoring stopped');
  }

  async captureAndAnalyze() {
    try {
      // Capture MatchTrader window
      const screenshot = await this.captureMatchTraderWindow();
      
      if (!screenshot) {
        console.warn('⚠️ No screenshot captured');
        return null;
      }

      // Extract trading data using OCR
      const tradingData = await this.ocrEngine.extractTradingData(screenshot);
      
      if (tradingData.error) {
        console.error('❌ OCR extraction failed:', tradingData.error);
        return null;
      }

      // Update legacy structure for backward compatibility
      this.tradingData.balance = tradingData.balance;
      this.tradingData.equity = tradingData.equity;
      this.tradingData.profit = tradingData.profit;

      // Detect trades using new engine
      const detectedTrade = this.tradingEngine.detectTrade(tradingData);
      
      if (detectedTrade) {
        this.tradingData.tradesCount = this.tradingEngine.currentSession.tradesCount;
        this.tradingData.lastBalance = tradingData.balance;
        
        console.log('🎯 Trade detected:', detectedTrade);
        this.mainWindow.webContents.send('trade-detected', detectedTrade);
      }

      // Check for rule violations
      const violations = this.tradingEngine.checkRuleViolations();
      
      if (violations.length > 0) {
        this.handleRuleViolations(violations);
      }

      // Send updated data to UI
      const sessionStats = this.tradingEngine.getSessionStats();
      this.mainWindow.webContents.send('trading-data-update', {
        // Legacy format
        ...this.tradingData,
        // New format
        ...tradingData,
        ...sessionStats,
        violations: violations
      });

      return tradingData;

    } catch (error) {
      console.error('❌ Capture and analysis failed:', error);
      return null;
    }
  }

  async captureMatchTraderWindow() {
    try {
      // Use Electron's built-in screen capture
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: {
          width: 1920,
          height: 1080
        }
      });
      
      // Find MatchTrader window or use primary screen
      const matchTraderSource = sources.find(source => 
        source.name.toLowerCase().includes('mtr-platform') || 
        source.name.toLowerCase().includes('matchtrader') ||
        source.name.toLowerCase().includes('fundingpips') ||
        (source.name.toLowerCase().includes('chrome') && source.name.toLowerCase().includes('mtr')) ||
        (source.name.toLowerCase().includes('safari') && source.name.toLowerCase().includes('mtr')) ||
        source.name.toLowerCase().includes('chrome') ||
        source.name.toLowerCase().includes('safari')
      );
      
      const sourceToUse = matchTraderSource || sources.find(source => source.name === 'Entire Screen');
      
      if (sourceToUse) {
        console.log(`📸 Capturing: ${sourceToUse.name}`);
        this.lastScreenshot = sourceToUse.thumbnail.toPNG();
        return this.lastScreenshot;
      }
      
      return null;
    } catch (error) {
      console.error('Screenshot error:', error);
      return null;
    }
  }

  // Legacy method for backward compatibility
  async extractTradingData(screenshot) {
    return await this.ocrEngine.extractTradingData(screenshot);
  }

  // Legacy method for backward compatibility
  detectTrades(newData) {
    return this.tradingEngine.detectTrade(newData);
  }

  // Legacy method for backward compatibility
  checkRuleViolations() {
    return this.tradingEngine.checkRuleViolations();
  }

  handleRuleViolations(violations) {
    const criticalViolations = violations.filter(v => v.severity === 'critical');
    
    if (criticalViolations.length > 0) {
      this.triggerIntervention(criticalViolations[0]);
    }
  }

  triggerIntervention(violation) {
    console.log('🚨 INTERVENTION TRIGGERED:', violation.message);
    
    // Stop monitoring temporarily
    this.isMonitoring = false;
    
    // Show overlay
    this.showInterventionOverlay(violation);
    
    // Send to main window
    this.mainWindow.webContents.send('intervention-triggered', violation);
  }

  showInterventionOverlay(violation) {
    if (this.overlayWindow) {
      // Center on screen
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;
      this.overlayWindow.setPosition(
        Math.floor((width - 500) / 2),
        Math.floor((height - 400) / 2)
      );
      
      this.overlayWindow.show();
      this.overlayWindow.focus();
      
      // Send intervention data
      this.overlayWindow.webContents.send('show-intervention', {
        message: violation ? violation.message : `You've reached your ${this.rules.maxTrades} trade limit!`,
        type: violation ? violation.type : 'daily_limit_exceeded',
        timeoutMinutes: this.tradingEngine.rules.timeoutMinutes,
        tradesCount: this.tradingEngine.currentSession.tradesCount,
        sessionStats: this.tradingEngine.getSessionStats()
      });
    }
  }

  setupIPC() {
    // Handle messages from renderer process
    ipcMain.on('start-monitoring', async () => {
      await this.startScreenMonitoring();
    });

    ipcMain.on('stop-monitoring', () => {
      this.stopScreenMonitoring();
    });

    ipcMain.on('update-rules', (event, newRules) => {
      // Update both legacy and new structures
      this.rules = { ...this.rules, ...newRules };
      
      // Map to new engine format
      const engineRules = {
        maxTradesPerDay: newRules.maxTrades || this.rules.maxTrades,
        riskPercentage: newRules.riskPercent || this.rules.riskPercent,
        timeoutMinutes: newRules.timeoutMinutes || this.rules.timeoutMinutes
      };
      
      this.tradingEngine.updateRules(engineRules);
    });

    ipcMain.on('reset-trades', () => {
      this.tradingData.tradesCount = 0;
      this.tradingEngine.resetSession();
    });

    ipcMain.on('acknowledge-intervention', () => {
      this.overlayWindow.hide();
      this.startTimeoutPeriod();
    });

    // New IPC handlers for enhanced functionality
    ipcMain.on('test-screenshot', async () => {
      const screenshot = await this.captureMatchTraderWindow();
      if (screenshot) {
        const tradingData = await this.ocrEngine.extractTradingData(screenshot);
        this.mainWindow.webContents.send('test-results', tradingData);
      }
    });

    ipcMain.on('reset-session', () => {
      this.tradingEngine.resetSession();
      this.tradingData.tradesCount = 0;
    });

    ipcMain.on('calibrate-ocr', async (event, regions) => {
      if (this.lastScreenshot) {
        const results = await this.ocrEngine.calibrateRegions(this.lastScreenshot, regions);
        event.reply('calibration-results', results);
      }
    });
  }

  startTimeoutPeriod() {
    // Disable monitoring for timeout period
    this.isMonitoring = false;
    
    const timeoutMs = this.tradingEngine.rules.timeoutMinutes * 60 * 1000;
    console.log(`⏱️ Starting ${this.tradingEngine.rules.timeoutMinutes} minute timeout...`);
    
    setTimeout(() => {
      console.log('✅ Timeout period ended - monitoring can resume');
      this.mainWindow.webContents.send('timeout-ended');
    }, timeoutMs);
  }

  async cleanup() {
    this.stopScreenMonitoring();
    if (this.ocrEngine) {
      await this.ocrEngine.cleanup();
    }
  }
}

// App lifecycle
const tradingAssistant = new TradingAssistant();

app.whenReady().then(async () => {
  await tradingAssistant.createMainWindow();
  tradingAssistant.createOverlayWindow();
  tradingAssistant.setupIPC();

  // Global shortcuts
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (tradingAssistant.isMonitoring) {
      tradingAssistant.stopScreenMonitoring();
      console.log('Monitoring paused');
    } else {
      tradingAssistant.startScreenMonitoring();
      console.log('Monitoring started');
    }
  });

  // Quick screenshot test shortcut
  globalShortcut.register('CommandOrControl+Shift+S', async () => {
    console.log('📸 Taking quick screenshot test...');
    const screenshot = await tradingAssistant.captureMatchTraderWindow();
    if (screenshot) {
      const tradingData = await tradingAssistant.ocrEngine.extractTradingData(screenshot);
      console.log('📊 Quick test results:', tradingData);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await tradingAssistant.createMainWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', async () => {
  await tradingAssistant.cleanup();
});