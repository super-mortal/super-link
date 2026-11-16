#!/usr/bin/env bash
#
# link-agent 安装脚本（super-link 服务器监控模块，PRD: docs/prd/server.md §5.2 / D2 / D12）
#
# 用法（由 super-link「添加服务器 / 重置 Token」弹窗生成，一键复制到被监控机执行）：
#   curl -fsSL "<Hub 地址>/content/install-agent" | sudo bash -s -- --hub-url "<Hub 地址>" --token "<Agent Token>"
#
# 流程：识别 CPU 架构（amd64 / arm64）→ 从 GitHub Release 下载对应静态二进制并校验
# SHA-256 → 安装到 /usr/local/bin/link-agent → 写入配置 /etc/link-agent/config
# （HUB_URL 与 AGENT_TOKEN）→ 注册并启动 systemd 服务 link-agent.service。
# 重复执行即重装：覆盖二进制与配置后重启服务（PRD §5.1 重置 Token 的重装语义）。
#
# 依赖：curl、systemd、coreutils（install / mktemp / sha256sum / head），均为被监控
# Linux 标配；不依赖 SSH 与其他任何凭据。
#
# 本文件是单一事实源：Hub 的 /content/install-agent 内容路由直接返回本脚本
# （Apache 已有 /content/* → api/index.php 的 rewrite，PRD §5.2）；CI 发布
# link-agent 双架构二进制时，资产命名也以本脚本为准（决策 D12：随主版本 vX.Y.Z
# 同一 GitHub Release 发布 link-agent-linux-amd64 / link-agent-linux-arm64）。

set -euo pipefail

# ---------------------------------------------------------------- 常量与默认值

BIN_NAME='link-agent'
INSTALL_PATH='/usr/local/bin/link-agent'
CONFIG_DIR='/etc/link-agent'
CONFIG_PATH="${CONFIG_DIR}/config"
SERVICE_NAME='link-agent.service'
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}"

# 二进制下载源：GitHub Release 的 latest/download 固定地址，与主版本 tag 联动。
# 可用环境变量 RELEASE_BASE 覆盖（自建镜像源 / 代理镜像），资产名见决策 D12。
RELEASE_BASE="${RELEASE_BASE:-https://github.com/super-mortal/super-link/releases/latest/download}"

# Hub 注入的默认地址：Hub 的 /content/install-agent 路由下发本脚本时，可通过文本
# 替换把 __HUB_URL__ 占位符替换为实际 Hub 地址（PRD §5.2「可顺带注入 Hub 地址」），
# 被监控机即使漏传 --hub-url 也能安装；未被替换时（值仍以 __ 开头）视为未注入，
# 继续向环境变量与报错逻辑回落。
INJECTED_HUB_URL='__HUB_URL__'
case "${INJECTED_HUB_URL}" in
__*) INJECTED_HUB_URL='' ;;
esac

# ------------------------------------------------------------------ 工具函数

err() {
  printf '[错误] %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
用法：
  curl -fsSL "<Hub 地址>/content/install-agent" | sudo bash -s -- --hub-url "<Hub 地址>" --token "<Agent Token>"

参数：
  --hub-url <url>   super-link（Hub）对外地址，如 https://link.example.com
  --token <token>   Agent Token，在 super-link「添加服务器 / 重置 Token」弹窗内获取

环境变量兜底（优先级：命令行参数 > 环境变量 > Hub 注入地址 > 报错）：
  HUB_URL=<url> AGENT_TOKEN=<token> bash install-agent.sh

可选环境变量：
  RELEASE_BASE   二进制下载源，默认取 GitHub Releases（见脚本内注释）
EOF
}

# ------------------------------------------------------------------ 参数解析

HUB_URL_ARG=''
TOKEN_ARG=''
while [ $# -gt 0 ]; do
  case "$1" in
  --hub-url)
    # 漏传参数值（--hub-url 位于命令末尾）时报错退出
    [ $# -ge 2 ] || err "--hub-url 缺少参数值，正确用法：--hub-url <url>"
    HUB_URL_ARG="$2"
    shift 2
    ;;
  --token)
    [ $# -ge 2 ] || err "--token 缺少参数值，正确用法：--token <token>"
    TOKEN_ARG="$2"
    shift 2
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    err "未知参数：$1"
    ;;
  esac
done

# 空值参数（如 --hub-url ""）视为未提供，继续向下回落，最终由下方非空校验收口
HUB_URL="${HUB_URL_ARG:-${HUB_URL:-${INJECTED_HUB_URL:-}}}"
AGENT_TOKEN="${TOKEN_ARG:-${AGENT_TOKEN:-}}"

if [ -z "$HUB_URL" ] || [ -z "$AGENT_TOKEN" ]; then
  usage >&2
  err "缺少 Hub 地址或 Agent Token：请通过 --hub-url / --token 参数（或 HUB_URL / AGENT_TOKEN 环境变量）提供"
fi

# 去掉尾斜杠，避免 agent 拼出双斜杠路径（如 //api/agent/connect）
HUB_URL="${HUB_URL%/}"
case "$HUB_URL" in
http://* | https://*) ;;
*) err "Hub 地址格式不正确：${HUB_URL}（应以 http:// 或 https:// 开头）" ;;
esac

# ------------------------------------------------------------------ 环境检查

# root 检查：安装涉及 /usr/local/bin、/etc 与 systemd，必须 root
if [ "$(id -u)" -ne 0 ]; then
  usage >&2
  err "本脚本需要 root 权限，请按上方用法加 sudo 重新执行"
fi

command -v curl >/dev/null 2>&1 || err "未找到 curl，请先安装（如 apt install curl / yum install curl）"
command -v systemctl >/dev/null 2>&1 || err "未找到 systemctl：link-agent 由 systemd 托管（PRD D2），请在使用 systemd 的 Linux 系统上运行"
# systemctl 存在但 systemd 未作为 PID 1 运行时（如部分容器环境），后续命令必然失败，提前给出明确原因
[ -d /run/systemd/system ] || err "systemd 尚未运行（/run/systemd/system 不存在）：请在正常运行 systemd 的 Linux 主机上执行"

# ------------------------------------------------------------------ 架构识别

# 首版仅支持 Linux 被监控端（PRD D8）：数据源为 /proc 与标准命令
OS_NAME="$(uname -s)"
[ "$OS_NAME" = 'Linux' ] || err "不支持的操作系统：${OS_NAME}。首版仅支持 Linux（PRD D8）"

MACHINE="$(uname -m)"
case "${MACHINE}" in
x86_64 | amd64) ARCH='amd64' ;;
aarch64 | arm64) ARCH='arm64' ;;
*) err "不支持的 CPU 架构：${MACHINE}。当前仅支持 linux/amd64（x86_64）与 linux/arm64（aarch64/arm64）" ;;
esac
printf '识别到系统：%s / %s -> linux/%s\n' "$OS_NAME" "$MACHINE" "$ARCH"

# ------------------------------------------------------------------ 下载与校验

ASSET="${BIN_NAME}-linux-${ARCH}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

printf '下载 link-agent（%s）...\n' "$ASSET"
# curl -f：HTTP 错误（如 Release 尚未发布二进制时的 404）直接失败，不把错误页当作二进制
curl -fsSL "${RELEASE_BASE}/${ASSET}" -o "${TMP_DIR}/${ASSET}" ||
  err "下载失败：${RELEASE_BASE}/${ASSET}（请检查网络；访问 GitHub 可能需要代理，见文件末尾说明）"

# SHA-256 校验：校验文件与二进制同 Release（link-agent-linux-<arch>.sha256，
# 内容为 sha256sum 输出：64 位十六进制摘要，可带「  文件名」后缀）。
# CI 发布流水线需在同一 Release 产出该校验文件（task20 的 CI 任务补齐，例如
# sha256sum link-agent-linux-amd64 > link-agent-linux-amd64.sha256）。
# 校验文件缺失或格式不符时选择「拒绝安装」而非放行：本脚本以 root 安装常驻守护
# 进程并写入含凭据的配置，「装不上」远好于「装上被篡改或损坏的二进制」；且失败
# 信息已给出手动核对入口，不会让用户无措。
printf '下载 SHA-256 校验文件（%s.sha256）...\n' "$ASSET"
curl -fsSL "${RELEASE_BASE}/${ASSET}.sha256" -o "${TMP_DIR}/${ASSET}.sha256" ||
  err "下载校验文件失败：${RELEASE_BASE}/${ASSET}.sha256（Release 资产不完整或网络不通；拒绝在无校验的情况下安装）"

# 解析期望摘要：取首行第一个空白分隔字段（兼容「纯摘要」与「摘要  文件名」两种
# 格式），并去掉可能的 CR（编辑器 / Windows 生成的尾 \r）
CHECKSUM_LINE="$(head -n 1 "${TMP_DIR}/${ASSET}.sha256")"
CHECKSUM_LINE="${CHECKSUM_LINE%$'\r'}"
EXPECTED="${CHECKSUM_LINE%%[[:space:]]*}"
EXPECTED="${EXPECTED,,}"
[[ "$EXPECTED" =~ ^[0-9a-f]{64}$ ]] ||
  err "校验文件格式不正确（未解析到 64 位十六进制摘要）：${RELEASE_BASE}/${ASSET}.sha256"

ACTUAL="$(sha256sum "${TMP_DIR}/${ASSET}")"
ACTUAL="${ACTUAL%%[[:space:]]*}"
ACTUAL="${ACTUAL,,}"

if [ "$EXPECTED" != "$ACTUAL" ]; then
  err "SHA-256 校验失败（期望 ${EXPECTED}，实际 ${ACTUAL}）：下载可能被篡改或损坏，请从 ${RELEASE_BASE} 手动核对后重试"
fi
printf 'SHA-256 校验通过：%s\n' "$ACTUAL"

# ------------------------------------------------------------------ 安装

printf '安装二进制到 %s ...\n' "$INSTALL_PATH"
install -m 755 "${TMP_DIR}/${ASSET}" "$INSTALL_PATH"

printf '写入配置 %s ...\n' "$CONFIG_PATH"
mkdir -p "$CONFIG_DIR"
# 配置文件含凭据（HUB_URL 与 AGENT_TOKEN）：先在 umask 077 下落盘（出生即 600），
# 再显式 chmod 600 兜底；顺序必须是「先写后 chmod」
(umask 077 && printf 'HUB_URL=%s\nAGENT_TOKEN=%s\n' "$HUB_URL" "$AGENT_TOKEN" >"$CONFIG_PATH")
chmod 600 "$CONFIG_PATH"

# ------------------------------------------------------------------ systemd 服务

printf '写入 systemd 单元 %s ...\n' "$SERVICE_PATH"
cat >"$SERVICE_PATH" <<EOF
[Unit]
Description=super-link 服务器监控 Agent（link-agent）
# 等待网络就绪后再启动：agent 启动即主动外连 Hub 并保持长连接（PRD D11）
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${INSTALL_PATH}
# 配置 /etc/link-agent/config 由 agent 直接读取；EnvironmentFile 同步注入为环境
# 变量作为双保险（前缀 - 表示文件缺失时不阻断启动，配置缺失由 agent 自己报错）
EnvironmentFile=-${CONFIG_PATH}
# Restart=always：无论退出码如何都自动重启，兑现 D2「开机自启、崩溃自动重启」
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
chmod 644 "$SERVICE_PATH"

systemctl daemon-reload

# 重装语义：二进制与配置已被覆盖，服务若在运行必须 restart 才能让新二进制 /
# 新 Token 生效；首次安装走 enable --now，同时注册开机自启并立即启动
if systemctl is-active --quiet "$SERVICE_NAME"; then
  printf '检测到 %s 已在运行，重启以应用新版本 ...\n' "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
else
  printf '启用并启动 %s ...\n' "$SERVICE_NAME"
  systemctl enable --now "$SERVICE_NAME"
fi

# ------------------------------------------------------------------ 完成

printf '\n安装完成：\n'
printf '  二进制：%s\n' "$INSTALL_PATH"
printf '  配置：%s（HUB_URL 与 AGENT_TOKEN，含凭据，权限 600）\n' "$CONFIG_PATH"
printf '  服务：%s（开机自启，崩溃自动重启）\n\n' "$SERVICE_NAME"
printf '查看运行日志：journalctl -u %s -f\n\n' "$SERVICE_NAME"
systemctl --no-pager --full status "$SERVICE_NAME" || true

# 服务未能保持运行时以非零码退出，便于外层（如配置管理工具）感知失败
if ! systemctl is-active --quiet "$SERVICE_NAME"; then
  printf '[警告] %s 未能保持运行，请结合上方状态与 journalctl 输出排查。\n' "$SERVICE_NAME" >&2
  exit 1
fi

# ------------------------------------------------------------------ 网络代理说明
#
# 脚本内的 curl 自动读取 http_proxy / https_proxy / no_proxy 等标准环境变量，
# 无需为脚本单独适配。Hub 与 GitHub 均在境外时，中国大陆用户可能需要代理：
#   * 下载本脚本的外层 curl 以当前用户身份执行，代理环境变量自然生效；
#   * 脚本内部的 curl 运行在 sudo 之下，而 sudo 默认可能重置环境变量——可用
#     sudo -E 保留（安装命令改为 ... | sudo -E bash -s -- ...），或在
#     /etc/sudoers 的 env_keep 中加入 https_proxy；
#   * 也可用 RELEASE_BASE 指向可达的 GitHub 镜像源。
