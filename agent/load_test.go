package main

import "testing"

func TestParseLoadAvg(t *testing.T) {
	got, err := parseLoadAvg("0.15 0.10 0.05 1/500 12345")
	if err != nil {
		t.Fatalf("正常输入不应报错：%v", err)
	}
	if got != (LoadStats{Load1: 0.15, Load5: 0.10, Load15: 0.05}) {
		t.Fatalf("前三列解析错误：%+v", got)
	}
	if _, err := parseLoadAvg("0.15"); err == nil {
		t.Fatal("字段不足应报错")
	}
	if _, err := parseLoadAvg("a b c"); err == nil {
		t.Fatal("非数字应报错")
	}
	if _, err := parseLoadAvg(""); err == nil {
		t.Fatal("空内容应报错")
	}
}
