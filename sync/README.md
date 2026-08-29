# 数据同步脚本

将资产/指数/宏观数据写入 `invest_platform` 生产库。

---

## 1. 快速开始

### 安装依赖

```bash
cd /opt/macro
python3 -m venv .venv
/opt/macro/.venv/bin/python3 -m pip install pymysql requests pandas yfinance akshare
```

### 验证安装

```bash
/opt/macro/.venv/bin/python3 -c "import pymysql, requests, pandas, yfinance, akshare; print('ok')"
```

---

## 2. 运行任务

### 统一调度入口

```bash
cd /opt/macro

# 查看所有任务
/opt/macro/.venv/bin/python3 run_sync.py --list

# 运行单个任务
/opt/macro/.venv/bin/python3 run_sync.py us_assets

# 运行任务组
/opt/macro/.venv/bin/python3 run_sync.py --group daily    # 每交易日盘后
/opt/macro/.venv/bin/python3 run_sync.py --group weekly   # 每周一次
/opt/macro/.venv/bin/python3 run_sync.py --group monthly  # 每月一次

# 运行全部任务
/opt/macro/.venv/bin/python3 run_sync.py --all
```

### 任务分组

| 组 | 任务数 | 包含内容 |
| --- | --- | --- |
| **daily** | 10 | 美国资产快照、板块ETF、PE、中国指数、国债、北向资金、外汇、全球流动性、商品期货、ETF资金流 |
| **weekly** | 5 | 美股历史日线、美国宏观FRED、中国宏观、A股估值、黄金储备 |
| **monthly** | 2 | PMI数据、中国信贷脉冲 |

---

## 3. 1Panel 定时任务

只需配置 **3 个任务**：

### 交易日盘后（daily 组）

```
任务名称: 数据同步-每日
执行周期: 自定义 cron  30 23 * * 1-5
命令:
  cd /opt/macro && /opt/macro/.venv/bin/python3 run_sync.py --group daily
```

### 每周任务（weekly 组）

```
任务名称: 数据同步-每周
执行周期: 自定义 cron  0 2 * * 1
命令:
  cd /opt/macro && /opt/macro/.venv/bin/python3 run_sync.py --group weekly
```

### 每月任务（monthly 组）

```
任务名称: 数据同步-每月
执行周期: 自定义 cron  0 3 3 * *
命令:
  cd /opt/macro && /opt/macro/.venv/bin/python3 run_sync.py --group monthly
```

> **注意**：时间以服务器时区为准，建议先 `date` 确认。
> `1-5` = 周一到周五（交易日），`1` = 周一，`3` = 每月3号。

---

## 4. 故障排查

### 查看同步日志

```sql
SELECT sync_type, status, records_count, error_message, started_at
FROM data_sync_logs ORDER BY started_at DESC LIMIT 20;
```

### 查看脚本日志

```bash
tail -100 /opt/macro/logs/run_sync_*.log
```

### 手动重跑

```bash
cd /opt/macro && /opt/macro/.venv/bin/python3 run_sync.py us_assets
```

---

## 5. 数据库配置（Supabase / PostgreSQL）

1. 在 [supabase_schema.sql](supabase_schema.sql) 全量建表（Supabase Dashboard → SQL Editor 执行一次）。
2. 复制 Supabase 连接串（Project Settings → Database → Session Pooler）：
   ```
   postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```
3. 配置环境变量（每个运行终端 export，或写入服务器的 ~/.bashrc / 1Panel 任务环境）：
   ```bash
   export DATABASE_URL='postgresql://postgres.xxxx:******@aws-0-*.pooler.supabase.com:5432/postgres'
   ```

> `sync_base.py` 内含 MySQL→PostgreSQL SQL 适配层（ON DUPLICATE KEY UPDATE → ON CONFLICT 等），脚本无需改动即可运行。

### 验证数据库就绪

```bash
export DATABASE_URL='postgresql://postgres.xxxx:******@aws-0-*.pooler.supabase.com:5432/postgres'
python3 verify_db.py        # 检查连接 + 表清单 + 每表记录数/最新日期
```

---

## 6. 脚本清单

### 美国市场

| 脚本 | 同步内容 | 数据源 | 写入表 |
| --- | --- | --- | --- |
| `fetch_us_assets.py` | 美股指数 / ETF / 商品 / 外汇 最新价、涨跌幅、成交量 | Yahoo Finance | `asset_snapshots` |
| `fetch_us_asset_prices.py` | S&P 500 历史日线价格 | Yahoo Finance | `asset_prices` |
| `fetch_us_macro_fred.py` | GDP / CPI / PPI / 失业率 / 联邦基金利率 / 美债收益率（1M~30Y）/ VIX / PCE / 消费者信心 / 零售销售 / 欧元汇率 | FRED | `indicator_data` |
| `fetch_us_market_pe.py` | S&P 500 市盈率 (Trailing PE) | Yahoo Finance | `indicator_data` |
| `fetch_us_sectors.py` | 美股 11 个板块 ETF 日线（XLF/XLK/XLV/XLI/XLP/XLE/XLU/XLB/XLY/XLC/XLRE） | Yahoo Finance | `indicator_data` |

### 中国市场

| 脚本 | 同步内容 | 数据源 | 写入表 |
| --- | --- | --- | --- |
| `fetch_cn_indices.py` | 上证指数 / 上证50 / 沪深300 / 中证1000 / 科创50 / 深证成指 / 创业板指 日线（Yahoo 优先，akshare 兜底） | Yahoo Finance / akshare | `index_daily` |
| `fetch_cn_macro.py` | GDP / CPI / PPI / PMI / 社会消费品零售总额 | akshare（国统局/中采） | `indicator_data` |
| `fetch_cn_valuation.py` | A 股全市场 PE / PB、各行业 PE / PB | akshare | `cn_valuation` |
| `fetch_cn_bonds.py` | 中国 2Y / 5Y / 10Y / 30Y 国债收益率 | akshare | `indicator_data` |
| `fetch_northbound_flow.py` | 北向资金净流入 / 南向资金净流入 / USDCNY 汇率 | akshare / FRED | `indicator_data` |

### 全球 / 其他

| 脚本 | 同步内容 | 数据源 | 写入表 |
| --- | --- | --- | --- |
| `fetch_forex.py` | 美元指数 / 欧元 / 日元 / 英镑 / 离岸人民币 / 瑞郎 / 澳元 / 加元 / 韩元 | Yahoo Finance | `asset_prices` / `asset_snapshots` |
| `fetch_global_liquidity.py` | 美联储总资产 / 逆回购 RRP / TGA 账户 / SOFR 利率 / 欧央行总资产 / 日央行总资产 | FRED | `indicator_data` |
| `fetch_commodity_curves.py` | 原油 / 天然气 / 铜 / 黄金 / 玉米 / 小麦 / 大豆 期货期限结构 | Yahoo Finance | `commodity_curves` |
| `fetch_gold_reserves.py` | 全球各国黄金持有量 / 月度变动 / 金价历史 / 今日金价 / 美联储金库 / 中国央行储备 | 本地 Excel / FRED / akshare / gold-api | `gold_reserves` / `gold_reserve_changes` / `gold_price_history` / `indicator_data` |
| `fetch_ism_pmi.py` | 美国 ISM PMI / 中国财新 PMI / 中国非制造业 PMI | akshare | `indicator_data` |
| `fetch_china_credit_pulse.py` | 社会融资规模 / 新增信贷 / 中长期贷款 / 名义 GDP（计算信贷脉冲） | akshare | `china_credit_pulse` |
| `fetch_etf_flow.py` | 重点 ETF 日线行情 + 上交所/深交所基金份额（净申赎、申赎/成交额比率） | akshare（东财/交易所） | `etf_master` / `etf_daily` / `etf_shares` |

日志自动写入 `./logs/<脚本名>_YYYYMMDD.log`。