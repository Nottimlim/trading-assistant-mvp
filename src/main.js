const { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const MatchTraderOCR = require('./ocr/MatchTraderOCR');
const TradingEngine = require('./trading/TradingEngine');
const Store = require('electron-store');

class TradingAssistant {
  constructor() {
    this.store = new Store({ encryptionKey: 'trading-discipline-key' });  // Secure local persistence
    this.mainWindow = null;
    this.overlayWindow = null;
    this.settingsWindow = null;
    this.lockoutOverlay = null;  // New: Red lockout overlay
    this.tray = null;
    this.isMonitoring = false;
    this.isLocked = this.store.get('isLocked', false);
    this.lockEndTime = this.store.get('lockEndTime', 0);
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
    
    this.rules = this.store.get('rules', {
      maxTrades: 2,
      riskPercent: 1,
      timeoutMinutes: 15
    });
  }

  async createMainWindow() {
    this.mainWindow = new BrowserWindow({
      width: 250,
      height: 280,  // Increased for button/log visibility
      x: screen.getPrimaryDisplay().workAreaSize.width - 270,
      y: 20,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true
      },
      vibrancy: 'dark'
    });

    await this.mainWindow.loadFile('src/renderer/index.html');
    
    this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
    
    if (process.argv.includes('--dev')) {
      this.mainWindow.webContents.openDevTools();
    }

    this.mainWindow.on('closed', () => this.mainWindow = null);
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

  createSettingsWindow() {
    this.settingsWindow = new BrowserWindow({
      width: 300,
      height: 250,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    this.settingsWindow.loadFile('src/renderer/settings.html');
    this.settingsWindow.webContents.on('did-finish-load', () => {
      this.settingsWindow.webContents.send('load-rules', this.rules);  // Send persisted rules
    });
    this.settingsWindow.on('closed', () => this.settingsWindow = null);
  }

  createTray() {
    try {
      // Try custom icon if exists
      this.tray = new Tray(path.join(__dirname, 'icon.png'));
    } catch (error) {
      console.warn('Custom icon not found - using fallback placeholder');
      // Fallback: Code-generated simple circle icon
      const buffer = Buffer.from(
        `<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="7" fill="#4CAF50" stroke="#FFFFFF" stroke-width="1"/></svg>`,
        'utf-8'
      );
      const image = nativeImage.createFromBuffer(buffer, { width: 16, height: 16 });
      this.tray = new Tray(image);
    }
    
    const menu = Menu.buildFromTemplate([
      { label: 'Account', click: () => console.log('Account placeholder') },
      { label: 'Contact', click: () => console.log('Contact placeholder') },
      { label: 'Settings', click: () => {
        if (!this.settingsWindow) this.createSettingsWindow();
        this.settingsWindow.show();
      } },
      { label: 'Quit', click: () => app.quit() }
    ]);
    this.tray.setToolTip('Trading Discipline Tool');
    this.tray.setContextMenu(menu);
  }

  createLockoutOverlay() {
    this.lockoutOverlay = new BrowserWindow({
      width: 800,  // Initial size; will track browser
      height: 600,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    this.lockoutOverlay.loadFile('src/renderer/lockout.html');
    this.lockoutOverlay.setIgnoreMouseEvents(true, { forward: true });  // Click-through but visible
    this.lockoutOverlay.on('closed', () => this.lockoutOverlay = null);
  }

  async startScreenMonitoring() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    console.log('🎯 Starting MatchTrader monitoring...');
    
    try {
      await this.ocrEngine.initialize();
      
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
        thumbnailSize: {
          width: 1920,
          height: 1080
        }
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
    
    ipcMain.on('close-settings', () => {
      if (this.settingsWindow) this.settingsWindow.close();
    });
    
    ipcMain.on('toggle-overlay', () => {
      if (this.mainWindow.isVisible()) {
        this.mainWindow.hide();
      } else {
        this.mainWindow.show();
      }
    });
    
    ipcMain.on('start-session', (event, startingBalance) => {
      if (startingBalance > 0) {
        this.tradingEngine.startSession(startingBalance);
        console.log('🚀 Manual session started with balance:', startingBalance);
        this.mainWindow.webContents.send('session-started', startingBalance);
      } else {
        console.warn('⚠️ Invalid starting balance');
      }
    });
    
    ipcMain.on('enable-interaction', () => {
      this.mainWindow.setIgnoreMouseEvents(false);
    });
    
    ipcMain.on('disable-interaction', () => {
      this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
    });
    
    ipcMain.on('open-settings', () => {
      if (!this.settingsWindow) this.createSettingsWindow();
      this.settingsWindow.show();
    });
  }

  startTimeoutPeriod() {
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
    if (this.tray) this.tray.destroy();
  }
}

// App lifecycle
const tradingAssistant = new TradingAssistant();

app.whenReady().then(async () => {
  await tradingAssistant.createMainWindow();
  tradingAssistant.createOverlayWindow();
  tradingAssistant.createTray();
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
  
  // Cmd+T to toggle overlay visibility
  globalShortcut.register('CommandOrControl+T', () => {
    if (tradingAssistant.mainWindow.isVisible()) {
      tradingAssistant.mainWindow.hide();
    } else {
      tradingAssistant.mainWindow.show();
    }
    console.log('Overlay toggled');
  });
});

app.on('window-all-closed', () => {
  // Don't quit on macOS (tray persists)
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