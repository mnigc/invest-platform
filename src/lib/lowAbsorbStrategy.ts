/** 低吸策略计算模块
 * 实现策略文档第四节的低吸买入规则 */

export interface PriceData {
  trade_date: string;
  close: number;
}

export interface DrawdownLevel {
  level: string;
  price: number;
  is_current: boolean;
}

export interface StrategySuggestion {
  current_drawdown: number;
  suggestion: string;
  position_advice: string;
  position_layers: number;
}

export interface LowAbsorbAnalysis {
  valid_high: {
    price: number;
    date: string;
    is_reconfirmed: boolean;
  };
  current_price: number;
  current_drawdown: number;
  drawdown_levels: DrawdownLevel[];
  suggestion: StrategySuggestion;
  position_advice: string;
}

export class LowAbsorbStrategy {
  private readonly LOOKBACK_DAYS = 360; // 近一年半
  private readonly REBALANCE_THRESHOLD = 0.2; // 20%

  /**
   * 计算有效高点和回撤分析
   * @param prices 历史价格数据，按日期升序排列
   * @param currentPrice 当前价格
   * @returns 低吸策略分析结果
   */
  public analyze(prices: PriceData[], currentPrice: number): LowAbsorbAnalysis {
    if (!prices || prices.length < 30) {
      throw new Error('价格数据不足，至少需要30天的数据');
    }

    // 1. 提取最近LOOKBACK_DAYS天的价格数据
    const recentPrices = prices.slice(-this.LOOKBACK_DAYS);
    
    // 2. 找到所有波峰（前后5日最高点）
    const peaks = this.findPeaks(recentPrices);
    
    // 3. 应用"反弹超20%重新确认"规则
    const validHighResult = this.findValidHigh(peaks, recentPrices);
    
    // 4. 计算当前回撤
    const currentDrawdown = ((currentPrice - validHighResult.price) / validHighResult.price) * 100;
    
    // 5. 生成回撤档位
    const drawdownLevels = this.generateDrawdownLevels(validHighResult.price, currentPrice);
    
    // 6. 获取策略建议
    const suggestion = this.getStrategySuggestion(currentDrawdown);
    
    // 7. 构建结果
    return {
      valid_high: validHighResult,
      current_price: currentPrice,
      current_drawdown: Number(currentDrawdown.toFixed(2)),
      drawdown_levels: drawdownLevels,
      suggestion,
      position_advice: this.getPositionAdvice(currentDrawdown),
    };
  }

  /**
   * 查找波峰（局部最大值）
   * @param prices 价格数据
   * @param window 窗口大小
   * @returns 波峰数组
   */
  private findPeaks(prices: PriceData[], window: number = 5): Array<{price: number, date: string}> {
    const peaks = [];
    
    for (let i = window - 1; i < prices.length - window; i++) {
      const currentPrice = prices[i].close;
      let isPeak = true;
      
      // 检查前后window天内是否所有价格都低于当前价格
      for (let j = 1; j <= window; j++) {
        if (i - j >= 0 && prices[i - j].close >= currentPrice) {
          isPeak = false;
          break;
        }
        if (i + j < prices.length && prices[i + j].close >= currentPrice) {
          isPeak = false;
          break;
        }
      }
      
      if (isPeak) {
        peaks.push({
          price: currentPrice,
          date: prices[i].trade_date,
        });
      }
    }
    
    return peaks;
  }

  /**
   * 应用"反弹超20%重新确认"规则
   * @param peaks 所有波峰
   * @param prices 价格数据
   * @returns 有效高点及是否被重新确认
   */
  private findValidHigh(peaks: Array<{price: number, date: string}>, prices: PriceData[]): {
    price: number;
    date: string;
    is_reconfirmed: boolean;
  } {
    if (peaks.length === 0) {
      // 如果没有波峰，返回最近的价格作为有效高点
      const latest = prices[prices.length - 1];
      return { price: latest.close, date: latest.trade_date, is_reconfirmed: false };
    }
    
    // 从最近的波峰向前追溯
    let validHigh = peaks[peaks.length - 1]; // 最近的波峰
    let isReconfirmed = false;
    
    for (let i = peaks.length - 2; i >= 0; i--) {
      const peak = peaks[i];
      const trough = this.findTroughBetween(peak, validHigh, prices);
      
      if (trough && ((validHigh.price - trough.price) / trough.price) > this.REBALANCE_THRESHOLD) {
        // 找到波谷，检查从波谷到有效高点之间的反弹是否超过20%
        validHigh = peak;
        isReconfirmed = true;
      }
    }
    
    return { price: validHigh.price, date: validHigh.date, is_reconfirmed: isReconfirmed };
  }

  /**
   * 查找两个波峰之间的波谷
   * @param peak1 第一个波峰
   * @param peak2 第二个波峰
   * @param prices 所有价格数据
   * @returns 波谷
   */
  private findTroughBetween(peak1: {price: number, date: string}, peak2: {price: number, date: string}, prices: PriceData[]): {price: number, date: string} | null {
    // 找到两个波峰在prices数组中的索引
    let startIndex = -1;
    let endIndex = -1;
    
    for (let i = 0; i < prices.length; i++) {
      if (prices[i].trade_date === peak1.date) {
        startIndex = i;
      }
      if (prices[i].trade_date === peak2.date) {
        endIndex = i;
      }
    }
    
    if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
      return null;
    }
    
    // 在两个波峰之间找到最低点
    let minPrice = Infinity;
    let minDate = '';
    
    for (let i = startIndex; i <= endIndex; i++) {
      if (prices[i].close < minPrice) {
        minPrice = prices[i].close;
        minDate = prices[i].trade_date;
      }
    }
    
    return { price: minPrice, date: minDate };
  }

  /**
   * 生成回撤档位
   * @param validHighPrice 有效高点价格
   * @param currentPrice 当前价格
   * @returns 回撤档位数组
   */
  private generateDrawdownLevels(validHighPrice: number, currentPrice: number): DrawdownLevel[] {
    const drawdowns = [-25, -30, -35, -40, -45, -50];
    const levels = [];
    
    for (const dd of drawdowns) {
      const levelPrice = validHighPrice * (1 + dd / 100);
      const isCurrent = Math.abs(currentPrice - levelPrice) < 0.01; // 价格相差小于0.01视为当前档位
      
      levels.push({
        level: `${Math.abs(dd)}%`,
        price: Number(levelPrice.toFixed(2)),
        is_current: isCurrent,
      });
    }
    
    return levels;
  }

  /**
   * 获取策略建议
   * @param drawdown 当前回撤百分比（负数）
   * @returns 策略建议
   */
  private getStrategySuggestion(drawdown: number): StrategySuggestion {
    const absDrawdown = Math.abs(drawdown);
    
    let suggestion = '';
    let positionLayers = 0;
    
    if (drawdown >= -20) {
      suggestion = '未到低吸区，继续等';
      positionLayers = 0;
    } else if (drawdown >= -25) {
      suggestion = '18%~20%：只适合试探仓';
      positionLayers = 1;
    } else if (drawdown >= -30) {
      suggestion = '25%档：可观察1层';
      positionLayers = 1;
    } else if (drawdown >= -35) {
      suggestion = '30%档：重点观察，等缩量企稳';
      positionLayers = 2;
    } else if (drawdown >= -40) {
      suggestion = '35%档：可分批补仓，先查基本面';
      positionLayers = 3;
    } else if (drawdown >= -45) {
      suggestion = '40%档：深回撤，严查基本面再决策';
      positionLayers = 4;
    } else {
      suggestion = '深度回撤：先查基本面，禁止机械补仓';
      positionLayers = 5;
    }
    
    return {
      current_drawdown: Number(drawdown.toFixed(2)),
      suggestion,
      position_advice: this.getPositionAdvice(drawdown),
      position_layers: positionLayers,
    };
  }

  /**
   * 获取仓位建议
   * @param drawdown 当前回撤
   * @param suggestion 策略建议
   * @returns 仓位建议
   */
  private getPositionAdvice(drawdown: number): string {
    const absDrawdown = Math.abs(drawdown);
    
    if (absDrawdown < 20) {
      return '等待更合适的买入点';
    } else if (absDrawdown < 25) {
      return '可轻仓试探，控制风险';
    } else if (absDrawdown < 30) {
      return '可观察1层，等待确认';
    } else if (absDrawdown < 35) {
      return '可分批加仓，重点观察量能';
    } else if (absDrawdown < 40) {
      return '先查基本面，再决定是否补仓';
    } else if (absDrawdown < 45) {
      return '深回撤，谨慎操作，建议先研究公司';
    } else {
      return '极度回撤，禁止机械补仓，必须先确认基本面';
    }
  }
}