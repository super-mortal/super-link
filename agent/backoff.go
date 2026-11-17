package main

import (
	"math/rand/v2"
	"time"
)

// 指数退避参数（PRD §5.2「断线重连：由 agent 侧负责，指数退避重连」；
// dev-spec「Go agent 规范」：初始 1s、上限 60s 量级、加抖动）
const (
	// backoffInitial 初始退避时长
	backoffInitial = 1 * time.Second
	// backoffFactor 退避倍数
	backoffFactor = 2
	// backoffMax 退避上限
	backoffMax = 60 * time.Second
	// backoffJitter 抖动比例（±20%）：多台机器不会在同一时刻一起重连，
	// 避免重连风暴打爆 Hub
	backoffJitter = 0.2
)

// Backoff 指数退避计算器
//
// 每次失败退避翻倍直至 backoffMax，返回值叠加 ±20% 随机抖动；连接成功后
// Reset 归零。非并发安全：仅供连接循环（单 goroutine）使用。
type Backoff struct {
	// current 下一档退避基线（未加抖动）；0 表示尚未开始退避
	current time.Duration
}

// Next 返回本次应等待的退避时长（含抖动），并把内部档位前进一步。
// 首次调用返回初始档（1s ± 抖动）。
func (b *Backoff) Next() time.Duration {
	base := b.current
	if base <= 0 {
		base = backoffInitial
	}

	// 抖动系数 ∈ [1-jitter, 1+jitter)：math/rand/v2 自动播种，无需初始化
	jitterFactor := 1 + (rand.Float64()*2-1)*backoffJitter
	wait := time.Duration(float64(base) * jitterFactor)

	// 前进一步供下次使用，到顶后保持上限
	b.current = time.Duration(float64(base) * backoffFactor)
	if b.current > backoffMax {
		b.current = backoffMax
	}

	return wait
}

// Reset 连接成功后重置退避（长轮询正常到期不走退避，见 run 的注释）
func (b *Backoff) Reset() {
	b.current = 0
}
