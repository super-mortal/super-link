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

## 目录结构（核心）

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

## 许可证

本项目遵循 MIT License
