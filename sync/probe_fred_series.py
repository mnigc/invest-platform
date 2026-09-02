#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性脚本：探测候选 FRED series 的可用性。

用途：在把指标写进 indicators.py 注册表之前，先确认每条 series 在 FRED 上
仍然存在、频率与单位符合预期、且近期仍在更新。历史上 ISM 相关序列
（NAPM / NEWORDER / MANEMP）曾被 FRED 下架，必须实测而不能凭记忆。

**刻意不 import sync_base**：本脚本只做 HTTP 探测，不连库，避免因本地
未安装 psycopg2 / pandas 而无法运行。仅依赖 requests + 标准库。

用法:
    python3 probe_fred_series.py
输出:
    逐行打印 series / 状态 / 标题 / 频率 / 单位 / 最新观测日
"""
import os
import sys
import json
import time

import requests


# ============== 读取 .env（项目根目录 + sync 目录）==============
def _load_dotenv():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    for path in (os.path.join(here, ".env"), os.path.join(root, ".env")):
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
        except Exception as e:
            print("[warn] 读取 %s 失败: %s" % (path, e))


_load_dotenv()

# FRED 国内直连可能被干扰，清掉系统代理
for _k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy",
           "ALL_PROXY", "all_proxy"):
    os.environ.pop(_k, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"

FRED_API_KEY = os.environ.get("FRED_API_KEY", "")
META_URL = "https://api.stlouisfed.org/fred/series"
OBS_URL = "https://api.stlouisfed.org/fred/series/observations"

TIMEOUT = (10, 25)


# (候选 code, FRED series id, 说明)
# 标注「备选」的仅在主选不可用时启用；ISM 三件套需实测确认。
CANDIDATES = [
    # ── A 组：流动性缺口 ──
    ("IORB", "IORB", "准备金余额利率（主选）"),
    ("BANK_RESERVES", "WRESBAL", "银行体系准备金余额（主选）"),
    ("M1", "M1SL", "M1 货币供应（主选，月）"),
    ("M2", "M2SL", "M2 货币供应（主选，月）"),
    ("WM1NS", "WM1NS", "M1 周频（备选）"),
    ("WM2NS", "WM2NS", "M2 周频（备选）"),

    # ── B 组：大宗商品 ──
    ("WTI", "DCOILWTICO", "WTI 原油（主选，日）"),
    ("BRENT", "DCOILBRENTEU", "布伦特原油（主选，日）"),
    ("COPPER", "PCOPPUSDM", "铜价 LME（主选，月）"),
    ("IRON_ORE", "PIORECRUSDM", "铁矿石（主选，月）"),
    ("NATGAS", "DHHNGSP", "Henry Hub 天然气（主选，日）"),

    # ── C 组：领先指标 ──
    ("NFCI", "NFCI", "芝加哥联储金融状况指数（主选，周）"),
    ("STLFSI4", "STLFSI4", "圣路易斯联储金融压力指数（备选，周）"),
    ("ICSA", "ICSA", "初请失业金人数（主选，周）"),
    ("UNRATE", "UNRATE", "失业率（主选，月，Sahm Rule 依赖）"),
    ("INDPRO", "INDPRO", "工业产出指数（主选，月）"),
    ("PERMIT", "PERMIT", "营建许可（主选，月）"),
    ("DGORDER", "DGORDER", "耐用品新订单（主选，月，ISM 降级替代）"),
    ("TCU", "TCU", "产能利用率（主选，月，ISM 降级替代）"),
    ("UMCSENT", "UMCSENT", "密歇根消费者信心（主选，月）"),
    ("PAYEMS", "PAYEMS", "非农就业总数（主选，月）"),

    # ── ISM 三件套：需实测，可能被下架 ──
    ("ISM_MFG", "NAPM", "ISM 制造业 PMI（待验证）"),
    ("ISM_NEWORDERS", "NEWORDER", "ISM 新订单（待验证）"),
    ("ISM_EMP", "MANEMP", "ISM 就业（待验证）"),
]


def _get(url, params):
    return requests.get(url, params=params, timeout=TIMEOUT)


def probe(series_id):
    """返回 (ok, info)。ok=False 时 info 带 error 字段。"""
    try:
        r = _get(META_URL, {
            "series_id": series_id, "api_key": FRED_API_KEY, "file_type": "json",
        })
        if r.status_code != 200:
            return False, {"error": "HTTP %s" % r.status_code}
        body = r.json() or {}
        if body.get("error_code") or body.get("error_message"):
            return False, {"error": "FRED: %s" % (body.get("error_message")
                                                  or body.get("error_code"))}
        series = (body.get("seriess") or [None])[0]
        if not series:
            return False, {"error": "响应无 seriess 字段"}
    except Exception as e:
        return False, {"error": "请求异常: %s" % type(e).__name__}

    info = {
        "title": (series.get("title") or "")[:46],
        "frequency": series.get("frequency_short") or "",
        "units": series.get("units_short") or "",
        "obs_end": series.get("observation_end") or "",
    }

    # 元数据存在但观测被清空的情况也要识别出来，故二次确认
    try:
        r2 = _get(OBS_URL, {
            "series_id": series_id, "api_key": FRED_API_KEY, "file_type": "json",
            "sort_order": "desc", "limit": "5",
        })
        obs = (r2.json() or {}).get("observations", []) if r2.status_code == 200 else []
        valid = [o for o in obs if str(o.get("value", "")).strip() not in ("", ".")]
        info["latest_date"] = obs[0].get("date") if obs else None
        info["latest_value"] = valid[0].get("value") if valid else None
    except Exception:
        info["latest_date"] = None
        info["latest_value"] = None

    return True, info


def main():
    if not FRED_API_KEY:
        print("[FATAL] 未设置 FRED_API_KEY，请在项目根目录 .env 中配置")
        sys.exit(1)

    print("=" * 112)
    print("FRED series 可用性探测（共 %d 条候选）" % len(CANDIDATES))
    print("=" * 112)
    print("%-14s %-14s %-7s | %-46s | %-16s | %s" % (
        "CODE", "SERIES", "状态", "标题", "频率/单位", "最新观测"))
    print("-" * 112)

    ok_map, bad_list = {}, []

    for code, series_id, desc in CANDIDATES:
        ok, info = probe(series_id)
        if ok and info.get("latest_value") is not None:
            ok_map[code] = info
            print("%-14s %-14s %-7s | %-46s | %-16s | %s = %s" % (
                code, series_id, "OK", info["title"],
                "%s / %s" % (info["frequency"], info["units"][:8]),
                info["latest_date"], info["latest_value"]))
        elif ok:
            bad_list.append((code, series_id, "元数据存在但无有效观测值"))
            print("%-14s %-14s %-7s | %-46s | %s" % (
                code, series_id, "NO-OBS", info["title"],
                "无有效观测（obs_end=%s）" % info["obs_end"]))
        else:
            bad_list.append((code, series_id, info.get("error")))
            print("%-14s %-14s %-7s | %s" % (code, series_id, "FAIL", info["error"]))
        time.sleep(0.4)  # FRED 限流保护

    print("-" * 112)
    print("可用 %d 条，不可用 %d 条" % (len(ok_map), len(bad_list)))

    if bad_list:
        print("\n不可用清单:")
        for code, series_id, err in bad_list:
            print("  %-14s %-14s %s" % (code, series_id, err))

    print("\nISM 三件套结论（决定领先指标页是否需要降级）:")
    for code, series_id, desc in CANDIDATES:
        if code.startswith("ISM_"):
            state = "可用" if code in ok_map else "不可用 → 用 DGORDER/TCU 降级"
            print("  %-14s %-14s %s" % (code, series_id, state))

    print("\nM1/M2 频度选择:")
    for code in ("M1", "M2", "WM1NS", "WM2NS"):
        print("  %-14s %s" % (code, "可用" if code in ok_map else "不可用"))

    # 机器可读结果，供后续步骤直接消费
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "_probe_result.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(ok_map, f, ensure_ascii=False, indent=2)
    print("\n结果已写入 %s" % out_path)


def inspect(series_ids):
    """按需复核：打印指定 series 的**完整**元数据。

    列表模式下标题被截断到 46 字符，遇到语义可疑的序列（例如 WRESBAL 显示为
    "Other Factors Draining Reserve Balances"）时，用它确认到底是不是想要的那条。
    """
    print("=" * 90)
    print("复核模式：完整元数据")
    print("=" * 90)
    for sid in series_ids:
        try:
            r = _get(META_URL, {
                "series_id": sid, "api_key": FRED_API_KEY, "file_type": "json",
            })
            body = r.json() or {}
            if body.get("error_code") or body.get("error_message"):
                print("\n[%s] HTTP %s -> FRED: %s" % (
                    sid, r.status_code, body.get("error_message") or body.get("error_code")))
                continue
            s = (body.get("seriess") or [None])[0]
            if not s:
                print("\n[%s] 无 seriess" % sid)
                continue
            print("\n[%s]  HTTP %s" % (sid, r.status_code))
            print("  title       : %s" % s.get("title"))
            print("  frequency   : %s (%s)" % (s.get("frequency"), s.get("frequency_short")))
            print("  units       : %s (%s)" % (s.get("units"), s.get("units_short")))
            print("  seasonal    : %s" % s.get("seasonal_adjustment_short"))
            print("  obs range   : %s ~ %s" % (
                s.get("observation_start"), s.get("observation_end")))
            print("  last_updated: %s" % s.get("last_updated"))
            print("  notes       : %s" % ((s.get("notes") or "")[:400].replace("\n", " ")))
        except Exception as e:
            print("\n[%s] 请求异常: %s" % (sid, type(e).__name__))
        time.sleep(0.4)


if __name__ == "__main__":
    args = sys.argv[1:]
    # 用法: python3 probe_fred_series.py WRESBAL M2SL
    # 传参数则进入复核模式（打印完整元数据），不传则跑全量探测
    if args:
        if not FRED_API_KEY:
            print("[FATAL] 未设置 FRED_API_KEY")
            sys.exit(1)
        inspect(args)
    else:
        main()
