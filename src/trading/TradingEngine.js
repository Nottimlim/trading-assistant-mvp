class TradingEngine {
  constructor() {
    this.tradingHistory = [];
    this.currentSession = {
      startTime: Date.now(),
      startingBalance: 0,
      tradesCount: 0,
      totalProfit: 0,
      lastBalance: 0,
      lastEquity: 0,
      isActive: false
    };
    
    this.rules = {
      maxTradesPerDay: 2,
      riskPercentage: 1.0,
      timeoutMinutes: 15,
      breakevenRule: 'none', // 'none', 'extra', 'reset'
      minTradeAmount: 50 // Minimum amount to consider a trade
    };
    
    this.consecutiveFailedDetections = 0;
    this.maxFailedDetections = 5;
  }

  updateRules(newRules) {
    this.rules = { ...this.rules, ...newRules };
    console.log('📋 Trading rules updated:', this.rules);
  }

  startSession(initialBalance) {
    this.currentSession = {
      startTime: Date.now(),
      startingBalance: initialBalance,
      tradesCount: 0,
      totalProfit: 0,
      lastBalance: initialBalance,
      lastEquity: initialBalance,
      isActive: true
    };
    
    this.consecutiveFailedDetections = 0;
    console.log('🚀 Trading session started:', this.currentSession);
  }

  detectTrade(currentData) {
    // Check if we have valid data
    if (!currentData || currentData.ocrFailed || currentData.error) {
      this.consecutiveFailedDetections++;
      if (this.consecutiveFailedDetections >= this.maxFailedDetections) {
        console.warn('⚠️ Too many consecutive OCR failures, may need calibration');
      }
      return null;
    }

    // Reset failed detection counter on successful read
    this.consecutiveFailedDetections = 0;

    // First data point - initialize tracking
    if (!this.currentSession.isActive || this.currentSession.lastBalance === 0) {
      this.currentSession.lastBalance = currentData.balance;
      this.currentSession.lastEquity = currentData.equity;
      this.currentSession.isActive = true;
      return null;
    }

    const balanceChange = currentData.balance - this.currentSession.lastBalance;
    const riskAmount = (this.currentSession.startingBalance * this.rules.riskPercentage) / 100;
    
    // Trade detected if balance changed by significant amount
    if (Math.abs(balanceChange) >= Math.max(this.rules.minTradeAmount, riskAmount * 0.5)) {
      const trade = {
        id: Date.now(),
        timestamp: new Date(),
        type: balanceChange > 0 ? 'win' : 'loss',
        amount: balanceChange,
        balanceBefore: this.currentSession.lastBalance,
        balanceAfter: currentData.balance,
        equity: currentData.equity,
        profit: currentData.profit,
        riskAmount: riskAmount,
        percentageChange: (balanceChange / this.currentSession.startingBalance) * 100
      };

      this.tradingHistory.push(trade);
      this.currentSession.tradesCount++;
      this.currentSession.totalProfit += balanceChange;
      this.currentSession.lastBalance = currentData.balance;
      this.currentSession.lastEquity = currentData.equity;

      console.log(`🎯 Trade detected:`, trade);
      return trade;
    }

    // Update last values for smaller changes (market movement)
    this.currentSession.lastBalance = currentData.balance;
    this.currentSession.lastEquity = currentData.equity;
    
    return null;
  }

  checkRuleViolations() {
    const violations = [];
    
    // Check if session is active
    if (!this.currentSession.isActive) {
      return violations;
    }
    
    // Check max trades per day
    if (this.currentSession.tradesCount >= this.rules.maxTradesPerDay) {
      // Handle breakeven rule
      if (this.rules.breakevenRule === 'extra' && this.currentSession.totalProfit >= 0) {
        if (this.currentSession.tradesCount > this.rules.maxTradesPerDay) {
          violations.push({
            type: 'daily_limit_exceeded',
            message: `Exceeded ${this.rules.maxTradesPerDay} trade limit (including breakeven bonus)`,
            severity: 'critical',
            tradesCount: this.currentSession.tradesCount,
            maxTrades: this.rules.maxTradesPerDay
          });
        }
      } else if (this.rules.breakevenRule === 'reset' && this.currentSession.totalProfit >= 0) {
        // Reset counter for breakeven
        this.currentSession.tradesCount = 0;
        console.log('🔄 Trade counter reset due to breakeven rule');
      } else {
        violations.push({
          type: 'daily_limit_exceeded',
          message: `Reached daily limit of ${this.rules.maxTradesPerDay} trades`,
          severity: 'critical',
          tradesCount: this.currentSession.tradesCount,
          maxTrades: this.rules.maxTradesPerDay
        });
      }
    }

    // Check for revenge trading pattern
    if (this.tradingHistory.length >= 3) {
      const recentTrades = this.tradingHistory.slice(-3);
      const allLosses = recentTrades.every(trade => trade.type === 'loss');
      
      if (allLosses) {
        violations.push({
          type: 'revenge_trading',
          message: 'Potential revenge trading detected - 3 consecutive losses',
          severity: 'warning',
          recentTrades: recentTrades.length
        });
      }
    }

    // Check for excessive risk
    const recentTrade = this.tradingHistory[this.tradingHistory.length - 1];
    if (recentTrade && Math.abs(recentTrade.percentageChange) > (this.rules.riskPercentage * 1.5)) {
      violations.push({
        type: 'excessive_risk',
        message: `Trade exceeded expected risk: ${recentTrade.percentageChange.toFixed(2)}%`,
        severity: 'warning',
        actualRisk: recentTrade.percentageChange,
        expectedRisk: this.rules.riskPercentage
      });
    }

    return violations;
  }

  getSessionStats() {
    const now = Date.now();
    const sessionDuration = this.currentSession.isActive ? now - this.currentSession.startTime : 0;
    
    return {
      ...this.currentSession,
      sessionDuration: sessionDuration,
      sessionDurationFormatted: this.formatDuration(sessionDuration),
      winRate: this.calculateWinRate(),
      averageTradeAmount: this.calculateAverageTradeAmount(),
      totalTrades: this.tradingHistory.length,
      rules: this.rules,
      ocrStatus: this.consecutiveFailedDetections < this.maxFailedDetections ? 'good' : 'poor'
    };
  }

  calculateWinRate() {
    if (this.tradingHistory.length === 0) return 0;
    
    const wins = this.tradingHistory.filter(trade => trade.type === 'win').length;
    return (wins / this.tradingHistory.length) * 100;
  }

  calculateAverageTradeAmount() {
    if (this.tradingHistory.length === 0) return 0;
    
    const totalAmount = this.tradingHistory.reduce((sum, trade) => sum + Math.abs(trade.amount), 0);
    return totalAmount / this.tradingHistory.length;
  }

  formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  resetSession() {
    this.tradingHistory = [];
    this.currentSession = {
      startTime: Date.now(),
      startingBalance: 0,
      tradesCount: 0,
      totalProfit: 0,
      lastBalance: 0,
      lastEquity: 0,
      isActive: false
    };
    
    this.consecutiveFailedDetections = 0;
    console.log('🔄 Trading session reset');
  }
}

module.exports = TradingEngine;