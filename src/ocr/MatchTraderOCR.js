const { createWorker } = require('tesseract.js');
const Jimp = require('jimp');
const fs = require('fs').promises;
const path = require('path');

class MatchTraderOCR {
  constructor() {
    this.worker = null;
    this.isInitialized = false;
    this.screenDimensions = { width: 1920, height: 1080 }; // Default dimensions
    
    // Precise regions based on MatchTrader screenshot - targeting actual numbers
    this.baseRegions = {
      balance: { x: 396, y: 115, width: 100, height: 25 },      // "93 905.13 USD"
      equity: { x: 536, y: 115, width: 100, height: 25 },       // "93 905.13 USD"  
      freeMargin: { x: 729, y: 115, width: 100, height: 25 },   // "93 905.13 USD"
      margin: { x: 869, y: 115, width: 80, height: 25 },        // "0.00 USD"
      marginLevel: { x: 1026, y: 115, width: 80, height: 25 },  // "0.00 %"
      profit: { x: 1316, y: 115, width: 80, height: 25 },       // "0.00 USD"
      positionsTable: { x: 46, y: 700, width: 1400, height: 150 } // "NO RESULTS" area
    };
    
    this.regions = { ...this.baseRegions };
    
    this.lastValues = {
      balance: 0,
      equity: 0,
      profit: 0,
      margin: 0,
      freeMargin: 0,
      marginLevel: 0
    };
    
    this.debugMode = process.env.NODE_ENV === 'development';
  }

  async initialize() {
    if (this.isInitialized) return;
    
    try {
      console.log('🔍 Initializing OCR engine...');
      this.worker = await createWorker('eng');
      
      // Optimize for numbers and currency - allow spaces for "93 905.13"
      await this.worker.setParameters({
        tessedit_char_whitelist: '0123456789.,-$ USD%',
        tessedit_pageseg_mode: '8', // Single uniform block of text
        preserve_interword_spaces: '1'
      });
      
      this.isInitialized = true;
      console.log('✅ OCR engine initialized successfully');
    } catch (error) {
      console.error('❌ OCR initialization failed:', error);
      throw new Error('OCR engine initialization failed - check Tesseract installation and dependencies');
    }
  }

  async autoCalibrate(screenshotBuffer) {
    try {
      console.log('🎯 Auto-calibrating OCR regions...');
      
      const image = await Jimp.read(screenshotBuffer);
      const capturedWidth = image.getWidth();
      const capturedHeight = image.getHeight();
      
      console.log(`📐 Captured dimensions: ${capturedWidth}x${capturedHeight}`);
      
      this.screenDimensions = { width: capturedWidth, height: capturedHeight };
      
      let baseWidth = 1920;
      let baseHeight = 1080;
      
      if (capturedWidth <= 1440) {
        baseWidth = 1440;
        baseHeight = 900;
      } else if (capturedWidth <= 1680) {
        baseWidth = 1680;
        baseHeight = 1050;
      }
      
      const scaleX = capturedWidth / baseWidth;
      const scaleY = capturedHeight / baseHeight;
      
      console.log(`📏 Scale factors: X=${scaleX.toFixed(3)}, Y=${scaleY.toFixed(3)} (base: ${baseWidth}x${baseHeight})`);
      
      this.regions = {};
      for (const [regionName, baseRegion] of Object.entries(this.baseRegions)) {
        this.regions[regionName] = {
          x: Math.floor(baseRegion.x * scaleX),
          y: Math.floor(baseRegion.y * scaleY),
          width: Math.floor(baseRegion.width * scaleX),
          height: Math.floor(baseRegion.height * scaleY)
        };
      }
      
      console.log('✅ Regions auto-calibrated:', this.regions);
      return this.regions;
      
    } catch (error) {
      console.error('Auto-calibration failed:', error);
      return this.baseRegions;
    }
  }

  async debugSaveScreenshot(screenshotBuffer, filename = 'debug_screenshot.png') {
    if (!this.debugMode) return null;
    
    try {
      const debugPath = path.join(__dirname, '..', '..', 'debug', filename);
      
      const debugDir = path.dirname(debugPath);
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      
      await fs.writeFile(debugPath, screenshotBuffer);
      console.log(`📸 Debug screenshot saved: ${debugPath}`);
      
      for (const [regionName, region] of Object.entries(this.regions)) {
        try {
          const croppedImage = await this.preprocessImageWithJimp(screenshotBuffer, region);
          const croppedPath = path.join(debugDir, `${regionName}_cropped.png`);
          await fs.writeFile(croppedPath, croppedImage);
          console.log(`📸 Cropped region saved: ${croppedPath}`);
        } catch (error) {
          console.error(`Failed to save cropped region ${regionName}:`, error);
        }
      }
      
      await this.saveRegionOverlay(screenshotBuffer, debugDir);
      
      return debugPath;
    } catch (error) {
      console.error('Failed to save debug screenshot:', error);
      return null;
    }
  }

  async saveRegionOverlay(screenshotBuffer, debugDir) {
    try {
      const image = await Jimp.read(screenshotBuffer);
      
      const colors = {
        balance: 0xFF0000FF,     // Red
        equity: 0x00FF00FF,      // Green
        profit: 0x0000FFFF,      // Blue
        margin: 0xFFFF00FF,      // Yellow
        freeMargin: 0xFF00FFFF,  // Magenta
        marginLevel: 0x00FFFFFF, // Cyan
        positionsTable: 0xFFA500FF // Orange
      };
      
      for (const [regionName, region] of Object.entries(this.regions)) {
        const color = colors[regionName] || 0xFFFFFFFF;
        
        for (let i = 0; i < 3; i++) {
          for (let x = region.x; x < region.x + region.width && x < image.getWidth(); x++) {
            if (region.y + i < image.getHeight()) image.setPixelColor(color, x, region.y + i);
          }
          for (let x = region.x; x < region.x + region.width && x < image.getWidth(); x++) {
            if (region.y + region.height - 1 - i >= 0 && region.y + region.height - 1 - i < image.getHeight()) image.setPixelColor(color, x, region.y + region.height - 1 - i);
          }
          for (let y = region.y; y < region.y + region.height && y < image.getHeight(); y++) {
            if (region.x + i < image.getWidth()) image.setPixelColor(color, region.x + i, y);
          }
          for (let y = region.y; y < region.y + region.height && y < image.getHeight(); y++) {
            if (region.x + region.width - 1 - i >= 0 && region.x + region.width - 1 - i < image.getWidth()) image.setPixelColor(color, region.x + region.width - 1 - i, y);
          }
        }
      }
      
      const overlayPath = path.join(debugDir, 'regions_overlay.png');
      await image.writeAsync(overlayPath);
      console.log(`🎨 Region overlay saved: ${overlayPath}`);
      
    } catch (error) {
      console.error('Failed to save region overlay:', error);
    }
  }

  async preprocessImageWithJimp(imageBuffer, region) {
    try {
      const image = await Jimp.read(imageBuffer);
      
      const maxX = Math.min(region.x + region.width, image.getWidth());
      const maxY = Math.min(region.y + region.height, image.getHeight());
      const validX = Math.max(0, region.x);
      const validY = Math.max(0, region.y);
      const validWidth = maxX - validX;
      const validHeight = maxY - validY;
      
      if (validWidth <= 0 || validHeight <= 0) {
        throw new Error(`Invalid region: ${JSON.stringify(region)}`);
      }
      
      let cropped = image.crop(validX, validY, validWidth, validHeight);
      
      cropped = cropped.grayscale();
      
      cropped = cropped.contrast(0.5);
      
      cropped = cropped.scale(3);
      
      // Adaptive threshold for light/dark contrast
      const histogram = cropped.histogram();
      const otsuThreshold = Jimp.autoThreshold(histogram);
      cropped = cropped.threshold({ max: otsuThreshold });
      
      const processedBuffer = await cropped.getBufferAsync(Jimp.MIME_PNG);
      
      return processedBuffer;
    } catch (error) {
      console.error('Image preprocessing failed:', error);
      return imageBuffer; // Fallback to original on error
    }
  }

  async extractFinancialValue(imageBuffer, region, fieldName) {
    try {
      const processedImage = await this.preprocessImageWithJimp(imageBuffer, region);
      
      const { data: { text, confidence } } = await this.worker.recognize(processedImage);
      
      let cleanText = text.replace(/USD|%/g, '').trim(); // Remove currency symbols
      
      if (cleanText.includes(' ') && !cleanText.includes(',')) {
        cleanText = cleanText.replace(/\s+/g, '');
      }
      
      if (cleanText.includes(',')) {
        cleanText = cleanText.replace(/,/g, '');
      }
      
      let value = 0;
      const minConfidence = this.debugMode ? 15 : 70; // Lower in dev for testing
      if (cleanText && confidence > minConfidence) {
        value = parseFloat(cleanText) || 0;
      } else {
        console.warn(`Low confidence (${confidence}%) for ${fieldName} - using fallback 0`);
      }
      
      console.log(`📊 ${fieldName}: "${text.trim()}" → ${value} (confidence: ${confidence.toFixed(1)}%) [region: ${JSON.stringify(region)}]`);
      return value;
      
    } catch (error) {
      console.error(`Failed to extract ${fieldName}:`, error);
      return 0;
    }
  }

  async extractTradingData(screenshotBuffer) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      console.log('🔍 Extracting trading data from MatchTrader...');
      
      await this.autoCalibrate(screenshotBuffer);
      
      if (this.debugMode) {
        await this.debugSaveScreenshot(screenshotBuffer);
      }
      
      const results = await Promise.allSettled([
        this.extractFinancialValue(screenshotBuffer, this.regions.balance, 'Balance'),
        this.extractFinancialValue(screenshotBuffer, this.regions.equity, 'Equity'),
        this.extractFinancialValue(screenshotBuffer, this.regions.freeMargin, 'Free Margin'),
        this.extractFinancialValue(screenshotBuffer, this.regions.margin, 'Margin'),
        this.extractFinancialValue(screenshotBuffer, this.regions.marginLevel, 'Margin Level'),
        this.extractFinancialValue(screenshotBuffer, this.regions.profit, 'Profit'),
        this.detectOpenPositions(screenshotBuffer)
      ]);

      const tradingData = {
        balance: results[0].status === 'fulfilled' ? results[0].value : 0,
        equity: results[1].status === 'fulfilled' ? results[1].value : 0,
        freeMargin: results[2].status === 'fulfilled' ? results[2].value : 0,
        margin: results[3].status === 'fulfilled' ? results[3].value : 0,
        marginLevel: results[4].status === 'fulfilled' ? results[4].value : 0,
        profit: results[5].status === 'fulfilled' ? results[5].value : 0,
        hasOpenPositions: results[6].status === 'fulfilled' ? results[6].value.hasOpenPositions : false,
        timestamp: Date.now()
      };

      if (tradingData.balance > 1000) { // Reasonable trading account balance threshold
        this.lastValues = { ...tradingData };
        console.log('✅ OCR extraction successful:', tradingData);
        return tradingData;
      } else {
        console.warn(`⚠️ OCR extraction may have failed - balance: ${tradingData.balance}`);
        return {
          ...this.lastValues,
          timestamp: Date.now(),
          ocrFailed: true
        };
      }
      
    } catch (error) {
      console.error('❌ Trading data extraction failed:', error);
      return {
        balance: 0,
        equity: 0,
        profit: 0,
        margin: 0,
        freeMargin: 0,
        marginLevel: 0,
        hasOpenPositions: false,
        timestamp: Date.now(),
        error: error.message
      };
    }
  }

  async detectOpenPositions(screenshotBuffer) {
    try {
      const positionsImage = await this.preprocessImageWithJimp(screenshotBuffer, this.regions.positionsTable);
      
      const { data: { text, confidence } } = await this.worker.recognize(positionsImage);
      
      const hasPositions = !text.toLowerCase().includes('no results') && 
                          !text.toLowerCase().includes('you do not have an open position') &&
                          confidence > 30;
      
      console.log(`📋 Open positions detected: ${hasPositions} (confidence: ${confidence.toFixed(1)}%)`);
      
      return {
        hasOpenPositions: hasPositions,
        positionsText: text.trim(),
        confidence: confidence
      };
      
    } catch (error) {
      console.error('Position detection failed:', error);
      return {
        hasOpenPositions: false,
        positionsText: '',
        confidence: 0
      };
    }
  }

  async calibrateRegions(screenshotBuffer, userDefinedRegions) {
    console.log('🎯 Calibrating OCR regions...');
    
    if (userDefinedRegions) {
      this.regions = { ...this.regions, ...userDefinedRegions };
    }
    
    const testResults = await this.extractTradingData(screenshotBuffer);
    
    console.log('✅ Region calibration test results:', testResults);
    return testResults;
  }

  async cleanup() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
      console.log('🧹 OCR engine cleaned up');
    }
  }
}

module.exports = MatchTraderOCR;