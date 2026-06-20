/** 技术指标计算模块
 * 实现常用的技术分析指标 */

export interface TechnicalIndicators {
  ma5: number;
  ma20: number;
  ma60: number;
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  rsi: number;
  kdj: {
    k: number;
    d: number;
    j: number;
  };
  boll: {
    upper: number;
    middle: number;
    lower: number;
    bandwidth: number;
    percentB: number;
  };
  atr: number;
  cci: number;
}

export class TechnicalIndicatorsCalculator {
  /**
   * 计算移动平均线
   * @param prices 价格数组
   * @param periods 周期
   * @returns 移动平均线数组
   */
  public static calculateMA(prices: number[], periods: number[]): number[] {
    const result = new Array(prices.length).fill(null);
    
    for (const period of periods) {
      for (let i = period - 1; i < prices.length; i++) {
        const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
        result[i] = sum / period;
      }
    }
    
    return result;
  }

  /**
   * 计算MACD指标
   * @param prices 价格数组
   * @param shortPeriod 短期周期 (默认12)
   * @param longPeriod 长期周期 (默认26)
   * @param signalPeriod 信号周期 (默认9)
   * @returns MACD指标
   */
  public static calculateMACD(prices: number[], shortPeriod: number = 12, longPeriod: number = 26, signalPeriod: number = 9): {
    macd: number;
    signal: number;
    histogram: number;
  }[] {
    const result = new Array(prices.length).fill(null);
    
    // 计算EMA
    const shortEMA = this.calculateEMA(prices, shortPeriod);
    const longEMA = this.calculateEMA(prices, longPeriod);
    
    // 计算MACD柱
    for (let i = longPeriod - 1; i < prices.length; i++) {
      const macd = shortEMA[i] - longEMA[i];
      
      // 计算信号线EMA
      if (i === longPeriod - 1) {
        // 初始化信号线
        const signalEMA = this.calculateEMA([macd], signalPeriod);
        result[i] = {
          macd: macd,
          signal: signalEMA[0] || 0,
          histogram: macd - (signalEMA[0] || 0),
        };
      } else {
        const signalEMA = this.calculateEMA(prices.slice(i - signalPeriod + 1, i + 1).map((p, idx) => shortEMA[i - signalPeriod + 1 + idx] - longEMA[i - signalPeriod + 1 + idx]), signalPeriod);
        result[i] = {
          macd: macd,
          signal: signalEMA[signalEMA.length - 1] || 0,
          histogram: macd - (signalEMA[signalEMA.length - 1] || 0),
        };
      }
    }
    
    return result;
  }

  /**
   * 计算指数移动平均线
   * @param prices 价格数组
   * @param period 周期
   * @returns EMA数组
   */
  private static calculateEMA(prices: number[], period: number): number[] {
    if (prices.length < period) {
      return [];
    }
    
    const result = new Array(prices.length).fill(null);
    const multiplier = 2 / (period + 1);
    
    // 计算初始SMA
    const initialSMA = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result[period - 1] = initialSMA;
    
    // 计算EMA
    for (let i = period; i < prices.length; i++) {
      result[i] = (prices[i] - result[i - 1]) * multiplier + result[i - 1];
    }
    
    return result;
  }

  /**
   * 计算RSI指标
   * @param prices 价格数组
   * @param period 周期 (默认14)
   * @returns RSI数组
   */
  public static calculateRSI(prices: number[], period: number = 14): number[] {
    const result = new Array(prices.length).fill(null);
    
    if (prices.length < period + 1) {
      return result;
    }
    
    let avgGain = 0;
    let avgLoss = 0;
    
    // 计算初始平均收益和损失
    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        avgGain += change;
      } else {
        avgLoss += Math.abs(change);
      }
    }
    
    avgGain /= period;
    avgLoss /= period;
    
    // 计算第一个RS和RSI
    const rs = avgGain / avgLoss;
    result[period] = 100 - (100 / (1 + rs));
    
    // 计算后续RSI
    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      let gain = 0;
      let loss = 0;
      
      if (change > 0) {
        gain = change;
      } else {
        loss = Math.abs(change);
      }
      
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      
      const rs = avgGain / avgLoss;
      result[i] = 100 - (100 / (1 + rs));
    }
    
    return result;
  }

  /**
   * 计算KDJ指标
   * @param prices 价格数组
   * @param period 周期 (默认9)
   * @returns KDJ指标
   */
  public static calculateKDJ(prices: { high: number, low: number, close: number }[], period: number = 9): {
    k: number;
    d: number;
    j: number;
  }[] {
    const result = new Array(prices.length).fill(null);
    
    if (prices.length < period) {
      return result;
    }
    
    // 计算RSV
    for (let i = period - 1; i < prices.length; i++) {
      let highest = 0;
      let lowest = Infinity;
      
      for (let j = i - period + 1; j <= i; j++) {
        highest = Math.max(highest, prices[j].high);
        lowest = Math.min(lowest, prices[j].low);
      }
      
      const rsv = ((prices[i].close - lowest) / (highest - lowest)) * 100;
      
      // 计算K、D、J
      if (i === period - 1) {
        result[i] = {
          k: rsv,
          d: rsv,
          j: 3 * rsv - 2 * rsv, // J = 3K - 2D
        };
      } else {
        const prevK = result[i - 1].k;
        const prevD = result[i - 1].d;
        
        const k = (2 / 3) * rsv + (1 / 3) * prevK;
        const d = (2 / 3) * k + (1 / 3) * prevD;
        const j = 3 * k - 2 * d;
        
        result[i] = { k, d, j };
      }
    }
    
    return result;
  }

  /**
   * 计算布林带
   * @param prices 价格数组
   * @param period 周期 (默认20)
   * @param stdDev 标准差倍数 (默认2)
   * @returns 布林带指标
   */
  public static calculateBOLL(prices: number[], period: number = 20, stdDev: number = 2): {
    upper: number;
    middle: number;
    lower: number;
    bandwidth: number;
    percentB: number;
  }[] {
    const result = new Array(prices.length).fill(null);
    
    if (prices.length < period) {
      return result;
    }
    
    // 计算移动平均线
    const ma = this.calculateMA(prices, [period]);
    
    // 计算标准差
    for (let i = period - 1; i < prices.length; i++) {
      const slice = prices.slice(i - period + 1, i + 1);
      const mean = ma[i];
      const variance = slice.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / period;
      const std = Math.sqrt(variance);
      
      const upper = mean + stdDev * std;
      const lower = mean - stdDev * std;
      const bandwidth = (upper - lower) / mean * 100;
      const percentB = (prices[i] - lower) / (upper - lower) * 100;
      
      result[i] = {
        upper,
        middle: mean,
        lower,
        bandwidth,
        percentB,
      };
    }
    
    return result;
  }

  /**
   * 计算平均真实波幅
   * @param prices 价格数据
   * @param period 周期 (默认14)
   * @returns ATR数组
   */
  public static calculateATR(prices: { high: number, low: number, close: number }[], period: number = 14): number[] {
    const result = new Array(prices.length).fill(null);
    
    if (prices.length < period + 1) {
      return result;
    }
    
    // 计算真实波幅
    const tr = new Array(prices.length - 1);
    for (let i = 0; i < prices.length - 1; i++) {
      const highLow = prices[i + 1].high - prices[i + 1].low;
      const highPrevClose = Math.abs(prices[i + 1].high - prices[i].close);
      const lowPrevClose = Math.abs(prices[i + 1].low - prices[i].close);
      
      tr[i] = Math.max(highLow, highPrevClose, lowPrevClose);
    }
    
    // 计算ATR
    let atrSum = 0;
    for (let i = 0; i < period; i++) {
      atrSum += tr[i];
    }
    
    result[period] = atrSum / period;
    
    for (let i = period; i < tr.length; i++) {
      result[i + 1] = ((period - 1) * result[i] + tr[i]) / period;
    }
    
    return result;
  }

  /**
   * 计算商品通道指数
   * @param prices 价格数据
   * @param period 周期 (默认20)
   * @returns CCI数组
   */
  public static calculateCCI(prices: { high: number, low: number, close: number }[], period: number = 20): number[] {
    const result = new Array(prices.length).fill(null);
    
    if (prices.length < period + 1) {
      return result;
    }
    
    // 计算典型价格
    const tp = prices.map(p => (p.high + p.low + p.close) / 3);
    
    // 计算SMA
    const sma = this.calculateMA(tp.map(p => p), [period]);
    
    // 计算CCI
    for (let i = period; i < prices.length; i++) {
      const md = tp.slice(i - period + 1, i + 1).reduce((sum, price, idx) => {
        return sum + Math.abs(price - sma[i]);
      }, 0) / period;
      
      if (md === 0) {
        result[i] = 0;
      } else {
        result[i] = (tp[i] - sma[i]) / (0.015 * md);
      }
    }
    
    return result;
  }

  /**
   * 计算所有技术指标
   * @param prices 价格数据
   * @param high 高价数据
   * @param low 低价数据
   * @returns 所有技术指标
   */
  public static calculateAll(
    prices: number[],
    high: number[] = [],
    low: number[] = []
  ): TechnicalIndicators {
    const ma5 = this.calculateMA(prices, [5])[prices.length - 1] || 0;
    const ma20 = this.calculateMA(prices, [20])[prices.length - 1] || 0;
    const ma60 = this.calculateMA(prices, [60])[prices.length - 1] || 0;
    
    const macd = this.calculateMACD(prices)[prices.length - 1] || { macd: 0, signal: 0, histogram: 0 };
    const rsi = this.calculateRSI(prices)[prices.length - 1] || 0;
    
    // KDJ需要高/低/收盘价数据
    const kdjPrices = prices.map((close, idx) => ({
      high: high[idx] || close,
      low: low[idx] || close,
      close,
    }));
    const kdj = this.calculateKDJ(kdjPrices)[kdjPrices.length - 1] || { k: 50, d: 50, j: 50 };
    
    const boll = this.calculateBOLL(prices)[prices.length - 1] || { upper: 0, middle: 0, lower: 0, bandwidth: 0, percentB: 0 };
    const atr = this.calculateATR(kdjPrices)[kdjPrices.length - 1] || 0;
    const cci = this.calculateCCI(kdjPrices)[kdjPrices.length - 1] || 0;
    
    return {
      ma5,
      ma20,
      ma60,
      macd,
      rsi,
      kdj,
      boll,
      atr,
      cci,
    };
  }
}