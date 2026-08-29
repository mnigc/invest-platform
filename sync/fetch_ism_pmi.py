#!/usr/bin/env python3
"""Sync US ISM PMI + CN Caixin PMI + China Non-manufacturing PMI via akshare.
Writes to indicator_data.
"""
import time
from decimal import Decimal

from sync_base import _setup_logger, get_conn, write_sync_log, patch_cn_proxy


patch_cn_proxy()


SERIES = {
    'US_ISM_PMI': {'fn': 'macro_usa_ism_pmi', 'col': None},
    'CN_CAIXIN_PMI': {'fn': 'index_pmi_man_cx', 'col': None},
    'CN_NON_MANU_PMI': {'fn': 'macro_china_non_man_pmi', 'col': None},
}

log = _setup_logger("fetch_ism_pmi")


def main():
    import akshare as ak
    log.info("=" * 60)
    log.info("开始同步 PMI 补充指标 (akshare)")

    with get_conn() as conn:
        with conn.cursor() as cur:
            codes = list(SERIES.keys())
            placeholders = ",".join(["%s"] * len(codes))
            cur.execute(f"SELECT id, code FROM indicators WHERE code IN ({placeholders}) AND is_active = 1", codes)
            id_map = {r['code']: r['id'] for r in cur.fetchall()}

    total = 0
    errors = []

    for code, spec in SERIES.items():
        if code not in id_map:
            log.warning("%s - DB 记录不存在", code)
            errors.append(f"{code}: no DB entry")
            continue

        try:
            fn = getattr(ak, spec['fn'])
            df = fn()
            if df is None or df.empty:
                log.warning("%s - 无数据", code)
                continue

            date_col = None
            val_col = None
            for col in df.columns:
                s = str(col)
                sample = str(df[col].iloc[0])
                if '-' in sample and len(sample) >= 7:
                    date_col = col
                elif val_col is None:
                    try:
                        float(sample)
                        val_col = col
                    except:
                        pass

            if not date_col or not val_col:
                log.warning("%s - 无法识别列: %s", code, list(df.columns))
                continue

            ind_id = id_map[code]
            sql = ("INSERT INTO indicator_data (indicator_id, period_date, value, updated_at) "
                   "VALUES (%s, %s, %s, NOW()) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()")

            rows = []
            for _, row in df.iterrows():
                try:
                    date_str = str(row[date_col]).strip()
                    if len(date_str) >= 10:
                        date_str = date_str[:10]
                    val = Decimal(str(row[val_col])).quantize(Decimal("0.1"))
                    if float(val) > 0:
                        rows.append((ind_id, date_str, val))
                except:
                    pass

            if not rows:
                log.warning("%s - 解析后无有效行", code)
                continue

            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.executemany(sql, rows)
                    inserted = cur.rowcount if cur.rowcount else len(rows)
                conn.commit()

            total += inserted
            log.info("%s (%s) - 写入 %d 行，共 %d 条", code, spec['fn'], inserted, len(rows))
        except Exception as e:
            log.warning("%s - 失败: %s", code, e)
            errors.append(f"{code}: {e}")

        time.sleep(0.5)

    status = "success" if not errors else ("partial" if total > 0 else "failed")
    msg = "共写入 %d 行；失败 %d 个" % (total, len(errors))
    log.info(msg)
    write_sync_log("ism_pmi", status, total, msg)


if __name__ == "__main__":
    main()
