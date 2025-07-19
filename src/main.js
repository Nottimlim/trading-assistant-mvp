const { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer } = require('electron');
const path = require('path');
const MatchTraderOCR = require('./ocr/MatchTraderOCR');
const TradingEngine = require('./trading/TradingEngine');

class TradingAssistant {
  constructor() {
    this.mainWindow = null;
    this.overlayWindow = null;
    this.isMonitoring = false;
    this.isInvisibleMode = false;  // New: Toggle for hidden dashboard
    this.ocrEngine = new MatchTraderOCR();
    this.tradingEngine = new TradingEngine();
    this.monitoringInterval = null;
    this.lastScreenshot = null;
    
    this.tradingData = {
      balance: 0,
      equity: 0,
      profit: 0,
      tradesCount: 0,
      lastBalance: 0
    };
    
    this.rules = {
      maxTrades: 2,
      riskPercent: 1,
      timeoutMinutes: 15
    };
  }

  async createMainWindow() {
    this.mainWindow = new BrowserWindow({
      width: 300,  // Smaller for floating overlay
      height: 200,
      frame: false,  // Frameless for clean overlay
      transparent: true,  // Enable transparency for glassmorphism
      alwaysOnTop: true,  // Float above all apps 
      resizable: false,  // Fixed size for minimal UI
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true
      },
      vibrancy: 'dark'  // macOS vibrancy for subtle blur
    });

    await this.mainWindow.loadFile('src/renderer/index.html');
    
    this.mainWindow.setIgnoreMouseEvents(true);  // Click-through for unobtrusive mode
    
    if (process.argv.includes('--dev')) {
      this.mainWindow.webContents.openDevTools({ mode: 'detach' });
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
    this.overlayWindow.setIgnoreMouseEvents(false);  // Interactive for acknowledgments
  }

  async startScreenMonitoring() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    console.log('🎯 Starting MatchTrader monitoring...');
    
    try {
      await this.ocrEngine.initialize();
      
      const initialData = await this.captureAndAnalyze();
      if (initialData && initialData.balance > 0) {
        this.tradingEngine.startSession(initialData.balance);
        
        this.tradingData.balance = initialData.balance;
        this.tradingData.equity = initialData.equity;
        this.tradingData.lastBalance = initialData.balance;
      }
      
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
      const screenshot = await this.captureMatchTraderWindow();
      
      if (!screenshot) {
        console.warn('⚠️ No screenshot captured');
        return null;
      }

      const tradingData = await this.ocrEngine.extractTradingData(screenshot);
      
      if (tradingData.error) {
        console.error('❌ OCR extraction failed:', tradingData.error);
        return null;
      }

      this.tradingData.balance = tradingData.balance;
      this.tradingData.equity = tradingData.equity;
      this.tradingData.profit = tradingData.profit;

      // Pass full tradingData (incl. hasOpenPositions) to detectTrade
      const detectedTrade = this.tradingEngine.detectTrade(tradingData);
      
      if (detectedTrade) {
        this.tradingData.tradesCount = this.tradingEngine.currentSession.tradesCount;
        this.tradingData.lastBalance = tradingData.balance;
        
        console.log('🎯 Trade detected:', detectedTrade);
        this.mainWindow.webContents.send('trade-detected', detectedTrade);
      }

      const violations = this.tradingEngine.checkRuleViolations();
      
      if (violations.length > 0) {
        this.handleRuleViolations(violations);
      }

      const sessionStats = this.tradingEngine.getSessionStats();
      this.mainWindow.webContents.send('trading-data-update', {
        ...this.tradingData,
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
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 1920, height: 1080 }
      });
      
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

  // Legacy methods preserved...

  handleRuleViolations(violations) {
    const criticalViolations = violations.filter(v => v.severity === 'critical');
    
    if (criticalViolations.length > 0) {
      this.triggerIntervention(criticalViolations[0]);
    }
  }

  triggerIntervention(violation) {
    console.log('🚨 INTERVENTION TRIGGERED:', violation.message);
    
    this.isMonitoring = false;
    
    this.showInterventionOverlay(violation);
    
    this.mainWindow.webContents.send('intervention-triggered', violation);
  }

  showInterventionOverlay(violation) {
    if (this.overlayWindow) {
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;
      this.overlayWindow.setPosition(
        Math.floor((width - 500) / 2),
        Math.floor((height - 400) / 2)
      );
      
      this.overlayWindow.show();
      this.overlayWindow.focus();
      
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
    // Existing handlers...
    
    // New: Toggle invisible mode for dashboard overlay
    ipcMain.on('toggle-invisible-mode', (event, isInvisible) => {
      this.isInvisibleMode = isInvisible;
      this.mainWindow.setOpacity(isInvisible ? 0 : 1);
      console.log(`👻 Invisible mode: ${isInvisible ? 'enabled' : 'disabled'}`);
    });
  }

  startTimeoutPeriod() {
    this.isMonitoring = false;
    
    const timeoutMs = this.tradingEngine.rules.timeoutMinutes * 60 * 1000;
    console.log(`⏱️ Starting ${this.tradingEngine.rules.timeoutMinutes} minute timeout...`);
    
    setTimeout(() => {
      console.log('✅ Timeout period ended - monitoring can resume');
      this.mainWindow.webContents.send('timeout-ended');
      this.overlayWindow.hide();  // Auto-hide after timeout
    }, timeoutMs);
  }

  async cleanup() {
    this.stopScreenMonitoring();
    if (this.ocrEngine) {
      await this.ocrEngine.cleanup();
    }
  }
}

// App lifecycle (unchanged, but ensure mainWindow is created as overlay)
const tradingAssistant = new TradingAssistant();

app.whenReady().then(async () => {
  await tradingAssistant.createMainWindow();
  tradingAssistant.createOverlayWindow();
  tradingAssistant.setupIPC();

  // Global shortcuts (unchanged)
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