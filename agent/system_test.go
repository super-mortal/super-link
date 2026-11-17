package main

import "testing"

func TestParseOSRelease(t *testing.T) {
	// 优先 PRETTY_NAME
	got := parseOSRelease("NAME=\"Ubuntu\"\nPRETTY_NAME=\"Ubuntu 24.04.1 LTS\"\nID=ubuntu\n")
	if got != "Ubuntu 24.04.1 LTS" {
		t.Fatalf("应取 PRETTY_NAME，实际 %q", got)
	}
	// 无 PRETTY_NAME 时回退 NAME
	got = parseOSRelease("NAME=Alpine Linux\nID=alpine\n")
	if got != "Alpine Linux" {
		t.Fatalf("应回退 NAME，实际 %q", got)
	}
	// 两者都缺失时回退通用名
	got = parseOSRelease("ID=debian\n")
	if got != "Linux" {
		t.Fatalf("应回退 Linux，实际 %q", got)
	}
	// 单引号值同样剥除
	got = parseOSRelease("PRETTY_NAME='Fedora 42'\n")
	if got != "Fedora 42" {
		t.Fatalf("单引号值应剥除引号，实际 %q", got)
	}
}
