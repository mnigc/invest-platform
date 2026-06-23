# 数据同步脚本 - 部署说明

本目录包含用于把资产/指数/宏观数据写入 `invest_platform` 生产库的独立 Python 脚本。
每个脚本无需任何配置文件，直接运行即可；日志自动写入本目录下 `./logs/` 子目录。

---

## 1. 脚本列表

| 脚本 | 作用 | 写入表 | 推荐运行频率 |
| --- | --- | --- | --- |
| `fetch_us_assets.py` | 美股指数 / ETF / 商品 / 外汇快照 | `asset_snapshots` | 每个交易日盘后 1 次 |
| `fetch_us_asset_prices.py` | 美股核心资产历史日线（当前为 S&P 500，用于市场制式回测） | `asset_prices` | 每周 1 次 |
| `fetch_us_macro_fred.py` | 美国宏观指标 (GDP / CPI / 失业率 / 联邦基金利率 / 美债收益率 / VIX 等) | `indicator_data` | 每周 1 次 |
| `fetch_us_market_pe.py` | S&P 500 Trailing PE | `indicator_data` | 每个交易日盘后 1 次 |
| `fetch_us_sectors.py` | 美股 11 个 S&P 500 板块 SPDR ETF 日线 | `indicator_data` | 每个交易日盘后 1 次 |
| `fetch_cn_indices.py` | 中国 A 股主要指数日线（上证 / 深证 / 创业板 / 科创 / 北证） | `index_daily` | 每个交易日盘后 1 次 |
| `fetch_cn_macro.py` | 中国宏观指标 (GDP / CPI / PPI / PMI / 社会消费品零售总额) | `indicator_data` | 每周 1 次 |
| `fetch_cn_valuation.py` | A 股全市场 PE 与申万一级行业 PE/PB | `cn_valuation` | 每周 1 次 |
| `fetch_cn_bonds.py` | 中国国债收益率曲线 (3M/6M/1Y/2Y/3Y/5Y/7Y/10Y/20Y/30Y) | `indicators` / `indicator_data` | 每个交易日盘后 1 次 |
| `fetch_ism_pmi.py` | 美国 ISM 制造业 PMI + 中国财新制造业/非制造业 PMI | `indicator_data` | 每月 1 次 |
| `fetch_northbound_flow.py` | 北向 / 南向资金净流入 + 美元兑人民币汇率 | `indicator_data` | 每个交易日盘后 1 次 |
| `fetch_forex.py` | 美元指数 DXY + 8 个主要货币对日线 | `asset_prices` / `asset_snapshots` / `assets` | 每个交易日盘后 1 次 |
| `fetch_global_liquidity.py` | 全球流动性指标 (Fed/ECB/BOJ 资产负债表 + RRP + TGA + SOFR) | `indicator_data` | 每日 1 次 |
| `fetch_commodity_curves.py` | 7 种商品期货期限结构 (原油/天然气/铜/黄金/玉米/小麦/大豆) | `commodity_curves` | 每个交易日盘后 1 次 |
| `fetch_gold_reserves.py` | 全球黄金储备 (各国持有量 & 月度变动) + FRED 金价 + 中国央行黄金储备 | `gold_reserves` / `gold_reserve_changes` / `gold_price_history` / `indicator_data` | 每周 1 次 |

**辅助脚本**

| 脚本 | 作用 | 说明 |
| --- | --- | --- |
| `cleanup_deleted_modules.py` | 清理已下线模块在数据库中的遗留数据 | 一次性/按需运行 |
| `convert_gold_data.py` | 把 WGC/IMF 原始 Excel 转成脚本可识别的格式 | 按需手动运行 |

每次运行都会向 `data_sync_logs` 表写入一条同步记录（成功/失败/行数）。

---

## 2. 生产数据库连接

数据库连接参数**直接写在每个脚本顶部**，当前为：

```
主机 : 204.44.121.43
端口 : 3306
用户 : mnigc
密码 : woaiyinyue.4
库名 : invest_platform
```

> 如需调整，请在对应脚本顶部修改 `DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME`，不需要任何外部文件。

---

## 3. 依赖安装（虚拟环境方案）

### 3.1 环境要求：Python 3.8+ + python3-venv

Debian 12 / Ubuntu 24.04+ 默认开启了 PEP 668（`externally-managed-environment`），所以我们**不往系统 Python 装包**，改用虚拟环境。

**第一步：先确保系统里有 venv 组件**（Debian 把 venv 拆成了独立 deb，叫 `python3-venv`，缺它会报 `ensurepip` 相关错）：

```bash
apt-get update
apt-get install -y python3-venv python3-pip
```

**第二步：在 `/opt/macro/` 下创建虚拟环境并安装依赖**：

> 统一用 `/opt/macro/.venv/bin/python3 -m pip ...` 这种**绝对路径 + `-m` 调用**方式，避免 shell 激活脚本在不同环境里写法不一致的问题。

```bash
cd /opt/macro
python3 -m venv .venv
# 升级 pip/setuptools
/opt/macro/.venv/bin/python3 -m pip install --upgrade pip setuptools
# 安装脚本依赖
/opt/macro/.venv/bin/python3 -m pip install pymysql requests pandas yfinance akshare
```

### 3.2 验证安装

```bash
/opt/macro/.venv/bin/python3 -c "import pymysql, requests, pandas, yfinance; print('ok')"
```

> `akshare` 仅 `fetch_cn_indices.py`、`fetch_cn_macro.py`、`fetch_cn_bonds.py`、`fetch_ism_pmi.py`、`fetch_northbound_flow.py`、`fetch_gold_reserves.py` 使用。如果只跑美国脚本（含 `fetch_us_sectors.py`、`fetch_forex.py`、`fetch_global_liquidity.py`、`fetch_commodity_curves.py`），可以不装。海外环境建议配置 `HTTP_PROXY` 回国内。

---

## 4. 手动运行命令

> 统一使用虚拟环境内的解释器，**无需 `source .venv/bin/activate`**：

```bash
cd /opt/macro

# 美国资产快照
/opt/macro/.venv/bin/python3 fetch_us_assets.py

# 美股核心资产历史日线
/opt/macro/.venv/bin/python3 fetch_us_asset_prices.py

# 美股板块 ETF 日线
/opt/macro/.venv/bin/python3 fetch_us_sectors.py

# 美国宏观（FRED）
/opt/macro/.venv/bin/python3 fetch_us_macro_fred.py

# S&P 500 PE
/opt/macro/.venv/bin/python3 fetch_us_market_pe.py

# 中国指数日线（默认补 90 天）
/opt/macro/.venv/bin/python3 fetch_cn_indices.py

# 中国指数日线 - 只补最近 7 天（增量更快）
/opt/macro/.venv/bin/python3 fetch_cn_indices.py --daily

# 中国宏观
/opt/macro/.venv/bin/python3 fetch_cn_macro.py

# A 股估值
/opt/macro/.venv/bin/python3 fetch_cn_valuation.py

# 中国国债收益率曲线（默认补 90 天）
/opt/macro/.venv/bin/python3 fetch_cn_bonds.py

# 中国国债收益率曲线 - 只补最近 7 天（增量更快）
/opt/macro/.venv/bin/python3 fetch_cn_bonds.py --daily

# 美国 ISM PMI + 中国财新 PMI
/opt/macro/.venv/bin/python3 fetch_ism_pmi.py

# 北向 / 南向资金 + 美元兑人民币
/opt/macro/.venv/bin/python3 fetch_northbound_flow.py

# 外汇（DXY + 8 个货币对）
/opt/macro/.venv/bin/python3 fetch_forex.py

# 全球流动性（Fed/ECB/BOJ 资产负债表）
/opt/macro/.venv/bin/python3 fetch_global_liquidity.py

# 商品期货期限结构
/opt/macro/.venv/bin/python3 fetch_commodity_curves.py

# 全球黄金储备 + 金价
/opt/macro/.venv/bin/python3 fetch_gold_reserves.py

# 数据清理（按需）
/opt/macro/.venv/bin/python3 cleanup_deleted_modules.py

# 黄金 Excel 转换（按需）
/opt/macro/.venv/bin/python3 convert_gold_data.py
```

> 运行 `fetch_gold_reserves.py` 前，请把两份 xlsx（自己从 WGC / IMF / 央行公告下载）放在与脚本同目录：
>
> - `gold_holdings.xlsx` — 各国黄金持有量（需要包含 "国家/country" 列 + "吨/tonne" 列，可选 "占比/%" 和 "日期/asof"）
> - `gold_changes.xlsx` — 各国月度变动（宽表：第一列国家，其余列名为 `2025-12` / `Dec 2025` / `2025年12月`）
>
> 两个文件缺一个不会报错，只是对应那部分数据跳过。`FRED 金价` / `USGOLD` / `中国央行黄金储备` 三个 API 通路不受 xlsx 文件影响，始终会拉取。

日志会同时输出到屏幕和本目录下的 `./logs/<脚本名>_YYYYMMDD.log`。

---

## 5. 1Panel 定时任务配置

进入 1Panel 后台：

> 计划任务 -> 新增任务 -> 类型选 `Shell 脚本`

> **⚠️ 时区说明：** 以下所有 cron 时间均以 **洛杉矶时区（PDT / PST）** 为准。
> - 夏令时（3月~11月，PDT = UTC-7）：北京时间 = LA 时间 + 15 小时
> - 冬令时（11月~3月，PST = UTC-8）：北京时间 = LA 时间 + 16 小时
>
> 服务器时区可通过 `date` 命令确认。

### 5.1 美国资产快照（每个交易日 23:00 PT，美股盘后约 15 小时）

LA 23:00 = 北京次日 14:00（夏令时）/ 15:00（冬令时）

```
任务名称: 同步美国资产快照
执行周期: 自定义 cron  0 23 * * 1-5
命令:
  mkdir -p /opt/macro/logs && cd /opt/macro && /opt/macro/.venv/bin/python3 fetch_us_assets.py
```

### 5.2 美股板块 ETF 日线（每个交易日 23:10 PT）

```
任务名称: 同步美股板块 ETF
执行周期: 自定义 cron  10 23 * * 1-5
命令:
  mkdir -p /opt/macro/logs && cd /opt/macro && /opt/macro/.venv/bin/python3 fetch_us_sectors.py
```

### 5.3 S&P 500 PE（每个交易日 23:15 PT）

```
任务名称: 同步 S&P 500 PE
执行周期: 自定义 cron  15 23 * * 1-5
命令:
  mkdir -p /opt/macro/logs && cd /opt/macro && /opt/macro/.venv/bin/python3 fetch_us_market_pe.py
```

### 5.4 美股核心资产历史日线（每周一 05:00 PT）

```
任务名称: 同步美股核心资产历史日线
执行周期: 自定义 cron  0 5 * * 1
命令:
  mkdir -p /opt/macro/logs && cd /opt/macro && /opt/macro/.venv/bin/python3 fetch_us_asset_prices.py
```

### 5.5 美国宏观 FRED（每周一 01:00 PT）

```
任务名称: 同步美国宏观
执行周期: 自定义 cron  0 1 * * 1
命令:
  mkdir -p /opt/macro/logs && cd /opt/macro && /opt/macro/.venv/bin/python3 fetch_us_macro_fred.py
```

### 5.6 外汇 DXY + 货币对日线（每个交易日 23:05 PT）

```
任务名称: 同步外汇数据
执行周期: 自定义 cron  5 23 * * 1-5
命令:
  mkdir -p /opt/macro/logs && cd /opt/macro && /opt/macro/.venv/bin/python3 fetch_forex.py
```

### 5.7 中国指数日线（每个交易日 00:00 PT = 北京 15:00，A 股刚收盘）

LA 00:00 = 北京 15:00（夏令时）/ 16:00（冬令时），A 股 15:00 收盘

```
任务名称: 同步中国指数日线
执行周期: 自定义 cron  0 0 * * 1-5
命令:
  mkdir -p /opt/macro/logs && cd /opt/macro && /opt/macro/.venv/bin/python3 fetch_cn_indices.py --daily
```

### 5.8 中国国债收益率曲线（每个交易日 00:30 PT = 北京 15:30）

```
任务名称: 同步中国国债收益率
执行周期: 自定义 cron  30 0 * * 1-5
命令:
  mkdir -p /opt/macro/logs && cd /opt/macro && /opt/macro/.venv/bin/python3 fetch_cn_bonds.py --daily
```

### 5.9 北向 / 南向资金 + 汇率（每个交易日 01:00 PT = 北京 16:00）

```
任务名称: 同步北向南向资金
执行周期: 自定义 cron  0 1 * * 1-5
命令:
  mkdir -p /opt/macro/logs && cd /opt/macro && /opt/macro/.venv/bin/python3 fetch_northbound_flow.py
```

### 5.10 A 股估值（每周一 04:00 PT = 北京 19:00）

```
任务名称: 同步 A 股估值
执行周期: 自定义 cron  0 4 * * 1
命令:
  mkdir -p /opt/macro/logs && cd /opt/macro && /opt/macro/.venv/bin/python3 fetch_cn_valuation.py
```

### 5.11 中国宏观（每周一 02:00 PT = 北京 17:00）

```
任务名称: 同步中国宏观
执行周期: 自定义 cron  0 2 * * 1
命令:
  mkdir -p /opt/macro/logs && cd /opt/macro && /opt/macro/.venv/bin/python3 fetch_cn_macro.py
```

### 5.12 美国 ISM PMI + 中国财新 PMI（每月 3 日 02:00 PT，等上月数据发布）

```
任务名称: 同步 PMI 数据
执行周期: 自定义 cron  0 2 3 * *
命令:
  mkdir -p /opt/macro/logs && cd /opt/macro && /opt/macro/.venv/bin/python3 fetch_ism_pmi.py
```

### 5.13 全球流动性（每日 03:00 PT）

```
任务名称: 同步全球流动性
执行周期: 自定义 cron  0 3 * * *
命令:
  mkdir -p /opt/macro/logs && cd /opt/macro && /opt/macro/.venv/bin/python3 fetch_global_liquidity.py
```

### 5.14 商品期货期限结构（每个交易日 23:20 PT）

```
任务名称: 同步商品期货曲线
执行周期: 自定义 cron  20 23 * * 1-5
命令:
  mkdir -p /opt/macro/logs && cd /opt/macro && /opt/macro/.venv/bin/python3 fetch_commodity_curves.py
```

### 5.15 全球黄金储备 + 金价（每周一 06:00 PT = 北京 21:00）

```
任务名称: 同步黄金储备与金价
执行周期: 自定义 cron  0 6 * * 1
命令:
  mkdir -p /opt/macro/logs && cd /opt/macro && /opt/macro/.venv/bin/python3 fetch_gold_reserves.py
```

> `fetch_gold_reserves.py` 依赖本地两份 xlsx：`gold_holdings.xlsx`、`gold_changes.xlsx`（与脚本同目录）。
> 请先手动准备好这两份文件；即便没有它们，脚本也不会报错，只是跳过持有量/变动表的同步，FRED 金价和中国央行黄金储备仍会正常拉取。

> 提示：`cron` 的 `1-5` 代表周一到周五。时间以你 NAS 的系统时区为准，建议先 `date` 确认时区。
>
> 脚本内部已经配置了 `logging` 自动写 `./logs/<脚本名>_YYYYMMDD.log`，所以命令里**不再重复 shell 重定向**，避免每次运行都产生两份日志。

### 5.16 1Panel 中常见坑

1. **不要在命令里加 `>> xxx.cron.log 2>&1`**：脚本内部已经会自己写日志（`./logs/<脚本名>_YYYYMMDD.log`），再加一次 shell 重定向就会导致每次任务出现两份日志。
2. **必须使用虚拟环境完整路径 `/opt/macro/.venv/bin/python3`**：cron 子进程里 `PATH` 跟你手动 shell 不一样，写死绝对路径最稳。
3. **命令里先 `cd /opt/macro`**：脚本内部写日志的 `./logs/` 相对路径才对得上。
4. **手动先跑一次验证**：在 1Panel 新建任务后，先点 `立即执行` 一次，确认 `data_sync_logs` 表能看到新记录，再让它定时运行。

---

## 6. 故障排查

1. **查询同步日志**
   ```sql
   SELECT id, sync_type, status, records_count, error_message, started_at
   FROM data_sync_logs ORDER BY started_at DESC LIMIT 20;
   ```

2. **查看当天的脚本日志**
   ```bash
   ls -la /opt/macro/logs/
   tail -n 80 /opt/macro/logs/fetch_us_assets_$(date +%Y%m%d).log
   ```

3. **手动在 shell 中重跑一次**
   ```bash
   cd /opt/macro && /opt/macro/.venv/bin/python3 fetch_cn_indices.py --daily
   ```

4. **依赖升级 / 重装**
   ```bash
   /opt/macro/.venv/bin/python3 -m pip install --upgrade pip setuptools
   /opt/macro/.venv/bin/python3 -m pip install --upgrade pymysql requests pandas yfinance akshare
   ```

5. **虚拟环境坏了就重建**（无损，脚本文件不在 `.venv` 里）：
   ```bash
   cd /opt/macro && rm -rf .venv && python3 -m venv .venv && /opt/macro/.venv/bin/python3 -m pip install pymysql requests pandas yfinance akshare
   ```

6. **中国接口风控**
   `fetch_cn_indices.py` / `fetch_cn_macro.py` 内部已加 `SLEEP_BETWEEN`，不要频繁手动重跑，否则东财/统计局会临时限你 IP。

---

## 7. 数据结构（已对齐生产表）

脚本写入的核心字段：

- `asset_snapshots`: `asset_id, last_price, change_percent, volume, updated_at`
- `asset_prices`: `asset_id, trade_date, close_price, created_at, updated_at`
- `indicator_data`: `indicator_id, period_date, value, updated_at`
- `index_daily`: `index_code, index_name, category, trade_date, open_price, high_price, low_price, close_price, volume, amount, change_pct, turnover_rate`
- `cn_valuation`: `date, overall_pe, overall_pb, overall_signal, industries_json, created_at, updated_at`
- `gold_reserves`: `country_name, country_name_cn, region, holding_tonnes, share_of_total_reserves, period_date, updated_at`
- `gold_reserve_changes`: `country_name, country_name_cn, period_date, change_tonnes, updated_at`
- `gold_price_history`: `source, currency, unit, price_date, close_price, updated_at`
- `commodity_curves`: `commodity, contract, month_label, price, snapshot_date`（`fetch_commodity_curves.py` 自动建表）
- `data_sync_logs`: `sync_type, target_code, status, records_count, started_at, finished_at`

所有写入均使用 `INSERT ... ON DUPLICATE KEY UPDATE`，重复运行不会产生重复数据。

> `fetch_gold_reserves.py` 首次运行会自动创建 `gold_reserves` / `gold_reserve_changes` / `gold_price_history` 三张表，并在 `indicators` 表插入三条指标元数据：`GOLD_USD`、`USGOLD`、`CNGOLD`。

> `fetch_commodity_curves.py` 首次运行会自动创建 `commodity_curves` 表。
