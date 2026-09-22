#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""临时诊断：查 sync_logs 最近失败记录（用后即删）。"""
import os
import re

env = {}
for line in open(os.path.join(os.path.dirname(__file__), "..", ".env"), encoding="utf-8"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    elif line.startswith("postgresql://"):
        env["DATABASE_URL"] = line

url = env["DATABASE_URL"]
import psycopg2
from psycopg2.extras import RealDictCursor

conn = psycopg2.connect(url)
with conn.cursor(cursor_factory=RealDictCursor) as cur:
    cur.execute(
        "SELECT task, status, rows_written, message, created_at FROM sync_logs "
        "ORDER BY created_at DESC LIMIT 40"
    )
    for r in cur.fetchall():
        mark = "  " if r["status"] == "success" else ">>"
        print(f"{mark} {r['created_at']:%m-%d %H:%M} [{r['status']:>7}] {r['task']:<28} rows={r['rows_written']} {str(r['message'])[:150]}")
conn.close()
