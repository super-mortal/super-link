package main

import "testing"

func TestParseUptime(t *testing.T) {
	// 第一列秒（小数截断取整）；第二列空闲秒不解析
	got, err := parseUptime("12345.67 987.65")
	if err != nil {
		t.Fatalf("正常输入不应报错：%v", err)
	}
	if got != 12345 {
		t.Fatalf("应截断为 12345，实际 %d", got)
	}
	if got, err := parseUptime("0.00 0.00"); err != nil || got != 0 {
		t.Fatalf("0 秒应返回 0，实际 %d err=%v", got, err)
	}
	if _, err := parseUptime(""); err == nil {
		t.Fatal("空内容应报错")
	}
	if _, err := parseUptime("abc def"); err == nil {
		t.Fatal("非数字应报错")
	}
}
