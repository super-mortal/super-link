package main

import (
	"testing"
	"time"
)

func TestBackoffNext(t *testing.T) {
	b := &Backoff{}

	// 首次退避应为初始档 1s ± 抖动（±20%）
	first := b.Next()
	if first < 800*time.Millisecond || first > 1200*time.Millisecond {
		t.Fatalf("首次退避应落在 [0.8s, 1.2s]，实际 %v", first)
	}

	// 连续退避应指数增长并在 60s 封顶：第 6 次起达到上限档
	prev := first
	for i := 0; i < 10; i++ {
		got := b.Next()
		// 允许抖动带来的轻微回退（相邻档位 2 倍关系，±20% 抖动不会倒挂）
		if got < prev/2 {
			t.Fatalf("第 %d 次退避 %v 相对上次 %v 异常缩小", i, got, prev)
		}
		prev = got
	}
	if prev < 48*time.Second || prev > 72*time.Second {
		t.Fatalf("达到上限后退避应稳定在 60s ± 抖动，实际 %v", prev)
	}

	// 达到上限后继续保持上限，不再增长
	for i := 0; i < 5; i++ {
		got := b.Next()
		if got < 48*time.Second || got > 72*time.Second {
			t.Fatalf("封顶后退避应仍在 60s ± 抖动，实际 %v", got)
		}
	}
}

func TestBackoffReset(t *testing.T) {
	b := &Backoff{}
	b.Next()
	b.Next()

	b.Reset()

	again := b.Next()
	if again < 800*time.Millisecond || again > 1200*time.Millisecond {
		t.Fatalf("Reset 后应回到初始档 1s ± 抖动，实际 %v", again)
	}
}
