package main

import (
	"bufio"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"
	"time"
)

// 配置路径与键名：与 agent/install-agent.sh 写入的配置严格一致（该脚本是
// 单一事实源：KEY=VALUE 行，HUB_URL 与 AGENT_TOKEN 两个键）。
// systemd unit 另以 EnvironmentFile=-/etc/link-agent/config 把同一文件
// 注入环境变量作为双保险，因此正常情况下环境变量与文件值同源。
const (
	// defaultConfigPath 默认配置文件路径（安装脚本固定写入该路径）
	defaultConfigPath = "/etc/link-agent/config"
	// envHubURL / envAgentToken 环境变量键名：优先级高于配置文件，
	// 与安装脚本命令行参数 / 环境变量兜底的命名一致
	envHubURL     = "HUB_URL"
	envAgentToken = "AGENT_TOKEN"
)

// Config link-agent 运行配置
type Config struct {
	// HubURL super-link（Hub）对外地址（安装脚本写入时已去尾斜杠）
	HubURL string
	// AgentToken 本机专属认证凭据：只走 X-Agent-Token 请求头，服务端
	// 只存哈希，不明文落库（PRD §5.6 / 决策 D6）
	AgentToken string
	// CollectInterval 采集周期（默认 300s，决策 D4）：仅作本地参考值，
	// 实际采集由 Hub 经长连接下发指令控制，agent 不自行定时采集
	CollectInterval time.Duration
	// ConnectTimeout 长轮询单次连接超时（默认 70s）：须大于 Hub 的单次
	// 持有上限 50s（controllers/AgentConnectController.php HOLD_SECONDS），
	// 留 20s 余量给建连与网络抖动；到点按「正常到期」重连即可
	ConnectTimeout time.Duration
	// RequestTimeout 普通请求（回传快照等）超时（默认 30s）
	RequestTimeout time.Duration
}

// DefaultConfig 返回默认配置（未读取任何来源前的基线）
func DefaultConfig() Config {
	return Config{
		HubURL:          "",
		AgentToken:      "",
		CollectInterval: 300 * time.Second,
		ConnectTimeout:  70 * time.Second,
		RequestTimeout:  30 * time.Second,
	}
}

// LoadConfig 按优先级加载配置（优先级：环境变量 > 配置文件）：
//
//  1. 解析配置文件（默认 /etc/link-agent/config，KEY=VALUE 行格式）；
//  2. 环境变量 HUB_URL / AGENT_TOKEN 覆盖（便于临时调试免改配置文件）；
//  3. 规范化 HubURL（去尾斜杠，避免拼出 //api/agent/connect）并校验协议头；
//  4. 必填项（HubURL / AgentToken）缺失即报错，由调用方退出。
//
// 配置文件不存在不算错误（systemd 的 EnvironmentFile 带 - 前缀，允许仅靠
// 环境变量启动）；读取权限等其它错误照实返回。
func LoadConfig(path string) (Config, error) {
	cfg := DefaultConfig()

	values, err := parseConfigFile(path)
	if err != nil {
		return Config{}, err
	}
	cfg.HubURL = values[envHubURL]
	cfg.AgentToken = values[envAgentToken]

	if v := strings.TrimSpace(os.Getenv(envHubURL)); v != "" {
		cfg.HubURL = v
	}
	if v := strings.TrimSpace(os.Getenv(envAgentToken)); v != "" {
		cfg.AgentToken = v
	}

	if cfg.HubURL == "" {
		return Config{}, fmt.Errorf("缺少必填配置 %s（配置文件 %s 或环境变量 %s 均未提供）", envHubURL, path, envHubURL)
	}
	if cfg.AgentToken == "" {
		return Config{}, fmt.Errorf("缺少必填配置 %s（配置文件 %s 或环境变量 %s 均未提供）", envAgentToken, path, envAgentToken)
	}

	// 与安装脚本同一处理：去尾斜杠 + 校验 http(s) 协议头
	cfg.HubURL = strings.TrimRight(cfg.HubURL, "/")
	if !strings.HasPrefix(cfg.HubURL, "http://") && !strings.HasPrefix(cfg.HubURL, "https://") {
		return Config{}, fmt.Errorf("%s 格式不正确：%q（应以 http:// 或 https:// 开头）", envHubURL, cfg.HubURL)
	}

	return cfg, nil
}

// parseConfigFile 解析 KEY=VALUE 行格式的配置文件：
//   - 忽略空行与 # 注释行；
//   - 键值两侧空白与成对引号（'x' / "x"）会被剥除，兼容手写与 shell 习惯；
//   - 重复键以后出现的为准（与安装脚本重装覆盖语义一致）；
//   - 无法解析的行（无 =）静默跳过：不因单行脏数据让守护进程起不来。
func parseConfigFile(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return map[string]string{}, nil
		}
		return nil, fmt.Errorf("读取配置文件失败：%s（%w）", path, err)
	}
	defer f.Close()

	values := make(map[string]string)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		values[key] = unquote(strings.TrimSpace(value))
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("读取配置文件失败：%s（%w）", path, err)
	}
	return values, nil
}

// unquote 剥除值两侧的成对引号（'x' 或 "x"）：systemd EnvironmentFile 与
// 常见手写配置都允许带引号，安装脚本写入的裸值不受影响
func unquote(s string) string {
	if len(s) >= 2 {
		first, last := s[0], s[len(s)-1]
		if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
			return s[1 : len(s)-1]
		}
	}
	return s
}
