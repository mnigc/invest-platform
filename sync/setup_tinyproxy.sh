#!/usr/bin/env bash
# =====================================================================
# 在 1Panel 服务器上部署 tinyproxy（轻量 HTTP 代理，供 GitHub Actions 回国内数据源）
#
# 用法（在服务器上，root 或 sudo）：
#   bash setup_tinyproxy.sh
#
# 完成后：
#   - tinyproxy 监听 0.0.0.0:8888（HTTP 代理）
#   - 访问方式：http://<你的公网域名>:8888
#     本例 DDNS 域名：http://4fu1768rz202.vicp.fun:8888
#   - 若服务器有防火墙/安全组，请放行 TCP 8888
# =====================================================================
set -e

PROXY_PORT="${PROXY_PORT:-8888}"
PROXY_USER="${PROXY_USER:-}"     # 可选：Basic 认证用户名
PROXY_PASSWORD="${PROXY_PASSWORD:-}"  # 可选：Basic 认证密码

echo "==> 安装 tinyproxy"
if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y tinyproxy
elif command -v yum >/dev/null 2>&1; then
    yum install -y epel-release
    yum install -y tinyproxy
else
    echo "不支持的系统包管理，请手动安装 tinyproxy"; exit 1
fi

CONF="/etc/tinyproxy/tinyproxy.conf"
[ -f "$CONF" ] || CONF="/etc/tinyproxy.conf"

echo "==> 配置 tinyproxy (监听 $PROXY_PORT)"
cp -n "$CONF" "${CONF}.bak.$(date +%s)" 2>/dev/null || true

# 仅监听公网所有接口（如需安全可限制来源）
sed -i "s/^Port .*/Port $PROXY_PORT/" "$CONF" 2>/dev/null || echo "Port $PROXY_PORT" >> "$CONF"
# 带认证
if [ -n "$PROXY_USER" ] && [ -n "$PROXY_PASSWORD" ]; then
    grep -qi "^BasicAuth" "$CONF" && sed -i "/^BasicAuth/d" "$CONF" || true
    echo "BasicAuth $PROXY_USER $PROXY_PASSWORD" >> "$CONF"
fi
# 允许所有客户端（GitHub runner IP 不固定，需放开；建议生产用 BasicAuth）
grep -qi "^Allow " "$CONF" && sed -i "/^Allow 127.0.0.1/d" "$CONF" || true

# 默认 Allow 127.0.0.1 会挡住外部，改为允许所有
python3 - <<'PY' || true
import re
p = "/etc/tinyproxy/tinyproxy.conf"
s = open(p).read()
# 注释掉所有 Allow 行（tinyproxy 默认仅允许本机）
s = re.sub(r"^Allow .*$", "# Allow 0.0.0.0/0", s, flags=re.M)
open(p, "w").write(s)
PY

echo "==> 启停 tinyproxy"
if command -v systemctl >/dev/null 2>&1; then
    systemctl restart tinyproxy
    systemctl enable tinyproxy
else
    service tinyproxy restart || true
fi

echo "==> 放行端口（若使用 ufw）"
if command -v ufw >/dev/null 2>&1; then
    ufw allow "$PROXY_PORT"/tcp || true
fi

echo
echo "======================================================"
echo "tinyproxy 部署完成"
echo "  监听端口 : $PROXY_PORT"
echo "  代理地址 : http://4fu1768rz202.vicp.fun:$PROXY_PORT"
if [ -n "$PROXY_USER" ]; then
    echo "  认证     : $PROXY_USER / ***(BasicAuth)"
fi
echo
echo "在 GitHub Actions 的 Secrets 中配置:"
echo "  CN_HTTP_PROXY = http://4fu1768rz202.vicp.fun:$PROXY_PORT"
echo "======================================================"
echo
echo "验证代理是否可用（任意能访问外网的机器）："
echo "  curl -x http://4fu1768rz202.vicp.fun:$PROXY_PORT https://api.stlouisfed.org -I"
echo "  或用国内接口测试："
echo "  curl -x http://4fu1768rz202.vicp.fun:$PROXY_PORT https://push2.eastmoney.com -I"
