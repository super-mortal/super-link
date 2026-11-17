<div align="center">

# super-link

![Version](https://img.shields.io/badge/dynamic/json?url=https://raw.githubusercontent.com/super-mortal/super-link/main/app-info.json&label=version&query=%24.version&color=blue) ![License](https://img.shields.io/badge/license-MIT-green) ![PHP](https://img.shields.io/badge/PHP-8%2B-777BB4?logo=php&logoColor=white) ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white) ![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white) ![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white) ![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

> **超级链接，连接你的一切。**

</div>

super-link 是一个自托管的个人数据管理工具，用来保存、整理和检索你的网络内容。从书签管理开始，并会持续扩展更多能力。数据完全由自己掌控。

## 项目简介

- 首个版本发布于 2026-10-20
- 自托管部署，数据保存在服务器
- 支持标签管理、嵌套标签、筛选与搜索
- 支持书签标题/描述管理
- 支持从浏览器、Pocket、Raindrop.io 导入书签
- 支持 PWA 安装

## 技术栈

- 前端:React + TypeScript + Vite
- 后端:PHP 8 + Apache
- 数据库:SQLite(默认数据库文件在 `storage/link_navigator.db`)
- 部署:Docker Compose

## 一键部署（推荐）

适合小白的最简流程（复制执行即可，自动拉取 CI 预构建镜像，无需本地构建）：

```bash
git clone https://github.com/super-mortal/super-link.git
cd super-link
docker compose up -d
# 部署完成后访问http://你的服务器IP:4124
```

查看运行状态：

```bash
docker ps | grep web-app
```

查看日志：

```bash
docker logs -f web-app
```

停止服务：

```bash
docker compose down
```

重新启动：

```bash
docker compose up -d
```

默认端口：

- HTTP: `4124`

也可临时覆盖：

```bash
PORT=4124 docker compose up -d
```

如需从源码本地构建（二次开发场景），使用构建覆盖文件：

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## 后续更新部署

在服务器项目目录中执行以下命令：

```bash
cd /root/super-link
git pull
docker compose pull
docker compose up -d
```

也可以在应用内一键更新（见下节），无需登录服务器。

## 应用内一键更新

当 GitHub 上发布了新版本（推送 `v` 开头的标签即自动构建镜像），设置 → 关于页会提示"有可用更新"，点击**立即更新**即可自动拉取新镜像并重启应用，无需登录服务器操作。

- 更新由内置的 [Watchtower](https://github.com/nicholas-fedor/watchtower) 服务完成，仅在你点击时触发，不会自动更新
- 更新过程约 10-30 秒，页面会自动刷新
- 旧镜像自动清理，不占磁盘

安全说明：Watchtower 的 API 仅在 Docker 内部网络可达，不对外暴露端口。默认 token 为 `super-link-watchtower-token`，建议设置自己的 token（在项目目录的 `.env` 文件中）：

```bash
echo "WATCHTOWER_TOKEN=$(openssl rand -base64 24)" >> .env
docker compose up -d
```

## GitHub 网络访问（境内服务器）

Skill 安装、检查更新与应用版本检查都依赖 GitHub。境内服务器直连 GitHub 可能超时或失败，可在**设置 → 网络**按三档策略调整：

| 策略 | 行为 |
| --- | --- |
| 自动（推荐） | 优先直连，10 秒内失败后再尝试代理 |
| 始终使用代理 | 所有 GitHub 请求都经代理访问 |
| 不使用代理 | 只直连 github.com，不使用代理 |

- **代理地址**：路径前缀格式，例如 `https://gh-proxy.com/`；仅支持 `https://`，且只作用于 `github.com` / `codeload.github.com`，不影响书签、账号库等其他网络请求
- **测试连接**：只对目标发起 HEAD 探测，返回可达性与耗时，不会真正下载仓库
- **版本检查**：关闭后不再请求 `api.github.com`，关于页只显示本地版本
- 策略保存后写入数据库；环境变量仅作为初始默认值（`.env`）：

```bash
GITHUB_ACCESS_MODE=auto        # auto / proxy / direct
GITHUB_PROXY_PREFIX=https://你的代理域名/
APP_UPDATE_CHECK=true          # 设为 false 后关于页不再请求 GitHub
```

> 第三方公共代理只做 URL 前缀转发，可用性与隐私不受控，长期使用建议自建代理。

## 服务器监控

super-link 内置服务器监控模块（PRD：[docs/prd/server.md](docs/prd/server.md)），用来集中查看多台自托管机器的运行状况。架构为 Hub（super-link 后端）+ link-agent（被监控机上的 Go 静态二进制守护进程）：agent 主动外连 Hub 并保持长连接，每 5 分钟回传一次指标，NAT 后无需公网 IP，也不依赖 SSH 凭据。列表页展示在线 / 离线 / 已暂停 / 等待连接四态与 CPU / 内存 / 磁盘概览，详情页提供趋势图表、各挂载点磁盘用量与 Docker 容器资源占用；历史明细保留 30 天。

接入一台被监控的 Linux 机器：在「添加服务器」弹窗内填入名称与分组，生成后会给出含 Token 的一行安装命令，一键复制到被监控机执行即可（自动识别 amd64 / arm64 架构、下载二进制并校验 SHA-256、注册为 systemd 服务 `link-agent.service`，开机自启、崩溃自动重启）：

```bash
curl -fsSL "<Hub 地址>/content/install-agent" | sudo bash -s -- --hub-url "<Hub 地址>" --token "<Agent Token>"
```

- 重装或更换机器：在详情页「重置 Token」，弹窗会给出含新 Token 的完整命令
- agent 侧细节（配置项、指标口径、构建方式）见 [agent/README.md](agent/README.md)

发布产物：推送 `vX.Y.Z` tag 时，CI 除 Docker 镜像外还会交叉编译 `link-agent-linux-amd64` / `link-agent-linux-arm64` 及同名 `.sha256` 校验文件，挂同一 GitHub Release；agent 版本随主版本，不做独立版本线。

> **部署注意**：agent 与 Hub 之间是长轮询长连接（单次持有约 50 秒）。若 Hub 前置 nginx / Caddy 等反向代理，需调大 `proxy_read_timeout`（建议 70 秒以上），否则连接会被反代定时掐断、服务器频繁掉线；未前置反代时无此限制。

## 目录结构（核心）

- `agent/`：link-agent 被监控端（Go 源码与安装脚本，见「服务器监控」）
- `controllers/`：后端控制器
- `frontend/`：前端源码
- `framework/`：后端框架核心
- `models/`：数据模型与仓储
- `public/`：公开静态资源
- `storage/`：数据库文件目录
- `utils/`：工具函数与导入逻辑
- `views/`：页面模板

## 数据存储说明

- 当前使用 SQLite
- 默认数据库文件：`storage/link_navigator.db`
- 生产环境通过 Docker Volume 持久化（重建容器不会丢失数据）
- 宿主机永久存储路径（默认）：
  - `/var/lib/docker/volumes/super-link_super-link-storage/_data/link_navigator.db`

## 致谢

- [denho/faved](https://github.com/denho/faved) v2.9.0（2026-03-30）为本项目提供部分 UI 设计与书签系统设计思路
- [henrygd/beszel](https://github.com/henrygd/beszel)（MIT）为「服务器监控」模块提供架构与设计参考：Hub + Agent 长连接形态、系统卡片的信息层级与指标口径（CPU / 内存 / 磁盘 / 网络 / Docker 的统计方式）；本项目为其思想的独立实现，未拷贝其代码

## 许可证

本项目遵循 MIT License
