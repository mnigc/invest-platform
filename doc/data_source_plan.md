# 数据源与自动更新方案

## 原则
- 全部使用 **免费** 数据源
- 数据更新以 **稳定、可靠** 为优先，不求实时
- 每日批量更新一次即可，满足"日线非实时"定位

---

## 1. 宏观经济数据

### 数据源：FRED (Federal Reserve Economic Data)
- **网址**：https://fred.stlouisfed.org/
- **API**：https://fred.stlouisfed.org/docs/api/api_key.html
- **特点**：完全免费，需申请 API Key，数据权威、稳定
- **覆盖**：GDP、CPI、PPI、PMI、利率、就业、M2 等所有美国宏观指标
- **更新频率**：按指标不同，日/周/月/季
- **调用限制**：每分钟 120 次（足够批量更新）

### 获取方式
```bash
# 示例 API 调用
https://api.stlouisfed.org/fred/series/observations?series_id=GDP&api_key=YOUR_KEY&file_type=json
```

---

## 2. 股票 / ETF / 指数价格

### 数据源：Yahoo Finance (via yfinance Python 库)
- **库**：https://github.com/ranaroussi/yfinance
- **特点**：免费，无需 API Key，数据稳定
- **覆盖**：全球股票、ETF、指数、期货
- **注意**：Yahoo Finance 数据为非官方渠道，适合参考用途，不保证完全准确

### 备选数据源
- **Alpha Vantage**：https://www.alphavantage.co/ — 免费 tier 500 次/天
- **Tiingo**：https://www.tiingo.com/ — 免费 tier 有限

---

## 3. 大宗商品

### 数据源：Yahoo Finance (yfinance)
- WTI 原油：`CL=F`
- 黄金：`GC=F`
- 铜：`HG=F`
- 天然气：`NG=F`

### 备选：FRED
- 部分大宗商品有相关指数

---

## 4. 外汇

### 数据源：FRED / Yahoo Finance
- 美元指数：FRED `DTWEXBGS` 或 Yahoo `DX-Y.NYB`
- 主要货币对：Yahoo Finance

---

## 5. 自动更新机制

### 方案：Python 定时脚本 + cron / systemd timer

#### 6.1 目录结构
```
project/
├── data_updater/
│   ├── __init__.py
│   ├── config.py          # 数据库配置、API keys
│   ├── db.py              # 数据库连接封装
│   ├── fetchers/
│   │   ├── __init__.py
│   │   ├── fred.py        # FRED 数据获取
│   │   └── yahoo.py       # Yahoo Finance 数据获取
│   ├── sync_indicators.py     # 同步经济指标
│   ├── sync_asset_prices.py   # 同步资产价格
│   └── run_all.py         # 一键运行所有同步
```

#### 6.2 同步频率
| 数据类型 | 同步频率 | 说明 |
|---------|---------|------|
| 经济指标 | 每日一次 | FRED 数据通常有延迟，每日凌晨同步 |
| 股票价格 | 每日一次 | 收盘后同步日线数据 |

#### 6.3 执行方式
```bash
# 使用 cron（Linux）
0 6 * * * cd /path/to/project && python data_updater/run_all.py

# Windows 可用任务计划程序（Task Scheduler）
# 或 Python schedule 库长期运行
```

#### 6.4 容错机制
- 每次同步记录日志到 `data_sync_logs` 表
- 失败时自动重试 3 次
- 部分失败不阻断其他数据同步
- 异常数据（如超大波动）标记为 `warning` 待人工复核

---

## 6. 技术实现要点

### 依赖
```
pymysql
yfinance
requests
schedule          # 如需 Python 内定时
python-dotenv     # 环境变量管理
```

### 数据库写入策略
- **经济指标**：按 `indicator_id + period_date` 唯一键，存在则更新
- **资产价格**：按 `asset_id + trade_date` 唯一键，存在则更新
- 使用事务批量写入，减少数据库往返
