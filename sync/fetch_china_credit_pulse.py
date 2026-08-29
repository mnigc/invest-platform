#!/usr/bin/env python3
"""同步中国信贷脉冲数据（M3-11）。
数据源: akshare
  - macro_china_shrzgm: 社会融资规模（月度增量 + 分项）
  - macro_china_new_financial_credit: 新增信贷（含中长期贷款）
  - macro_china_gdp: 名义GDP（季度）
写入表: china_credit_pulse
用法:
    python3 fetch_china_credit_pulse.py
"""
import time
from datetime import datetime

import akshare as ak

from sync_base import _setup_logger, get_conn, write_sync_log, patch_cn_proxy


patch_cn_proxy()

SLEEP_AFTER = 2.0

log = _setup_logger("fetch_china_credit_pulse")


def fetch_tsf_data():
    log.info("拉取社会融资规模数据 (akshare macro_china_shrzgm)...")
    df = ak.macro_china_shrzgm()
    cols = df.columns.tolist()
    log.info("社融原始列: %s", cols)
    rows = []
    for _, r in df.iterrows():
        ym = str(r.iloc[0]).strip()
        if len(ym) != 6:
            continue
        rows.append({
            "ym": ym,
            "tsf_inc": float(r.iloc[1]) if r.iloc[1] is not None and r.iloc[1] == r.iloc[1] else None,
            "rmb_loan": float(r.iloc[2]) if r.iloc[2] is not None and r.iloc[2] == r.iloc[2] else None,
            "entrust": float(r.iloc[3]) if r.iloc[3] is not None and r.iloc[3] == r.iloc[3] else None,
            "trust": float(r.iloc[4]) if r.iloc[4] is not None and r.iloc[4] == r.iloc[4] else None,
            "undisc_bill": float(r.iloc[5]) if r.iloc[5] is not None and r.iloc[5] == r.iloc[5] else None,
            "corp_bond": float(r.iloc[6]) if r.iloc[6] is not None and r.iloc[6] == r.iloc[6] else None,
            "equity": float(r.iloc[7]) if r.iloc[7] is not None and r.iloc[7] == r.iloc[7] else None,
        })
    log.info("社融数据: %d 行", len(rows))
    time.sleep(SLEEP_AFTER)
    return rows


def fetch_credit_data():
    log.info("拉取新增信贷数据 (akshare macro_china_new_financial_credit)...")
    df = ak.macro_china_new_financial_credit()
    cols = df.columns.tolist()
    log.info("信贷原始列: %s", cols)
    rows = []
    for _, r in df.iterrows():
        ym_str = str(r.iloc[0]).strip()
        total = float(r.iloc[1]) if r.iloc[1] is not None and r.iloc[1] == r.iloc[1] else None
        yoy = float(r.iloc[2]) if r.iloc[2] is not None and r.iloc[2] == r.iloc[2] else None
        mom = float(r.iloc[3]) if r.iloc[3] is not None and r.iloc[3] == r.iloc[3] else None
        rows.append({"ym": ym_str, "total": total, "yoy": yoy, "mom": mom})
    log.info("信贷数据: %d 行", len(rows))
    time.sleep(SLEEP_AFTER)
    return rows


def load_gdp_from_db():
    log.info("从数据库读取中国GDP数据...")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT d.period_date, d.value FROM indicator_data d "
                "JOIN indicators i ON i.id = d.indicator_id "
                "WHERE i.code = 'GDP' AND i.region = 'CN' AND d.value IS NOT NULL "
                "ORDER BY d.period_date ASC"
            )
            db_rows = cur.fetchall()

    if not db_rows:
        log.warning("数据库中没有中国GDP数据，跳过")
        return []

    log.info("GDP原始数据: %d 行, %s ~ %s", len(db_rows),
             db_rows[0]["period_date"], db_rows[-1]["period_date"])

    raw = []
    for r in db_rows:
        d = str(r["period_date"])
        year = d[:4]
        month = d[5:7]
        gdp_val = float(r["value"])
        if month == "03":
            period = "q1"
        elif month == "06":
            period = "y2"
        elif month == "09":
            period = "y3"
        elif month == "12":
            period = "y4"
        else:
            continue
        raw.append({"year": year, "period": period, "gdp_cum": gdp_val})

    period_order = {"q1": 0, "y2": 2, "y3": 4, "y4": 6}
    raw.sort(key=lambda x: (int(x["year"]), period_order.get(x["period"], 99)))
    gdp_single = {}
    for r in raw:
        y = r["year"]
        p = r["period"]
        val = r["gdp_cum"]
        if p == "q1":
            gdp_single[y + "03"] = val
        elif p == "y2":
            q1 = gdp_single.get(y + "03", 0)
            gdp_single[y + "06"] = val - q1
        elif p == "y3":
            q1 = gdp_single.get(y + "03", 0)
            q2 = gdp_single.get(y + "06", 0)
            gdp_single[y + "09"] = val - q1 - q2
        elif p == "y4":
            q1 = gdp_single.get(y + "03", 0)
            q2 = gdp_single.get(y + "06", 0)
            q3 = gdp_single.get(y + "09", 0)
            gdp_single[y + "12"] = val - q1 - q2 - q3

    rows = [{"ym": ym, "gdp_nominal": val} for ym, val in sorted(gdp_single.items()) if val > 0]
    log.info("GDP单季值: %d 行", len(rows))
    for r in rows[:3]:
        log.info("  %s -> %.1f", r["ym"], r["gdp_nominal"])
    for r in rows[-3:]:
        log.info("  %s -> %.1f", r["ym"], r["gdp_nominal"])
    return rows


def ym_to_date(ym):
    return datetime.strptime(ym + "01", "%Y%m%d").date()


def ym_prev(ym, months=1):
    y = int(ym[:4])
    m = int(ym[4:])
    m -= months
    while m <= 0:
        m += 12
        y -= 1
    return "%d%02d" % (y, m)


def main():
    log.info("=" * 60)
    log.info("开始同步中国信贷脉冲数据")

    try:
        tsf_rows = fetch_tsf_data()
        credit_rows = fetch_credit_data()
        gdp_rows = load_gdp_from_db()
    except Exception as e:
        log.error("数据获取失败: %s", e)
        write_sync_log("china_credit_pulse", "failed", 0, str(e))
        return

    tsf_by_ym = {r["ym"]: r for r in tsf_rows}
    gdp_by_ym_qtr = {}
    for r in gdp_rows:
        gdp_by_ym_qtr[r["ym"]] = r["gdp_nominal"]

    sorted_yms = sorted(tsf_by_ym.keys())
    tsf_stock_dict = {}
    cumulative = 0.0
    for ym in sorted_yms:
        inc = tsf_by_ym[ym]["tsf_inc"]
        if inc is not None:
            cumulative += inc
        tsf_stock_dict[ym] = cumulative

    pulse_rows = []
    for ym in sorted_yms:
        ym_12 = ym_prev(ym, 12)
        if ym_12 not in tsf_stock_dict:
            continue
        d_stock = tsf_stock_dict[ym] - tsf_stock_dict[ym_12]
        if d_stock is None:
            continue

        y = int(ym[:4])
        m = int(ym[4:])
        if m <= 3:
            q_end = "%d03" % y
            q4 = "%d03" % y
            q3 = "%d12" % (y - 1)
            q2 = "%d09" % (y - 1)
            q1 = "%d06" % (y - 1)
        elif m <= 6:
            q_end = "%d06" % y
            q4 = "%d06" % y
            q3 = "%d03" % y
            q2 = "%d12" % (y - 1)
            q1 = "%d09" % (y - 1)
        elif m <= 9:
            q_end = "%d09" % y
            q4 = "%d09" % y
            q3 = "%d06" % y
            q2 = "%d03" % y
            q1 = "%d12" % (y - 1)
        else:
            q_end = "%d12" % y
            q4 = "%d12" % y
            q3 = "%d09" % y
            q2 = "%d06" % y
            q1 = "%d03" % y

        gdp_q1 = gdp_by_ym_qtr.get(q1, 0)
        gdp_q2 = gdp_by_ym_qtr.get(q2, 0)
        gdp_q3 = gdp_by_ym_qtr.get(q3, 0)
        gdp_q4 = gdp_by_ym_qtr.get(q4, 0)
        rolling_gdp = gdp_q1 + gdp_q2 + gdp_q3 + gdp_q4
        if rolling_gdp <= 0:
            continue

        credit_pulse = d_stock / rolling_gdp

        tsf = tsf_by_ym.get(ym, {})
        shadow = 0.0
        if tsf.get("entrust") is not None:
            shadow += tsf["entrust"]
        if tsf.get("trust") is not None:
            shadow += tsf["trust"]
        if tsf.get("undisc_bill") is not None:
            shadow += tsf["undisc_bill"]

        pulse_rows.append({
            "ym": ym,
            "report_date": ym_to_date(ym),
            "tsf_stock": round(tsf_stock_dict[ym], 2),
            "tsf_increment": tsf.get("tsf_inc"),
            "nominal_gdp": round(rolling_gdp, 2),
            "credit_pulse": round(credit_pulse, 4),
            "shadow_banking": round(shadow, 2) if shadow != 0 else None,
        })

    total = 0
    errors = []
    sql = """
        INSERT INTO china_credit_pulse
            (report_date, tsf_stock, tsf_increment, nominal_gdp, credit_pulse,
             medium_long_loan_ent, medium_long_loan_hh, shadow_banking)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            tsf_stock = VALUES(tsf_stock),
            tsf_increment = VALUES(tsf_increment),
            nominal_gdp = VALUES(nominal_gdp),
            credit_pulse = VALUES(credit_pulse),
            medium_long_loan_ent = VALUES(medium_long_loan_ent),
            medium_long_loan_hh = VALUES(medium_long_loan_hh),
            shadow_banking = VALUES(shadow_banking),
            updated_at = NOW()
    """
    batch = []
    for pr in pulse_rows:
        batch.append((
            pr["report_date"],
            pr["tsf_stock"],
            pr["tsf_increment"],
            pr["nominal_gdp"],
            pr["credit_pulse"],
            None,
            None,
            pr["shadow_banking"],
        ))
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.executemany(sql, batch)
            conn.commit()
        total = len(batch)
    except Exception as e:
        log.warning("批量写入失败，退化为逐行: %s", e)
        for pr in pulse_rows:
            try:
                with get_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute(sql, (
                            pr["report_date"],
                            pr["tsf_stock"],
                            pr["tsf_increment"],
                            pr["nominal_gdp"],
                            pr["credit_pulse"],
                            None,
                            None,
                            pr["shadow_banking"],
                        ))
                    conn.commit()
                    total += 1
            except Exception as e2:
                log.warning("  写入 %s 失败: %s", pr["ym"], e2)
                errors.append("%s: %s" % (pr["ym"], e2))

    if errors and total > 0:
        status = "partial"
    elif total > 0:
        status = "success"
    else:
        status = "failed"
    msg = "共写入 %d 条记录；失败 %d 个" % (total, len(errors))
    log.info(msg)
    write_sync_log("china_credit_pulse", status, total, msg)
    log.info("同步完成")


if __name__ == "__main__":
    main()