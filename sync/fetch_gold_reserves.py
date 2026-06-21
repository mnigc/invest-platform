#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""同步黄金储备数据。

数据来源（按优先级）:
  1. 本地 xlsx — 直接导入，不做任何国家名合并或变动量重建。
       gold_holdings.xlsx  (国家/吨/占比/日期)
       gold_changes.xlsx   (国家 + 各月变动列)
       gold_price.xlsx     (日期/价格)
  2. gold-api.com       — 今日伦敦金价 (XAU/USD)
  3. FRED               — FRVGBSAM / TRESEGUSM052N / TRESEGCNM052N
  4. akshare            — 中国央行黄金储备 (万盎司)

写入表: gold_reserves / gold_reserve_changes / gold_price_history / indicator_data / data_sync_logs

依赖: pip install pymysql requests openpyxl pandas akshare
运行: python sync/fetch_gold_reserves.py
"""

import os
import sys
import logging
import datetime
import time
import math
import re
from decimal import Decimal, ROUND_HALF_UP

import pymysql
import requests

# ===== 代理/UA 伪装（防止网络环境不稳定）=====
for _k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
    os.environ.pop(_k, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"

_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Connection": "keep-alive",
}

# ============================================================
# 配置
# ============================================================
DB_HOST = "204.44.121.43"
DB_PORT = 3306
DB_USER = "mnigc"
DB_PASSWORD = "woaiyinyue.4"
DB_NAME = "invest_platform"

FRED_API_KEY = "671a9677b4cd70b6e85452f33a2c54ab"
FRED_URL = "https://api.stlouisfed.org/fred/series/observations"
GOLD_API_URL = "https://api.gold-api.com/price/XAU"

HTTP_TIMEOUT = 30
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

LOCAL_HOLDINGS_XLSX = os.path.join(SCRIPT_DIR, "gold_holdings.xlsx")
LOCAL_CHANGES_XLSX = os.path.join(SCRIPT_DIR, "gold_changes.xlsx")
LOCAL_PRICE_XLSX = os.path.join(SCRIPT_DIR, "gold_price.xlsx")

# ============================================================
# 日志
# ============================================================
logger = logging.getLogger("fetch_gold_reserves")
logger.setLevel(logging.INFO)
_fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
_ch = logging.StreamHandler(sys.stdout)
_ch.setFormatter(_fmt)
logger.addHandler(_ch)
try:
    _log_path = os.path.join(SCRIPT_DIR, "fetch_gold_reserves.log")
    _fh = logging.FileHandler(_log_path, encoding="utf-8")
    _fh.setFormatter(_fmt)
    logger.addHandler(_fh)
except Exception:
    pass

log = logger

# ============================================================
# 通用工具
# ============================================================
def to_float(v, digits=None):
    """安全把各种类型转为 float；None / NaN / 空 返回 None。"""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        try:
            if math.isnan(v) or math.isinf(v):
                return None
        except Exception:
            pass
        fv = float(v)
    else:
        s = str(v).strip().replace(",", "").replace("%", "")
        if not s or s.lower() in ("nan", "none", "."):
            return None
        try:
            fv = float(s)
        except ValueError:
            return None
    if digits is not None:
        fv = round(fv, digits)
    return fv


def to_decimal(v, digits=4):
    fv = to_float(v)
    if fv is None:
        return None
    return Decimal(str(fv)).quantize(Decimal("1").scaleb(-digits), rounding=ROUND_HALF_UP)


def with_retry(fn, max_retries=3, base_delay=2):
    """简单重试：失败则递增等待后重试。"""
    last_err = None
    for i in range(max_retries):
        try:
            return fn()
        except Exception as e:
            last_err = e
            delay = base_delay * (i + 1)
            log.warning("  尝试 %d/%d 失败: %s, %ds 后重试", i + 1, max_retries, e, delay)
            time.sleep(delay)
    raise last_err


def _parse_yyyymm(val):
    """把 'Dec 2025' / '2025年12月' / '2025-12' / '2025-12-01' / datetime 解析为 'YYYY-MM-01'。"""
    if val is None:
        return None
    if isinstance(val, datetime.datetime):
        return val.strftime("%Y-%m-01")
    if isinstance(val, datetime.date):
        return val.strftime("%Y-%m-01")
    try:
        import pandas as pd
        if hasattr(val, "to_pydatetime"):
            return val.to_pydatetime().strftime("%Y-%m-01")
    except Exception:
        pass
    s = str(val).strip()
    if not s or s.lower() in ("nan", "none", "nat"):
        return None
    m = re.search(r"(\d{4})[-/年.](\d{1,2})", s)
    if m:
        return "%04d-%02d-01" % (int(m.group(1)), int(m.group(2)))
    m = re.search(r"([A-Za-z]{3,})[\s,]+(\d{4})", s)
    if m:
        month_map = {
            "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
            "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
        }
        mm = month_map.get(m.group(1).lower())
        if mm:
            return "%04d-%02d-01" % (int(m.group(2)), mm)
    if s.isdigit() and len(s) == 4:
        return s + "-01-01"
    return None


def _parse_date(val):
    """解析精确日期为 'YYYY-MM-DD'。"""
    if val is None:
        return None
    if isinstance(val, datetime.datetime):
        return val.strftime("%Y-%m-%d")
    if isinstance(val, datetime.date):
        return val.strftime("%Y-%m-%d")
    try:
        import pandas as pd
        if hasattr(val, "to_pydatetime"):
            return val.to_pydatetime().strftime("%Y-%m-%d")
    except Exception:
        pass
    s = str(val).strip()
    if not s:
        return None
    m = re.search(r"(\d{4})[-/\.](\d{1,2})[-/\.](\d{1,2})", s)
    if m:
        return "%04d-%02d-%02d" % (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.search(r"(\d{4})[-/](\d{1,2})", s)
    if m:
        return "%04d-%02d-01" % (int(m.group(1)), int(m.group(2)))
    if s.isdigit() and len(s) == 4:
        return s + "-01-01"
    return None


# ============================================================
# 数据库
# ============================================================
def get_conn():
    conn = pymysql.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD,
        database=DB_NAME, charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10,
    )
    return conn


def ensure_tables():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS gold_reserves (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    country_name VARCHAR(120) NOT NULL,
                    country_name_cn VARCHAR(120),
                    region VARCHAR(20) DEFAULT 'GLOBAL',
                    holding_tonnes DECIMAL(18,4),
                    share_of_total_reserves DECIMAL(8,4),
                    period_date DATE NOT NULL,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uk_country_period (country_name, period_date)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS gold_reserve_changes (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    country_name VARCHAR(120) NOT NULL,
                    country_name_cn VARCHAR(120),
                    period_date DATE NOT NULL,
                    change_tonnes DECIMAL(18,4) NOT NULL,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uk_country_period (country_name, period_date)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS gold_price_history (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    source VARCHAR(40) NOT NULL,
                    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
                    unit VARCHAR(20) NOT NULL DEFAULT 'OZ',
                    price_date DATE NOT NULL,
                    close_price DECIMAL(18,4) NOT NULL,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uk_source_date (source, price_date)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            try:
                cur.execute("""
                    INSERT IGNORE INTO indicators (code, name_zh, region, category, unit, frequency, source, is_active, description)
                    VALUES
                      ('GOLD_USD', '伦敦黄金价格',  'GLOBAL', 'gold', 'USD/oz', 'daily',  'gold-api', 1, '黄金价格，美元/盎司'),
                      ('CNGOLD',   '中国央行黄金储备', 'CN',    'gold', '10k oz', 'monthly', 'akshare',  1, '中国人民银行公布的官方黄金储备(万盎司)'),
                      ('USGOLD',   '纽约美联储金库黄金持有量', 'US', 'gold', 'oz', 'monthly', 'FRED', 1, '纽约美联储金库的黄金持有量(金衡盎司, FRVGBSAM)'),
                      ('US_TOTAL_RES', '美国总储备(不含黄金)', 'US', 'reserve', 'Million USD', 'monthly', 'FRED', 1, '美国官方总储备资产(百万美元, TRESEGUSM052N)'),
                      ('CN_TOTAL_RES', '中国总储备(不含黄金)', 'CN', 'reserve', 'Million USD', 'monthly', 'FRED', 1, '中国官方总储备资产(百万美元, TRESEGCNM052N)')
                """)
            except Exception:
                pass
        conn.commit()


def _batch_upsert(sql, params, batch_size=200):
    """分批 executemany；单条失败不阻塞整批。"""
    if not params:
        return 0
    total = 0
    for i in range(0, len(params), batch_size):
        chunk = params[i:i + batch_size]
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.executemany(sql, chunk)
                conn.commit()
            total += len(chunk)
        except Exception as e:
            log.warning("  批次写入失败 (%s), 降级为逐行: %s", len(chunk), e)
            for p in chunk:
                try:
                    with get_conn() as conn:
                        with conn.cursor() as cur:
                            cur.execute(sql, p)
                        conn.commit()
                    total += 1
                except Exception:
                    pass
    return total


# ============================================================
# xlsx 读取（直接导入，不做国家名合并逻辑）
# ============================================================
def _require_pandas():
    try:
        import pandas as pd
        return pd, True
    except Exception:
        log.error("缺少 pandas，请执行: pip install pandas openpyxl")
        return None, False


def _smart_read_xlsx(path, expect_keywords):
    """读取 xlsx，自动处理前面有标题/空行的情况。"""
    pd, ok = _require_pandas()
    if not ok:
        return None
    try:
        df0 = pd.read_excel(path, sheet_name=0, engine="openpyxl")
    except Exception as e:
        log.warning("xlsx 读取失败 %s: %s", path, e)
        return None
    cols = list(df0.columns)
    cols_lower = {str(c).strip().lower(): c for c in cols}
    ok = any(any(kw in low for low in cols_lower) for kw in expect_keywords)
    if ok and not all(str(c).startswith("Unnamed") for c in cols):
        return df0
    for skip in range(1, 6):
        try:
            df2 = pd.read_excel(path, sheet_name=0, header=skip, engine="openpyxl")
        except Exception:
            continue
        if df2 is None or df2.empty:
            continue
        cols2 = list(df2.columns)
        if all(str(c).startswith("Unnamed") for c in cols2):
            continue
        cols_lower2 = {str(c).strip().lower(): c for c in cols2}
        if any(any(kw in low for low in cols_lower2) for kw in expect_keywords):
            return df2
    try:
        df3 = pd.read_excel(path, sheet_name=0, header=None, engine="openpyxl")
        return df3
    except Exception:
        return None


def _pick_col(cols, keywords):
    cols_lower = {str(c).strip().lower(): c for c in cols}
    for kw in keywords:
        for lower, orig in cols_lower.items():
            if kw in lower:
                return orig
    return None


def _cn_name(name):
    if not name:
        return name
    s = str(name).strip()
    mapping = {
        "United States": "美国", "USA": "美国", "U.S.": "美国", "US": "美国",
        "Germany": "德国", "Italy": "意大利", "France": "法国",
        "Russia": "俄罗斯", "Russian Federation": "俄罗斯",
        "China, P.R.: Mainland": "中国", "China": "中国", "People's Republic of China": "中国",
        "Switzerland": "瑞士", "India": "印度", "Japan": "日本",
        "Turkey": "土耳其", "Turkiye": "土耳其", "Türkiye": "土耳其",
        "Netherlands, The": "荷兰", "Netherlands": "荷兰",
        "Poland": "波兰", "Taiwan Province of China": "中国台湾", "Taiwan": "中国台湾",
        "Uzbekistan, Rep. of": "乌兹别克斯坦", "Uzbekistan": "乌兹别克斯坦",
        "Portugal": "葡萄牙",
        "Saudi Arabia": "沙特阿拉伯", "United Kingdom": "英国",
        "Kazakhstan, Rep. of": "哈萨克斯坦", "Kazakhstan": "哈萨克斯坦",
        "Spain": "西班牙", "Austria": "奥地利",
        "Thailand": "泰国", "Belgium": "比利时", "Singapore": "新加坡",
        "Algeria": "阿尔及利亚", "Iraq": "伊拉克", "Brazil": "巴西",
        "Philippines": "菲律宾", "Egypt, Arab Rep. of": "埃及", "Egypt": "埃及",
        "Sweden": "瑞典", "South Africa": "南非", "Mexico": "墨西哥", "Greece": "希腊",
        "Qatar": "卡塔尔", "Hungary": "匈牙利",
        "South Korea": "韩国", "Korea, Rep. of": "韩国", "Korea": "韩国", "Republic of Korea": "韩国",
        "Romania": "罗马尼亚", "Australia": "澳大利亚", "Kuwait": "科威特",
        "Indonesia": "印度尼西亚", "Jordan": "约旦", "Denmark": "丹麦",
        "Pakistan": "巴基斯坦", "Argentina": "阿根廷", "Finland": "芬兰",
        "Serbia, Rep. of": "塞尔维亚", "Serbia": "塞尔维亚",
        "Cambodia": "柬埔寨", "Bulgaria": "保加利亚",
        "Malaysia": "马来西亚", "Czechia": "捷克", "Czech Republic": "捷克", "Czech Rep.": "捷克",
        "Ukraine": "乌克兰", "Ecuador": "厄瓜多尔", "Syrian Arab Republic": "叙利亚", "Syria": "叙利亚",
        "Bolivia": "玻利维亚", "Morocco": "摩洛哥", "Afghanistan, Islamic Rep. of": "阿富汗", "Afghanistan": "阿富汗",
        "Bangladesh": "孟加拉国", "Cyprus": "塞浦路斯", "Mauritius": "毛里求斯",
        "Ireland": "爱尔兰", "Colombia": "哥伦比亚", "Bahrain, Kingdom of": "巴林", "Bahrain": "巴林",
        "Brunei Darussalam": "文莱", "Mozambique, Rep. of": "莫桑比克", "Mozambique": "莫桑比克",
        "Bosnia and Herzegovina": "波黑", "Albania": "阿尔巴尼亚",
        "Slovenia, Rep. of": "斯洛文尼亚", "Slovenia": "斯洛文尼亚",
        "Zimbabwe": "津巴布韦",
        "Belarus, Rep. of": "白俄罗斯", "Belarus": "白俄罗斯",
        "Tajikistan, Rep. of": "塔吉克斯坦", "Tajikistan": "塔吉克斯坦",
        "Kyrgyz Republic": "吉尔吉斯斯坦", "Kyrgyzstan": "吉尔吉斯斯坦",
        "Azerbaijan, Rep. of": "阿塞拜疆", "Azerbaijan": "阿塞拜疆",
        "North Macedonia, Republic of": "北马其顿", "North Macedonia": "北马其顿",
        "UAE": "阿联酋", "United Arab Emirates": "阿联酋",
        "Euro Area (incl. ECB)": "欧元区", "Euro Area": "欧元区",
        "Venezuela, Republica Bolivariana de": "委内瑞拉", "Venezuela": "委内瑞拉",
        "Ethiopia": "埃塞俄比亚", "Armenia, Rep. of": "亚美尼亚", "Armenia": "亚美尼亚",
        "Congo": "刚果", "Bhutan": "不丹", "Costa Rica": "哥斯达黎加",
        "Croatia": "克罗地亚", "Dominican Republic": "多米尼加",
        "Eritrea": "厄立特里亚", "Gabon": "加蓬", "Georgia": "格鲁吉亚",
        "Guatemala": "危地马拉", "Guinea": "几内亚", "Haiti": "海地",
        "Honduras": "洪都拉斯", "Iceland": "冰岛", "Kenya": "肯尼亚",
        "Laos": "老挝", "Latvia": "拉脱维亚", "Lithuania": "立陶宛",
        "Luxembourg": "卢森堡", "Malawi": "马拉维", "Maldives": "马尔代夫",
        "Malta": "马耳他", "Mauritania": "毛里塔尼亚", "Mongolia": "蒙古",
        "Montenegro": "黑山", "Moldova": "摩尔多瓦", "Myanmar": "缅甸",
        "Nepal": "尼泊尔", "Nicaragua": "尼加拉瓜", "Nigeria": "尼日利亚",
        "Norway": "挪威", "Oman": "阿曼", "Paraguay": "巴拉圭", "Peru": "秘鲁",
        "Sri Lanka": "斯里兰卡", "Sudan": "苏丹", "Togo": "多哥",
        "Trinidad and Tobago": "特立尼达和多巴哥", "Tunisia": "突尼斯",
        "Turkmenistan": "土库曼斯坦", "Vietnam": "越南", "Yemen": "也门",
        "Zambia": "赞比亚", "Lebanon": "黎巴嫩",
        "Hong Kong": "中国香港", "Hong Kong SAR": "中国香港",
        "Canada": "加拿大", "New Zealand": "新西兰", "Chile": "智利",
        "Vanuatu": "瓦努阿图", "Fiji": "斐济", "Israel": "以色列",
        "Iran": "伊朗", "Ghana": "加纳",
        "BIS": "国际清算银行", "IMF": "IMF",
        "World": "World", "WAEMU": "西非经济货币联盟", "BEAC": "中非国家银行",
        "Curaçao and Sint Maarten": "库拉索和圣马丁",
        "Netherlands Antilles": "荷属安的列斯",
        "Slovak Rep.": "斯洛伐克", "Slovakia": "斯洛伐克",
        "Libya": "利比亚", "Vietnam": "越南",
        "Burkina Faso": "布基纳法索", "Burundi": "布隆迪", "Cabo Verde": "佛得角",
        "Cameroon": "喀麦隆", "Central African Republic": "中非共和国",
        "Benin": "贝宁", "Botswana": "博茨瓦纳", "Barbados": "巴巴多斯",
        "Bahamas, The": "巴哈马", "Bahamas": "巴哈马",
        "Aruba, Kingdom of the Netherlands": "阿鲁巴", "Aruba": "阿鲁巴",
        "El Salvador": "萨尔瓦多", "Luxembourg": "卢森堡",
        "Macedonia": "北马其顿",
    }

    # 1. 精确匹配
    if s in mapping:
        return mapping[s]

    # 2. 去除脚注标记后再匹配 (如 Turkey5) -> Turkey)
    cleaned = re.sub(r'\d+\)$', '', s).strip()
    if cleaned in mapping:
        return mapping[cleaned]

    # 3. 子串匹配，但排除 Taiwan/China 的歧义
    s_lower = s.lower()
    if 'taiwan' in s_lower:
        return "中国台湾"
    if 'china' in s_lower and 'mainland' in s_lower:
        return "中国"

    for k, v in mapping.items():
        k_lower = k.lower()
        if k in s or s in k or k_lower in s_lower or s_lower in k_lower:
            # 避免把中国台湾的英文名误判为中国
            if v == "中国" and 'taiwan' in s_lower:
                continue
            return v
    return s


def _region(cn):
    if not cn:
        return "GLOBAL"
    if cn in ("美国",):
        return "US"
    if any(x in cn for x in ("中国", "香港", "台湾")):
        return "CN"
    if any(x in cn for x in ("英国", "德国", "法国", "意大利", "瑞士", "比利时", "荷兰",
                              "葡萄牙", "西班牙", "奥地利", "希腊", "芬兰", "爱尔兰",
                              "波兰", "捷克", "匈牙利", "罗马尼亚", "保加利亚",
                              "克罗地亚", "斯洛文尼亚", "塞尔维亚", "阿尔巴尼亚",
                              "波黑", "乌克兰", "白俄罗斯", "拉脱维亚", "立陶宛",
                              "卢森堡", "北马其顿", "马耳他", "黑山", "冰岛",
                              "丹麦", "瑞典", "挪威", "摩尔多瓦", "斯洛伐克",
                              "欧元区")):
        return "EUROPE"
    if any(x in cn for x in ("日本", "韩国", "印度", "泰国", "新加坡", "马来西亚",
                              "印度尼西亚", "菲律宾", "越南", "哈萨克斯坦",
                              "乌兹别克斯坦", "巴基斯坦", "孟加拉国", "斯里兰卡",
                              "尼泊尔", "蒙古", "缅甸", "柬埔寨", "老挝", "文莱",
                              "卡塔尔", "科威特", "沙特", "阿联酋", "阿曼", "也门",
                              "巴林", "黎巴嫩", "以色列", "约旦", "土耳其",
                              "阿塞拜疆", "塔吉克斯坦", "吉尔吉斯斯坦", "伊朗",
                              "格鲁吉亚", "亚美尼亚", "叙利亚", "伊拉克",
                              "土库曼斯坦")):
        return "ASIA"
    if any(x in cn for x in ("南非", "津巴布韦", "赞比亚", "莫桑比克", "肯尼亚",
                              "尼日利亚", "加纳", "毛里求斯", "埃及", "阿尔及利亚",
                              "突尼斯", "摩洛哥", "埃塞俄比亚", "刚果", "利比亚",
                              "安哥拉", "苏丹", "索马里")):
        return "AFRICA"
    if any(x in cn for x in ("巴西", "阿根廷", "墨西哥", "哥伦比亚", "智利", "秘鲁",
                              "委内瑞拉", "玻利维亚", "厄瓜多尔", "哥斯达黎加",
                              "古巴", "多米尼加", "危地马拉", "巴拿马", "巴拉圭",
                              "乌拉圭", "苏里南", "洪都拉斯", "海地", "尼加拉瓜")):
        return "LATAM"
    if any(x in cn for x in ("澳大利亚", "新西兰", "巴布亚新几内亚", "斐济", "瓦努阿图",
                              "加拿大")):
        return "OCEANIA"
    return "GLOBAL"


def parse_local_holdings_xlsx(path):
    """解析 gold_holdings.xlsx（标准表格格式）。"""
    if not os.path.isfile(path):
        log.info("持有量文件不存在，跳过: %s", path)
        return []
    pd, ok = _require_pandas()
    if not ok:
        return []
    
    df = pd.read_excel(path, sheet_name=0, header=0, engine="openpyxl")
    if df is None or df.empty:
        log.warning("持有量 xlsx 为空或读取失败")
        return []
    
    cols = [str(c).strip().lower() for c in df.columns]
    
    # 找到各列位置
    country_col = None
    holding_col = None
    share_col = None
    period_col = None
    
    for i, c in enumerate(cols):
        if c in ("country", "country_name"):
            country_col = df.columns[i]
        elif c in ("holding_tonnes", "holding", "tonnes", "tons"):
            holding_col = df.columns[i]
        elif c in ("share_of_total_reserves", "share", "percentage"):
            share_col = df.columns[i]
        elif c in ("period_date", "period", "date"):
            period_col = df.columns[i]
    
    rows = []
    fallback_period = datetime.datetime.now().strftime("%Y-%m-01")
    
    for _, r in df.iterrows():
        try:
            country = str(r[country_col]).strip() if country_col else ""
            if not country or country.lower() in ("nan", "none", ""):
                continue
            
            tonnes = to_float(r[holding_col]) if holding_col else None
            if tonnes is None or tonnes <= 0:
                continue
            
            share_val = to_float(r[share_col]) if share_col else None
            
            period_str = fallback_period
            if period_col:
                period = r[period_col]
                if not pd.isna(period):
                    if isinstance(period, datetime.datetime):
                        period_str = period.strftime("%Y-%m-01")
                    else:
                        period_str = str(period).strip()
                        for fmt in ["%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y-%m", "%b %Y", "%B %Y"]:
                            try:
                                dt = datetime.datetime.strptime(period_str, fmt)
                                period_str = dt.strftime("%Y-%m-01")
                                break
                            except:
                                continue
            
            cn = _cn_name(country)
            
            rows.append({
                "country_name": country,
                "country_name_cn": cn,
                "region": _region(cn),
                "holding_tonnes": round(tonnes, 4),
                "share_of_total_reserves": round(share_val, 4) if share_val is not None else None,
                "period_date": period_str,
            })
        except Exception as e:
            log.warning("解析持有量行失败: %s", e)
            continue
    
    log.info("本地持有量 -> %d 条", len(rows))
    return rows


def parse_local_changes_xlsx(path):
    """解析 gold_changes.xlsx（宽表）。"""
    if not os.path.isfile(path):
        log.info("变动文件不存在，跳过: %s", path)
        return []
    pd, ok = _require_pandas()
    if not ok:
        return []
    df = _smart_read_xlsx(path, ["country", "国家", "name", "change", "变动"])
    if df is None or df.empty:
        log.warning("变动量 xlsx 为空")
        return []

    cols = list(df.columns)
    country_col = _pick_col(cols, ["country", "国家", "name", "名称"])
    if country_col is None:
        country_col = cols[0]

    month_cols = []
    for c in cols:
        if c == country_col:
            continue
        period = _parse_yyyymm(c)
        if period:
            month_cols.append((c, period))
    log.info("变动量识别到 %d 个月份列", len(month_cols))
    if not month_cols:
        return []

    cn_col = _pick_col(cols, ["cn_name", "中文名", "中文", "国家_cn"])

    rows = []
    for _, r in df.iterrows():
        raw = None
        try:
            raw = r.get(country_col) if hasattr(r, "get") else r[country_col]
        except Exception:
            pass
        country = str(raw).strip() if raw is not None else ""
        if not country or country.lower() in ("nan", "none", "", "country", "国家", "world", "total", "合计"):
            continue
        cn = _cn_name(country)
        if cn_col and cn_col in cols:
            try:
                cv = r.get(cn_col) if hasattr(r, "get") else r[cn_col]
                if cv not in (None, ""):
                    cv_s = str(cv).strip()
                    if cv_s.lower() not in ("nan", "none"):
                        cn = cv_s
            except Exception:
                pass
        for col, period in month_cols:
            try:
                v = r.get(col) if hasattr(r, "get") else r[col]
            except Exception:
                v = None
            val = to_float(v)
            if val is None or val == 0:
                continue
            rows.append({
                "country_name": country,
                "country_name_cn": cn,
                "region": _region(cn),
                "period_date": period,
                "change_tonnes": round(val, 4),
            })
    log.info("本地变动量 -> %d 条", len(rows))
    return rows


def parse_local_price_xlsx(path):
    """解析 gold_price.xlsx (日期, 价格)。"""
    if not os.path.isfile(path):
        log.info("金价文件不存在，跳过: %s", path)
        return []
    df = _smart_read_xlsx(path, ["date", "日期", "time", "year", "period",
                                 "price", "close", "usd", "金价", "美元", "value", "spot", "oz", "盎司"])
    if df is None or df.empty:
        log.warning("金价 xlsx 为空")
        return []

    cols = list(df.columns)
    date_col = _pick_col(cols, ["date", "日期", "time", "year", "period"])
    price_col = _pick_col(cols, ["price", "close", "usd", "金价", "美元", "value", "spot"])
    if date_col is None:
        date_col = cols[0]
    if price_col is None and len(cols) >= 2:
        price_col = cols[1]
    if price_col is None:
        log.warning("无法识别金价列")
        return []

    rows = []
    for _, r in df.iterrows():
        try:
            v = r.get(date_col) if hasattr(r, "get") else r[date_col]
        except Exception:
            v = None
        d = _parse_date(v)
        if d is None:
            continue
        try:
            pv = r.get(price_col) if hasattr(r, "get") else r[price_col]
        except Exception:
            pv = None
        price = to_float(pv)
        if price is None or price <= 0:
            continue
        rows.append({"period_date": d, "value": round(price, 4)})
    log.info("金价历史 -> %d 条", len(rows))
    return rows


# ============================================================
# 外部数据
# ============================================================
def fetch_today_gold_price():
    try:
        r = with_retry(
            lambda: requests.get(GOLD_API_URL, headers={"User-Agent": _DEFAULT_HEADERS["User-Agent"]},
                                 timeout=HTTP_TIMEOUT)
        )
        data = r.json()
    except Exception as e:
        log.warning("gold-api.com 今日金价拉取失败: %s", e)
        return []
    price = to_float(data.get("price"))
    if not price or price <= 0:
        log.warning("gold-api.com 返回价格无效")
        return []
    d = None
    for key in ("updatedAt", "timestamp", "date"):
        if key in data and data[key]:
            m = re.search(r"(\d{4}-\d{2}-\d{2})", str(data[key]))
            if m:
                d = m.group(1)
                break
    if d is None:
        d = datetime.date.today().isoformat()
    log.info("今日金价 (gold-api.com): %s = %.2f USD/oz", d, price)
    return [{"period_date": d, "value": round(price, 4)}]


def fetch_fred_series(series_id, start_date="2000-01-01"):
    params = {
        "series_id": series_id, "api_key": FRED_API_KEY,
        "file_type": "json", "sort_order": "asc",
        "observation_start": start_date,
    }
    try:
        r = with_retry(lambda: requests.get(FRED_URL, params=params,
                                            headers={"User-Agent": _DEFAULT_HEADERS["User-Agent"]},
                                            timeout=HTTP_TIMEOUT))
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        log.warning("FRED %s 拉取失败: %s", series_id, e)
        return []
    obs = data.get("observations", []) if data else []
    rows = []
    for o in obs:
        v_raw = str(o.get("value", "")).strip()
        if not v_raw or v_raw in (".", "NA", "NaN", "None"):
            continue
        v = to_float(v_raw)
        if v is None:
            continue
        d = o.get("date")
        if not d:
            continue
        rows.append({"period_date": d, "value": round(v, 4)})
    log.info("FRED %s -> %d 条", series_id, len(rows))
    return rows


def fetch_akshare_cn_gold():
    try:
        import akshare as ak
    except Exception:
        log.warning("akshare 未安装，跳过中国黄金储备")
        return []
    try:
        df = with_retry(lambda: ak.macro_china_foreign_exchange_gold(), max_retries=2)
    except Exception as e:
        log.warning("akshare 中国黄金储备拉取失败: %s", e)
        return []
    if df is None or df.empty:
        log.warning("akshare 返回空数据")
        return []
    cols = list(df.columns)
    date_col = _pick_col(cols, ["date", "时间", "日期", "月份", "period"])
    gold_col = _pick_col(cols, ["gold", "黄金", "储备"])
    if date_col is None:
        date_col = cols[0]
    if gold_col is None and len(cols) >= 2:
        gold_col = cols[-1]
    rows = []
    for _, r in df.iterrows():
        try:
            dv = r.get(date_col) if hasattr(r, "get") else r[date_col]
            gv = r.get(gold_col) if hasattr(r, "get") else r[gold_col]
        except Exception:
            continue
        g = to_float(gv)
        if g is None or g <= 0:
            continue
        d = _parse_yyyymm(dv)
        if d is None:
            continue
        rows.append({"period_date": d, "value": round(g, 4)})
    log.info("akshare 中国央行黄金储备 -> %d 条", len(rows))
    return rows


# ============================================================
# 写入数据库（批量 upsert）
# ============================================================
def bulk_upsert_holdings(rows):
    if not rows:
        return 0
    sql = (
        "INSERT INTO gold_reserves "
        "(country_name, country_name_cn, region, holding_tonnes, share_of_total_reserves, period_date, updated_at) "
        "VALUES (%s, %s, %s, %s, %s, %s, NOW()) "
        "ON DUPLICATE KEY UPDATE "
        "country_name_cn=VALUES(country_name_cn), region=VALUES(region), "
        "holding_tonnes=VALUES(holding_tonnes), share_of_total_reserves=VALUES(share_of_total_reserves), "
        "updated_at=NOW()"
    )
    params = [
        (r["country_name"], r["country_name_cn"], r.get("region") or _region(r["country_name_cn"]),
         r["holding_tonnes"], r["share_of_total_reserves"], r["period_date"])
        for r in rows
    ]
    return _batch_upsert(sql, params)


def bulk_upsert_changes(rows):
    if not rows:
        return 0
    sql = (
        "INSERT INTO gold_reserve_changes "
        "(country_name, country_name_cn, period_date, change_tonnes, updated_at) "
        "VALUES (%s, %s, %s, %s, NOW()) "
        "ON DUPLICATE KEY UPDATE "
        "country_name_cn=VALUES(country_name_cn), change_tonnes=VALUES(change_tonnes), updated_at=NOW()"
    )
    params = [
        (r["country_name"], r["country_name_cn"], r["period_date"], r["change_tonnes"])
        for r in rows
    ]
    return _batch_upsert(sql, params)


def bulk_upsert_price(rows, source, currency="USD", unit="OZ"):
    if not rows:
        return 0
    sql = (
        "INSERT INTO gold_price_history (source, currency, unit, price_date, close_price, updated_at) "
        "VALUES (%s, %s, %s, %s, %s, NOW()) "
        "ON DUPLICATE KEY UPDATE close_price=VALUES(close_price), updated_at=NOW()"
    )
    params = [(source, currency, unit, r["period_date"], r["value"]) for r in rows]
    return _batch_upsert(sql, params)


def write_indicator_data(code, rows):
    if not rows:
        return 0
    ind_id = None
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM indicators WHERE code=%s LIMIT 1", (code,))
                row = cur.fetchone()
                if row:
                    ind_id = row["id"]
    except Exception as e:
        log.warning("查询 indicator id 失败: %s", e)
        return 0
    if ind_id is None:
        log.warning("未注册 indicator code=%s，跳过", code)
        return 0
    sql = (
        "INSERT INTO indicator_data (indicator_id, period_date, value, updated_at) "
        "VALUES (%s, %s, %s, NOW()) "
        "ON DUPLICATE KEY UPDATE value=VALUES(value), updated_at=NOW()"
    )
    params = []
    for r in rows:
        val = r.get("value")
        if val is None:
            continue
        params.append((ind_id, r["period_date"], round(float(val), 4)))
    return _batch_upsert(sql, params)


def write_sync_log(summary):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO data_sync_logs (sync_type, target_code, status, records_count, error_message, started_at, finished_at) "
                    "VALUES (%s, %s, %s, %s, %s, NOW(), NOW())",
                    ("gold_reserves", "ALL", "success", 0, summary),
                )
            conn.commit()
    except Exception:
        pass


# ============================================================
# 主流程
# ============================================================
def main():
    log.info("=" * 60)
    log.info("开始同步黄金储备数据")

    ensure_tables()
    counts = {
        "gold_reserves": 0, "gold_reserve_changes": 0,
        "gold_price_history": 0, "indicator_data": 0,
    }

    # --- 1. 本地 Excel: 官方最新持有量（100个国家）---
    holdings_rows = parse_local_holdings_xlsx(LOCAL_HOLDINGS_XLSX)
    n = bulk_upsert_holdings(holdings_rows)
    counts["gold_reserves"] += n
    log.info("[持有量] gold_reserves: 写入 %d 条", n)

    # --- 2. 本地 Excel: 变动量（月度增持/减持）---
    changes_rows = parse_local_changes_xlsx(LOCAL_CHANGES_XLSX)
    n = bulk_upsert_changes(changes_rows)
    counts["gold_reserve_changes"] += n
    log.info("[变动量] gold_reserve_changes: 写入 %d 条", n)

    # --- 3. 本地 Excel: 金价历史 ---
    rows = parse_local_price_xlsx(LOCAL_PRICE_XLSX)
    n = bulk_upsert_price(rows, "LOCAL-XLSX")
    counts["gold_price_history"] += n
    log.info("[金价] gold_price_history (LOCAL-XLSX): 写入 %d 条", n)

    # --- 4. gold-api.com 今日金价 ---
    rows = fetch_today_gold_price()
    n = bulk_upsert_price(rows, "gold-api")
    counts["gold_price_history"] += n
    log.info("[今日金价] gold_price_history (gold-api): 写入 %d 条", n)

    # --- 5. FRED 系列指标 ---
    for code, fred_id in [
        ("USGOLD", "FRVGBSAM"),
        ("US_TOTAL_RES", "TRESEGUSM052N"),
        ("CN_TOTAL_RES", "TRESEGCNM052N"),
    ]:
        rows = fetch_fred_series(fred_id)
        n = write_indicator_data(code, rows)
        counts["indicator_data"] += n
        log.info("[FRED] %s (%s): 写入 %d 条", code, fred_id, n)
        time.sleep(0.5)

    # --- 6. akshare 中国央行黄金储备 ---
    rows = fetch_akshare_cn_gold()
    n = write_indicator_data("CNGOLD", rows)
    counts["indicator_data"] += n
    log.info("[akshare] CNGOLD: 写入 %d 条", n)

    # --- 同步日志 ---
    summary = (
        "gold_reserves=%d, gold_reserve_changes=%d, "
        "gold_price_history=%d, indicator_data=%d"
        % (counts["gold_reserves"], counts["gold_reserve_changes"],
           counts["gold_price_history"], counts["indicator_data"])
    )
    write_sync_log(summary)

    log.info("=" * 60)
    log.info("完成: %s", summary)


if __name__ == "__main__":
    main()
