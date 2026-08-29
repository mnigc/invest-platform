#!/usr/bin/env python3
"""同步脚本公共基础模块（Supabase / PostgreSQL）。
所有同步脚本统一从这里导入公共组件；连接层自动完成 MySQL → PostgreSQL SQL 适配：
  - '?' 占位符不受影响（脚本使用 %s）
  - INSERT ... ON DUPLICATE KEY UPDATE → INSERT ... ON CONFLICT (冲突列) DO UPDATE SET a=EXCLUDED.a, ...
  - INSERT IGNORE → INSERT ... ON CONFLICT DO NOTHING
  - VALUES(col) → EXCLUDED.col（PG 兼容）
数据库连接从环境变量 DATABASE_URL 读取（Supabase 连接串）。
"""
import os
import sys
import re
import time
import logging
import threading
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

import psycopg2
from psycopg2.extras import RealDictCursor, execute_values


# ============== 读取 .env（项目根目录，不覆盖已有环境变量）==============
def _load_dotenv():
    here = os.path.dirname(os.path.abspath(__file__))
    for path in (
        os.path.join(here, ".env"),
        os.path.join(os.path.dirname(here), ".env"),
    ):
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip().strip("'\"")
                    if k and k not in os.environ:
                        os.environ[k] = v
        except Exception:
            pass
        break


_load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    print("[sync_base] 警告: 未设置 DATABASE_URL（Supabase 连接串），请在项目 .env 中配置", file=sys.stderr)


# 各表冲突列映射（对应 .doc/supabase_schema.sql 中的 UNIQUE 约束）
CONFLICT_COLS = {
    "indicators": ["code", "region"],
    "indicator_data": ["indicator_id", "period_date"],
    "asset_categories": ["code"],
    "assets": ["symbol"],
    "asset_prices": ["asset_id", "trade_date"],
    "asset_snapshots": ["asset_id"],
    "index_daily": ["index_code", "trade_date"],
    "cn_valuation": ["date"],
    "china_credit_pulse": ["report_date"],
    "gold_reserve_changes": ["country_name", "period_date"],
    "gold_price_history": ["source", "price_date"],
    "etf_master": ["code"],
    "etf_daily": ["code", "trade_date"],
    "etf_shares": ["code", "trade_date"],
}


# ============== SQL 适配层 ==============
def rewrite_sql(sql):
    """MySQL → PostgreSQL 语法改写。"""
    if not sql:
        return sql
    s = sql.strip()

    # INSERT IGNORE → ON CONFLICT DO NOTHING
    if re.match(r"insert\s+ignore\s+into", s, re.I):
        s = re.sub(r"insert\s+ignore\s+into", "INSERT INTO", s, flags=re.I).rstrip()
        if not re.search(r"on\s+conflict", s, re.I):
            s += "\nON CONFLICT DO NOTHING"
        else:
            return _values_to_excluded(s)
        return s

    # ON DUPLICATE KEY UPDATE → ON CONFLICT (...) DO UPDATE SET ...
    m = re.search(r"on\s+duplicate\s+key\s+update\s+(.*)$", s, re.I | re.S)
    if m:
        assignments_raw = m.group(1)
        assignments = _split_assignments(assignments_raw)
        table_m = re.search(r"insert\s+into\s+(\w+)", s, re.I)
        table = table_m.group(1).lower() if table_m else None
        conflict_cols = CONFLICT_COLS.get(table)
        base = s[:m.start()].rstrip()
        if conflict_cols:
            sets = []
            for a in assignments:
                kv = a.split("=", 1)
                if len(kv) != 2:
                    continue
                k, v = kv[0].strip(), kv[1].strip()
                vm = re.fullmatch(r"VALUES\(\s*(\w+)\s*\)", v, re.I)
                if vm:
                    sets.append(f"{k} = EXCLUDED.{vm.group(1)}")
                else:
                    sets.append(f"{k} = {v}")
            return (base + f"\nON CONFLICT ({', '.join(conflict_cols)}) DO UPDATE\nSET "
                    + ",\n".join(sets) if sets else base + "\nON CONFLICT (" + ", ".join(conflict_cols) + ") DO NOTHING")
        # 无映射：安全降级为 DO NOTHING
        return base + "\nON CONFLICT DO NOTHING"

    return _values_to_excluded(s)


def _split_assignments(assignments_raw):
    """拆分带逗号的赋值列表（VALUES 函数中的逗号不会被误分）。"""
    parts, depth, cur = [], 0, ""
    for ch in assignments_raw:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur)
    return [p.strip() for p in parts if p.strip() and "=" in p]


def _values_to_excluded(sql):
    return re.sub(r"VALUES\(\s*(\w+)\s*\)", lambda m: f"EXCLUDED.{m.group(1)}", sql, flags=re.I | re.M)


class _PgCursor:
    """包装 psycopg2 cursor，自动改写 SQL。"""

    def __init__(self, cur):
        self._cur = cur

    def __enter__(self):
        return self

    def __exit__(self, *a):
        try:
            self._cur.close()
        except Exception:
            pass

    def __getattr__(self, name):
        return getattr(self._cur, name)

    def execute(self, sql, args=None):
        # psycopg2 execute_values 内部会传已拼接好的 bytes，直接透传
        if isinstance(sql, (bytes, bytearray)):
            return self._cur.execute(sql, args)
        return self._cur.execute(rewrite_sql(sql), args)

    def executemany(self, sql, args):
        if not args:
            return None
        if isinstance(sql, (bytes, bytearray)):
            return self._cur.executemany(sql, args)
        return self._cur.executemany(rewrite_sql(sql), args)


class _PgConn:
    """包装 psycopg2 连接，脚本可透明使用 with get_conn() 模式。"""

    def __init__(self, raw):
        self.raw = raw

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type:
                self.raw.rollback()
            else:
                self.raw.commit()
        finally:
            self.raw.close()

    def __getattr__(self, name):
        return getattr(self.raw, name)

    def cursor(self):
        return _PgCursor(self.raw.cursor(cursor_factory=RealDictCursor))


# ============== 数据库连接 ==============
def get_conn():
    if not DATABASE_URL:
        raise RuntimeError("未设置 DATABASE_URL（Supabase 连接串），无法连接数据库")
    last_err = None
    for attempt in range(3):
        try:
            raw = psycopg2.connect(
                DATABASE_URL,
                sslmode="require",
                connect_timeout=20,
                keepalives_idle=30,
                keepalives_interval=10,
                keepalives_count=3,
                options="-c statement_timeout=180000 -c idle_in_transaction_session_timeout=180000",
            )
            return _PgConn(raw)
        except Exception as e:
            last_err = e
            log = _setup_logger("sync_base")
            log.warning("连接失败(第 %d/3 次): %s，2s 后重试", attempt + 1, e)
            time.sleep(2)
    raise last_err if last_err else RuntimeError("未知连接错误")


# ============== 日志 ==============
def _setup_logger(name):
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)
    logger.addHandler(ch)
    try:
        logs_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
        os.makedirs(logs_dir, exist_ok=True)
        log_file = os.path.join(logs_dir, "%s_%s.log" % (name, datetime.now().strftime("%Y%m%d")))
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setFormatter(fmt)
        logger.addHandler(fh)
    except Exception as e:
        print("日志文件初始化失败（忽略）:", e)
    return logger


# ============== 数据库辅助 ==============
def write_sync_log(sync_type, status, records_count, error_message="", target_code=""):
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cur.execute(
                    "INSERT INTO data_sync_logs (sync_type, target_code, status, records_count, error_message, started_at, finished_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (sync_type, target_code, status, records_count, error_message, now, now),
                )
            conn.commit()
    except Exception as e:
        log = _setup_logger("sync_base")
        log.warning("写入 data_sync_logs 失败: %s", e)


# ============== 重试机制 ==============
def with_retry(fn, *args, timeout=30, max_retry=4, **kwargs):
    last_err = None
    for attempt in range(1, max_retry + 1):
        holder, err_holder = [], []

        def _run():
            try:
                holder.append(fn(*args, **kwargs))
            except Exception as e:
                err_holder.append(e)

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        t.join(timeout)
        if t.is_alive():
            last_err = Exception("调用 %s 超过 %ds" % (getattr(fn, "__name__", "fn"), timeout))
        elif err_holder:
            last_err = err_holder[0]
        else:
            return holder[0] if holder else None
        wait = min(2 ** (attempt - 1), 15)
        log = _setup_logger("sync_base")
        log.warning("第 %d/%d 次失败: %s，%ds 后重试", attempt, max_retry, last_err, wait)
        time.sleep(wait)
    raise last_err if last_err else RuntimeError("未知错误")


# ============== 中国脚本代理清理 ==============
def patch_cn_proxy():
    """清空系统代理并伪装浏览器请求，用于中国数据源脚本。"""
    for _k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
        os.environ.pop(_k, None)
    os.environ["NO_PROXY"] = "*"
    os.environ["no_proxy"] = "*"

    try:
        import requests as _req
        from requests.adapters import HTTPAdapter as _HTTPAdapter
        try:
            from urllib3.util.retry import Retry as _Retry
            _HAS_RETRY = True
        except Exception:
            _HAS_RETRY = False
        _req.packages.urllib3.disable_warnings()

        _DEFAULT_HEADERS = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Connection": "keep-alive",
        }

        _orig_get = _req.get
        _orig_post = _req.post
        _orig_session_cls = _req.Session

        def _patched_get(url, params=None, headers=None, proxies=None, timeout=None, **kwargs):
            h = dict(_DEFAULT_HEADERS)
            if headers:
                h.update(headers)
            if timeout is None:
                timeout = (10, 20)
            return _orig_get(url, params=params, headers=h, proxies=proxies or {}, timeout=timeout, **kwargs)

        def _patched_post(url, data=None, headers=None, proxies=None, timeout=None, **kwargs):
            h = dict(_DEFAULT_HEADERS)
            if headers:
                h.update(headers)
            if timeout is None:
                timeout = (10, 20)
            return _orig_post(url, data=data, headers=h, proxies=proxies or {}, timeout=timeout, **kwargs)

        _req.get = _patched_get
        _req.post = _patched_post

        def _install_retry_session(*args, **kwargs):
            try:
                s = _orig_session_cls(*args, **kwargs)
                s.headers.update(_DEFAULT_HEADERS)
                if _HAS_RETRY:
                    retry = _Retry(total=2, backoff_factor=0.5,
                                   status_forcelist=(429, 500, 502, 503, 504),
                                   allowed_methods=frozenset(["GET", "HEAD"]))
                    adapter = _HTTPAdapter(max_retries=retry, pool_connections=5, pool_maxsize=10)
                    s.mount("http://", adapter)
                    s.mount("https://", adapter)
                return s
            except Exception:
                return _orig_session_cls(*args, **kwargs)

        _req.Session = _install_retry_session
    except Exception:
        pass


# ============== 安全转换工具 ==============
def safe_dec(v, digits=6):
    if v is None:
        return None
    try:
        import pandas as pd
        if pd.isna(v):
            return None
    except Exception:
        pass
    try:
        return Decimal(str(float(v))).quantize(
            Decimal("1").scaleb(-digits), rounding=ROUND_HALF_UP
        )
    except Exception:
        return None


def safe_int(v):
    if v is None:
        return None
    try:
        return int(float(v))
    except Exception:
        return None


# ============== 高性能批量写入 ==============
# 用 psycopg2 execute_values：一次 round-trip 写入多条 VALUES，
# 避免 executemany 的逐行往返（跨境高延迟下极易触发连接超时）。
def bulk_upsert(conn, cur, table, columns, rows, conflict_cols, update_cols=None, page_size=200, now_col="updated_at"):
    """批量 UPSERT。
    :param columns: 插入列清单（不含 updated_at，如需更新由 update_cols 指定）
    :param rows: 与 columns 对应的元组列表
    :param conflict_cols: ON CONFLICT 目标列
    :param update_cols: 冲突时更新的列；None 则只更新 updated_at
    """
    if not rows:
        return 0
    cols = list(columns) + [now_col]
    cols_str = ", ".join(cols)
    sets = [f"{c} = EXCLUDED.{c}" for c in (update_cols or [])] + [f"{now_col} = now()"]
    sql = (
        f"INSERT INTO {table} ({cols_str}) VALUES %s "
        f"ON CONFLICT ({', '.join(conflict_cols)}) DO UPDATE SET " + ", ".join(sets)
    )
    now = datetime.now()
    values = [tuple(r) + (now,) for r in rows]

    total = 0
    for i in range(0, len(values), page_size):
        chunk = values[i:i + page_size]
        last_err = None
        for attempt in range(3):
            try:
                execute_values(cur, sql, chunk, page_size=page_size)
                conn.commit()
                total += len(chunk)
                last_err = None
                break
            except Exception as e:
                last_err = e
                try:
                    conn.rollback()
                except Exception:
                    pass
                log = _setup_logger("sync_base")
                log.warning("批量写入 %s %d-%d 失败(第%d/3次): %s", table, i, i + len(chunk), attempt + 1, e)
                time.sleep(3)
        if last_err is not None:
            _setup_logger("sync_base").warning("批次 %s %d-%d 放弃", table, i, i + len(chunk))
    return total
