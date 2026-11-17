package main

import "testing"

// df -P -k 输出 fixture（覆盖：真实块设备 / tmpfs / udev / squashfs / proc /
// 零块设备 / bind mount / 挂载点含空格）
const dfFixture = `Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/sda1        41251136  12345678  26884320      32% /
/dev/sdb1        41251136  12345678  26884320      32% /data
/dev/sdb1        41251136  12345678  26884320      32% /bind-of-data
tmpfs               999988         0    999988       0% /dev/shm
udev               16305712         0  16305712       0% /dev
squashfs            100000     50000     50000      50% /snap/core
proc                      0         0         0        - /proc
/dev/sdc1                0         0         0        - /mnt/empty
/dev/sdd1           100000     40000     60000      40% /mnt/my disk
`

// /proc/self/mountinfo fixture：major:minor + fstype + 八进制转义挂载点
const mountinfoFixture = `25 30 0:22 / / rw,relatime - ext4 /dev/sda1 rw
26 30 0:23 / /data rw,relatime - ext4 /dev/sdb1 rw
27 30 0:23 / /bind-of-data rw,relatime - ext4 /dev/sdb1 rw
29 25 0:5 / /dev/shm rw,nosuid,nodev - tmpfs tmpfs rw
30 25 0:1 / /proc rw,nosuid,nodev - proc proc rw
31 25 0:24 / /mnt/empty rw,relatime - ext4 /dev/sdc1 rw
32 25 8:1 / /mnt/my\040disk rw,relatime shared:7 master:1 - ext4 /dev/sdd1 rw
`

func TestParseDfOutput(t *testing.T) {
	entries := parseDfOutput(dfFixture)
	// 表头第二列非数字，被自然跳过；共 9 行数据
	if len(entries) != 9 {
		t.Fatalf("应解析出 9 行（表头被跳过），实际 %d", len(entries))
	}
	first := entries[0]
	if first.source != "/dev/sda1" || first.mount != "/" {
		t.Fatalf("首行解析错误：%+v", first)
	}
	// -k 单位：1024 块 × 1024 字节
	if first.total != 41251136*1024 || first.used != 12345678*1024 {
		t.Fatalf("块数换算错误：%+v", first)
	}
	// 挂载点含空格：第 6 列起整体作为挂载点
	last := entries[len(entries)-1]
	if last.mount != "/mnt/my disk" {
		t.Fatalf("含空格挂载点解析错误：%q", last.mount)
	}
}

func TestParseMountinfo(t *testing.T) {
	mounts := parseMountinfoContent(mountinfoFixture)
	if len(mounts) != 7 {
		t.Fatalf("应解析出 7 个挂载点，实际 %d", len(mounts))
	}
	root := mounts["/"]
	if root.fsType != "ext4" || root.majorMinor != "0:22" {
		t.Fatalf("根挂载点解析错误：%+v", root)
	}
	// 可选字段（shared:7 master:1）不影响定位；挂载点转义应还原
	my := mounts["/mnt/my disk"]
	if my.fsType != "ext4" || my.majorMinor != "8:1" {
		t.Fatalf("带可选字段与转义挂载点的行解析错误：%+v", my)
	}
}

func TestFilterDiskEntries(t *testing.T) {
	mounts := parseMountinfoContent(mountinfoFixture)
	disks := filterDiskEntries(parseDfOutput(dfFixture), mounts)

	// 预期只剩 3 个：/（0:22）、/data（0:23 首个）、/mnt/my disk（8:1）
	// /bind-of-data 按 major:minor 去重；/dev/shm 按 fstype(tmpfs) 排除；
	// /dev 按 df 源列名(udev) 兜底排除；/snap/core 按源列名(squashfs) 兜底；
	// /proc 按 fstype 排除；/mnt/empty 零块设备排除
	if len(disks) != 3 {
		t.Fatalf("应剩 3 个真实块设备挂载点，实际 %d：%+v", len(disks), disks)
	}
	if disks[0].Mount != "/" || disks[0].Total != 41251136*1024 || disks[0].Used != 12345678*1024 {
		t.Fatalf("根分区结果错误：%+v", disks[0])
	}
	if disks[1].Mount != "/data" {
		t.Fatalf("第二个应为 /data（/bind-of-data 被 major:minor 去重），实际 %q", disks[1].Mount)
	}
	if disks[2].Mount != "/mnt/my disk" {
		t.Fatalf("含空格挂载点应保留，实际 %q", disks[2].Mount)
	}
}

func TestFilterDiskEntriesWithoutMountinfo(t *testing.T) {
	// mountinfo 整体缺失（读不到）时：按 df 源列名兜底排除，不去重——
	// bind mount 会重复出现，但「宁留勿丢」，Hub 对重复 mount 有拒包保护
	disks := filterDiskEntries(parseDfOutput(dfFixture), nil)
	mounts := make([]string, 0, len(disks))
	for _, d := range disks {
		mounts = append(mounts, d.Mount)
	}
	// /dev/shm(tmpfs)、/dev(udev)、/snap/core(squashfs) 被源列名兜底排除；
	// /proc 源列名排除 + 零块；/mnt/empty 零块排除；其余 4 行（含 bind 副本）保留
	if len(disks) != 4 {
		t.Fatalf("无 mountinfo 时应剩 4 行（含 bind 副本），实际 %d：%v", len(disks), mounts)
	}
}

func TestUnescapeMountPath(t *testing.T) {
	cases := map[string]string{
		`/mnt/my\040disk`: "/mnt/my disk",
		`/a\011b`:         "/a\tb",
		`/a\012b`:         "/a\nb",
		`/a\134b`:         `/a\b`,
		"/plain":          "/plain",
	}
	for in, want := range cases {
		if got := unescapeMountPath(in); got != want {
			t.Fatalf("unescapeMountPath(%q) 应为 %q，实际 %q", in, want, got)
		}
	}
}
