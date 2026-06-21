#!/usr/bin/env python3
"""
转换 WGC 原始 Excel 为脚本可导入的格式：
1. Changes_latest_as_of_Jun2026_IFS.xlsx (Monthly sheet) -> gold_changes.xlsx
2. World_official_gold_holdings_ as of_Jun2026_IFS.xlsx -> gold_holdings.xlsx
"""
import pandas as pd
import os
import datetime
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def normalize_country_name(name):
    """标准化国家名，去掉脚注标记。"""
    if not name:
        return ""
    s = str(name).strip()
    # 去掉末尾的数字脚注，如 "Belarus, Rep. of4)" -> "Belarus, Rep. of"
    s = re.sub(r'\d+\)$', '', s).strip()
    return s


def parse_period(v):
    """把日期解析为 YYYY-MM-01 格式。"""
    if v is None or pd.isna(v):
        return None
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-01")
    if isinstance(v, str):
        s = v.strip()
        # 尝试各种格式
        for fmt in ["%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y-%m", "%b %Y", "%B %Y"]:
            try:
                dt = datetime.datetime.strptime(s, fmt)
                return dt.strftime("%Y-%m-01")
            except:
                continue
    return None


def convert_changes():
    """从 Monthly sheet 提取月度变动数据。"""
    input_path = os.path.join(SCRIPT_DIR, "Changes_latest_as_of_Jun2026_IFS.xlsx")
    output_path = os.path.join(SCRIPT_DIR, "gold_changes.xlsx")

    print(f"读取: {input_path}")
    df = pd.read_excel(input_path, sheet_name="Monthly", header=None, engine="openpyxl")
    print(f"原始形状: {df.shape}")

    # 国家名列
    country_col = 1
    # 月份表头在第 7 行 (index 7)
    header_row = 7
    # 数据从第 8 行开始
    data_start_row = 8

    # 获取月份列（从第 3 列开始）
    month_cols = []
    for col_idx in range(3, df.shape[1]):
        period = parse_period(df.iloc[header_row, col_idx])
        if period:
            month_cols.append((col_idx, period))

    print(f"识别到 {len(month_cols)} 个月份列")
    print(f"时间范围: {month_cols[0][1]} ~ {month_cols[-1][1]}")

    # 构建输出数据
    rows = []
    for row_idx in range(data_start_row, df.shape[0]):
        country = normalize_country_name(df.iloc[row_idx, country_col])
        if not country or country.lower() in ("nan", "none", ""):
            continue

        for col_idx, period in month_cols:
            val = df.iloc[row_idx, col_idx]
            if pd.isna(val):
                continue
            try:
                change = float(val)
            except:
                continue
            # 保留所有变动（包括 0，但 0 可以跳过）
            if change == 0:
                continue

            rows.append({
                "country": country,
                "period": period,
                "change_tonnes": change
            })

    # 转换为宽表格式：country + 每个月一列
    wide_df = pd.pivot_table(
        pd.DataFrame(rows),
        values="change_tonnes",
        index="country",
        columns="period",
        aggfunc="sum"
    ).reset_index()

    # 列名重命名
    wide_df.columns = ["Country"] + [str(c)[:7] for c in wide_df.columns[1:]]

    # 按国家名排序
    wide_df = wide_df.sort_values("Country").reset_index(drop=True)

    wide_df.to_excel(output_path, sheet_name="Monthly Changes", index=False)
    print(f"已生成: {output_path}")
    print(f"包含 {len(wide_df)} 个国家，{len(wide_df.columns) - 1} 个月份")


def convert_holdings():
    """从 World_official_gold_holdings 提取最新持有量数据。"""
    input_path = os.path.join(SCRIPT_DIR, "World_official_gold_holdings_ as of_Jun2026_IFS.xlsx")
    output_path = os.path.join(SCRIPT_DIR, "gold_holdings.xlsx")

    print(f"\n读取: {input_path}")
    df = pd.read_excel(input_path, sheet_name=0, header=None, engine="openpyxl")
    print(f"原始形状: {df.shape}")

    rows = []
    # 双列布局：左列 0-4，右列 5-9，数据行 6-55
    for col_offset in [0, 5]:
        for row_idx in range(6, 56):
            try:
                rank = df.iloc[row_idx, col_offset]
                country = df.iloc[row_idx, col_offset + 1]
                tonnes = df.iloc[row_idx, col_offset + 2]
                share = df.iloc[row_idx, col_offset + 3]
                period = df.iloc[row_idx, col_offset + 4]

                if pd.isna(rank) or pd.isna(country):
                    continue

                country = normalize_country_name(country)
                if not country or country.lower() in ("nan", "none", ""):
                    continue

                tonnes = float(tonnes) if not pd.isna(tonnes) else None
                if tonnes is None or tonnes <= 0:
                    continue

                share_val = None
                if not pd.isna(share):
                    try:
                        share_str = str(share).strip().replace(",", "").replace("%", "")
                        if share_str and share_str.lower() not in ("nan", "none", ""):
                            share_val = float(share_str)
                    except:
                        share_val = None
                period_str = parse_period(period)
                if not period_str:
                    period_str = "2026-04-01"

                rows.append({
                    "country_name": country,
                    "holding_tonnes": tonnes,
                    "share_of_total_reserves": share_val,
                    "period_date": period_str
                })
            except Exception as e:
                print(f"解析行 {row_idx} 失败: {e}")
                continue

    # --- 解析底部 WORLD OFFICIAL GOLD HOLDINGS 汇总数据 ---
    # row 63: World; row 64: Euro Area (incl. ECB)
    summary_rows = [
        (63, "World"),
        (64, "Euro Area (incl. ECB)")
    ]
    for row_idx, default_name in summary_rows:
        try:
            country = df.iloc[row_idx, 1]
            tonnes = df.iloc[row_idx, 2]
            share = df.iloc[row_idx, 3]
            period = df.iloc[row_idx, 4]

            country = normalize_country_name(country) if not pd.isna(country) else default_name
            if not country:
                country = default_name

            tonnes = float(tonnes) if not pd.isna(tonnes) else None
            if tonnes is None or tonnes <= 0:
                continue

            share_val = None
            if not pd.isna(share):
                try:
                    share_str = str(share).strip().replace(",", "").replace("%", "")
                    if share_str and share_str.lower() not in ("nan", "none", ""):
                        share_val = float(share_str)
                except:
                    share_val = None

            period_str = parse_period(period)
            if not period_str:
                period_str = "2026-03-01"

            rows.append({
                "country_name": country,
                "holding_tonnes": tonnes,
                "share_of_total_reserves": share_val,
                "period_date": period_str
            })
        except Exception as e:
            print(f"解析汇总行 {row_idx} 失败: {e}")
            continue

    out_df = pd.DataFrame(rows)
    out_df = out_df.sort_values("holding_tonnes", ascending=False).reset_index(drop=True)
    out_df["rank"] = range(1, len(out_df) + 1)
    out_df = out_df[["rank", "country_name", "holding_tonnes", "share_of_total_reserves", "period_date"]]

    out_df.to_excel(output_path, sheet_name="Holdings", index=False)
    print(f"已生成: {output_path}")
    print(f"包含 {len(out_df)} 个国家/地区")


if __name__ == "__main__":
    convert_changes()
    convert_holdings()
