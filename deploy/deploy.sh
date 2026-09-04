#!/usr/bin/env bash
# ClipVault 一键部署脚本（Ubuntu 22.04）
# 用法：将整个 clipvault 目录上传到服务器后执行  sudo bash deploy/deploy.sh
set -e

SERVER_IP=${1:-$(curl -s ifconfig.me || hostname -I | awk '{print $1}')}
echo "==> 服务器公网 IP: ${SERVER_IP}"

echo "==> 1/5 安装系统依赖"
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip nginx git >/dev/null

echo "==> 2/5 准备应用目录"
mkdir -p /opt/clipvault
rsync -a --exclude deploy --exclude .git ./ /opt/clipvault/ 2>/dev/null || cp -r . /opt/clipvault/
cd /opt/clipvault
python3 -m venv venv
./venv/bin/pip install --quiet -r requirements.txt

echo "==> 3/5 配置 systemd 服务"
sed "s|YOUR_SERVER_IP|${SERVER_IP}|" deploy/clipvault.service > /etc/systemd/system/clipvault.service 2>/dev/null || true
# 若 deploy 目录未随拷贝，则使用仓库内默认模板
[ -f /etc/systemd/system/clipvault.service ] || {
  cat > /etc/systemd/system/clipvault.service <<EOF
[Unit]
Description=ClipVault cloud clipboard service
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/clipvault
Environment=BASE_URL=http://${SERVER_IP}
ExecStart=/opt/clipvault/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
}
chown -R www-data:www-data /opt/clipvault || chown -R nobody:nogroup /opt/clipvault
systemctl daemon-reload
systemctl enable --now clipvault

echo "==> 4/5 配置 Nginx 反向代理"
cp deploy/nginx.conf /etc/nginx/sites-available/clipvault 2>/dev/null || true
[ -f /etc/nginx/sites-available/clipvault ] || {
  cat > /etc/nginx/sites-available/clipvault <<EOF
server {
    listen 80;
    server_name _;
    client_max_body_size 100m;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
    location /api/files/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_read_timeout 300s;
        proxy_buffering off;
    }
}
EOF
}
ln -sf /etc/nginx/sites-available/clipvault /etc/nginx/sites-enabled/clipvault
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> 5/5 完成！"
echo ""
echo "    访问地址:  http://${SERVER_IP}"
echo "    服务状态:  systemctl status clipvault"
echo "    查看日志:  journalctl -u clipvault -f"
