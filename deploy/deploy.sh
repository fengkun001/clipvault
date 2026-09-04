#!/usr/bin/env bash
# ClipVault 一键部署脚本（Ubuntu 22.04）
# 用法：在项目根目录执行  sudo bash deploy/deploy.sh [公网IP]
# 如 pip 下载慢，先执行: export PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
set -e

SERVER_IP=${1:-$(curl -s ifconfig.me || hostname -I | awk '{print $1}')}
echo "==> 服务器公网 IP: ${SERVER_IP}"

echo "==> 1/5 安装系统依赖"
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip nginx rsync >/dev/null

echo "==> 2/4 同步代码到 /opt/clipvault 并安装 Python 依赖"
mkdir -p /opt/clipvault
# uploads/ 与数据库文件不同步，保证重复部署时线上数据不丢
rsync -a --delete \
  --exclude .git --exclude venv --exclude .venv \
  --exclude uploads --exclude '*.db' --exclude '__pycache__' --exclude '*.pyc' \
  ./ /opt/clipvault/
cd /opt/clipvault
[ -d venv ] || python3 -m venv venv
./venv/bin/pip install --quiet -r requirements.txt

echo "==> 3/5 配置 systemd 服务"
sed "s|YOUR_SERVER_IP|${SERVER_IP}|" deploy/clipvault.service > /etc/systemd/system/clipvault.service
mkdir -p /opt/clipvault/uploads
chown -R www-data:www-data /opt/clipvault
systemctl daemon-reload
systemctl enable clipvault
systemctl restart clipvault

echo "==> 4/5 配置 Nginx 反向代理"
cp deploy/nginx.conf /etc/nginx/sites-available/clipvault
ln -sf /etc/nginx/sites-available/clipvault /etc/nginx/sites-enabled/clipvault
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> 5/5 防火墙放行 80 端口"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null
  echo "==> ufw 已放行 80 端口"
else
  echo "==> ufw 未启用，跳过（请确认云安全组已放行 80）"
fi

echo ""
echo "    部署完成！访问地址:  http://${SERVER_IP}"
echo "    服务状态:  systemctl status clipvault"
echo "    查看日志:  journalctl -u clipvault -f"
