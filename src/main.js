const { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer } = require('electron');
const path = require('path');

class TradingAssistant {
  constructor() {
    this.mainWindow = null;
    this.overlayWindow = null;
    this.isMonitoring = false;
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
  }

  createOverlayWindow() {
    this.overlayWindow = new BrowserWindow({
      width: 400,
      height: 300,
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
    this.isMonitoring = true;
    console.log('Starting MatchTrader monitoring...');
    
    // Monitor every 2 seconds
    setInterval(async () => {
      if (this.isMonitoring) {
        await this.captureAndAnalyze();
      }
    }, 2000);
  }

  async captureAndAnalyze() {
    try {
      // Capture screen
      const screenshot = await this.captureMatchTraderWindow();
      
      if (screenshot) {
        // Extract trading data using OCR
        const newData = await this.extractTradingData(screenshot);
        
        // Check for trades and rule violations
        this.detectTrades(newData);
        this.checkRuleViolations();
        
        // Update UI
        this.mainWindow.webContents.send('trading-data-update', this.tradingData);
      }
    } catch (error) {
      console.error('Screen capture error:', error);
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
      source.name.toLowerCase().includes('chrome') ||
      source.name.toLowerCase().includes('safari')
    );
    
    const sourceToUse = matchTraderSource || sources.find(source => source.name === 'Entire Screen');
    
    if (sourceToUse) {
      console.log(`Capturing: ${sourceToUse.name}`);
      return sourceToUse.thumbnail.toPNG();
    }
    
    return null;
  } catch (error) {
    console.error('Screenshot error:', error);
    return null;
  }
}

  async extractTradingData(screenshot) {
    // This is where we'll implement OCR for MatchTrader
    // For now, return mock data
    return {
      balance: 3905.13,
      equity: 3905.13,
      profit: 0.00,
      timestamp: Date.now()
    };
  }

  detectTrades(newData) {
    if (this.tradingData.lastBalance === 0) {
      this.tradingData.lastBalance = newData.balance;
      return;
    }

    // Calculate risk amount (1% of starting balance)
    const riskAmount = (this.tradingData.lastBalance * this.rules.riskPercent) / 100;
    const balanceChange = Math.abs(newData.balance - this.tradingData.lastBalance);

    // If balance changed by approximately risk amount, trade detected
    if (balanceChange >= (riskAmount * 0.8)) { // 80% threshold for detection
      this.tradingData.tradesCount++;
      this.tradingData.lastBalance = newData.balance;
      
      console.log(`Trade detected! Count: ${this.tradingData.tradesCount}`);
      
      // Update trading data
      this.tradingData.balance = newData.balance;
      this.tradingData.equity = newData.equity;
      this.tradingData.profit = newData.profit;
    }
  }

  checkRuleViolations() {
    if (this.tradingData.tradesCount >= this.rules.maxTrades) {
      this.triggerIntervention();
    }
  }

  triggerIntervention() {
    console.log('🚨 TRADING LIMIT REACHED!');
    
    // Show overlay popup
    this.showInterventionOverlay();
    
    // Optional: Block mouse/keyboard (be careful with this)
    // this.blockUserInput();
  }

  showInterventionOverlay() {
    if (this.overlayWindow) {
      // Center on screen
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;
      this.overlayWindow.setPosition(
        Math.floor((width - 400) / 2),
        Math.floor((height - 300) / 2)
      );
      
      this.overlayWindow.show();
      this.overlayWindow.focus();
      
      // Send intervention data
      this.overlayWindow.webContents.send('show-intervention', {
        message: `You've reached your ${this.rules.maxTrades} trade limit!`,
        timeoutMinutes: this.rules.timeoutMinutes,
        tradesCount: this.tradingData.tradesCount
      });
    }
  }

  setupIPC() {
    // Handle messages from renderer process
    ipcMain.on('start-monitoring', () => {
      this.startScreenMonitoring();
    });

    ipcMain.on('stop-monitoring', () => {
      this.isMonitoring = false;
    });

    ipcMain.on('update-rules', (event, newRules) => {
      this.rules = { ...this.rules, ...newRules };
    });

    ipcMain.on('reset-trades', () => {
      this.tradingData.tradesCount = 0;
    });

    ipcMain.on('acknowledge-intervention', () => {
      this.overlayWindow.hide();
      // Start timeout period
      this.startTimeoutPeriod();
    });
  }

  startTimeoutPeriod() {
    // Disable monitoring for timeout period
    this.isMonitoring = false;
    
    setTimeout(() => {
      this.isMonitoring = true;
      console.log('Timeout period ended - monitoring resumed');
    }, this.rules.timeoutMinutes * 60 * 1000);
  }
}

// App lifecycle
const tradingAssistant = new TradingAssistant();

app.whenReady().then(async () => {
  await tradingAssistant.createMainWindow();
  tradingAssistant.createOverlayWindow();
  tradingAssistant.setupIPC();

  // Global shortcut to toggle monitoring
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (tradingAssistant.isMonitoring) {
      tradingAssistant.isMonitoring = false;
      console.log('Monitoring paused');
    } else {
      tradingAssistant.startScreenMonitoring();
      console.log('Monitoring started');
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