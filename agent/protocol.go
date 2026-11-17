// agent ↔ Hub 长轮询协议（协议基准：controllers/AgentConnectController.php
// 与 controllers/AgentReportController.php 的文件头注释，task6 / task7 交付，
// 两端按此对齐，禁止自行增删字段）
//
// 下行（Hub → agent）：GET /api/agent/connect 的 application/x-ndjson 响应，
// 按行读取的 JSON 流，共三种行：
//  1. 采集指令 {"cmd":"collect"}：agent 立即采集全量快照并经
//     POST /api/agent/report 回传（快照字段白名单见 AgentReportController）；
//  2. 保活空行：Hub 每秒写入一个空行并 flush，agent 跳过即可——空行同时让
//     Hub 借「写输出」感知 agent 断开（mod_php 下不写输出感知不到）；
//  3. 结束行 {"ok":true,"action":"reconnect"}：本次长轮询正常到期，agent
//     立即重连（长轮询语义，非错误，无需退避）；被后续连接挤占时结束行为
//     {"ok":true,"action":"reconnect","reason":"superseded"}，agent 按指数
//     退避重连，避免新旧两个 agent 互相挤占的热循环。
//
// 上行（agent → Hub）：POST /api/agent/report，body 为 JSON 对象快照，响应
// 信封 {"ok":true} / {"ok":false,"message"}（agent 态信封，与用户态 success
// 信封区分，见 dev-spec）。
//
// 凭据：两端都只走 X-Agent-Token 请求头（每服务器唯一，服务端只存哈希，
// PRD §5.6 / 决策 D6）。401 的响应体两端逐字节一致（Utils\AgentAuth 拉平，
// 防枚举），agent 无法也无需区分「Token 无效」与「服务器不存在」。

package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// agent 态端点路径与凭据请求头（与后端 routes.php 注册的路径一致）
const (
	// connectPath 长轮询接入端点（GET）：Hub 经此下发采集指令
	connectPath = "/api/agent/connect"
	// reportPath 快照回传端点（POST）
	reportPath = "/api/agent/report"
	// tokenHeader Agent Token 请求头：唯一凭据通道，不明文落库、不入日志
	tokenHeader = "X-Agent-Token"
)

// maxAckBytes 回传响应信封的读取上限（字节）：信封本体不到 200 字节，限量
// 读取防止前置反代错误页等异常响应把内存读爆（Hub 前置 nginx / Caddy 是
// 既有部署形态，见 AgentConnectController 对 X-Accel-Buffering 的说明）
const maxAckBytes = 4096

// agentCommand Hub 下发的采集指令行
type agentCommand struct {
	Cmd string `json:"cmd"` // "collect"：立即采集全量快照并回传
}

// agentFinish Hub 的结束行（长轮询到期 / 被挤占）
type agentFinish struct {
	Ok     bool   `json:"ok"`     // 恒 true
	Action string `json:"action"` // "reconnect"
	Reason string `json:"reason"` // "superseded"：被后续连接挤占；缺省为正常到期
}

// agentReportAck report 回传响应信封（200 {"ok":true}；400 / 500 {"ok":false,"message"}）
type agentReportAck struct {
	Ok      bool   `json:"ok"`
	Message string `json:"message"`
}

// streamEvent 一行 NDJSON 协议消息的分类结果
type streamEvent int

const (
	// eventSkip 保活空行或无法识别的行：跳过。无法识别的行跳过而非报错，
	// 保证 Hub 未来新增行类型时旧 agent 不断流（向前兼容）
	eventSkip streamEvent = iota
	// eventCollect 采集指令：采集全量快照并经 report 回传
	eventCollect
	// eventReconnect 正常到期：立即重连（长轮询语义，非错误，不退避）
	eventReconnect
	// eventSuperseded 被新连接挤占：退避后重连（防新旧 agent 热循环）
	eventSuperseded
)

// classifyStreamLine 分类一行 NDJSON 协议消息（纯函数，便于单测）
func classifyStreamLine(line []byte) streamEvent {
	trimmed := strings.TrimSpace(string(line))
	if trimmed == "" {
		return eventSkip // 保活空行：无语义，跳过
	}

	// 必须先判采集指令：{"cmd":"collect"} 也能无损解码进 agentFinish（缺失
	// 字段取零值），顺序颠倒会把指令误判成「未知行」而静默跳过
	var cmd agentCommand
	if err := json.Unmarshal([]byte(trimmed), &cmd); err == nil && cmd.Cmd == "collect" {
		return eventCollect
	}

	var finish agentFinish
	if err := json.Unmarshal([]byte(trimmed), &finish); err == nil && finish.Ok && finish.Action == "reconnect" {
		if finish.Reason == "superseded" {
			return eventSuperseded
		}
		return eventReconnect
	}

	return eventSkip
}

// readStreamEvent 从 Hub 的 ndjson 流读取下一条有语义的消息（bufio.Scanner
// 逐行读，保活空行在 classifyStreamLine 内部跳过，调用方不会收到 eventSkip）。
// 流干净结束返回 io.EOF（调用方按「没收过结束行」处理）；读取错误包装返回。
func readStreamEvent(scanner *bufio.Scanner) (streamEvent, error) {
	for scanner.Scan() {
		if ev := classifyStreamLine(scanner.Bytes()); ev != eventSkip {
			return ev, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return eventSkip, fmt.Errorf("读取指令流失败：%w", err)
	}
	return eventSkip, io.EOF
}

// newAgentRequest 构造 agent 态请求：GET connect 传 nil body；POST report 传
// JSON body（bytes.Reader，http 库据此自动设置 Content-Length）。
//
// 所有 agent 请求必须经 context 绑定——客户端不设总超时（见 newHTTPClient），
// 请求级 context 是取消的唯一通道：connectOnce 绑 run 的 ctx 兑现 SIGTERM
// 优雅退出，回传快照再由调用方包一层 WithTimeout 收紧。
func newAgentRequest(ctx context.Context, method, url, token string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set(tokenHeader, token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return req, nil
}

// readReportAck 读取并解析 report 的 200 响应信封（限量读取，见 maxAckBytes）
func readReportAck(body io.Reader) (agentReportAck, error) {
	raw, err := io.ReadAll(io.LimitReader(body, maxAckBytes))
	if err != nil {
		return agentReportAck{}, fmt.Errorf("读取回传响应失败：%w", err)
	}
	var ack agentReportAck
	if err := json.Unmarshal(raw, &ack); err != nil {
		return agentReportAck{}, fmt.Errorf("解析回传响应失败：%w（响应内容：%s）", err, truncateForLog(raw))
	}
	return ack, nil
}

// truncateForLog 截断用于错误消息的响应片段：反代错误页可能很大，日志里只留开头
func truncateForLog(b []byte) string {
	const max = 200
	s := strings.TrimSpace(string(b))
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}
