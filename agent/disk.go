// 磁盘采集器（口径：PRD docs/prd/server.md §5.3「磁盘」；对照 beszel
// agent/disk.go 的真实设备过滤思路）
//
// 数据源组合（PRD 定稿 df -P，按 PRD 来）：
//   - 用量数字：df -P -k 输出（-P 为 POSIX 单行格式，不折行、挂载点含空格
//     也能按列切分；-k 固定 1024 字节块——POSIX 下 -P 默认 512 字节块，
//     显式 -k 消除单位歧义）；
//   - 类型与去重键：/proc/self/mountinfo（fstype 用于排除清单，
//     major:minor 用于 bind mount 去重）。
// 排除清单（PRD §5.3「只统计真实块设备」，封闭）：proc、sysfs、tmpfs、
// devtmpfs、overlay、squashfs 及零块设备。其余伪文件系统（cgroup /
// devpts / mqueue 等）df 本身不列出或 total 为 0，被零块规则兜底。
// bind mount 与同设备多挂载点用量完全相同，按 (major:minor) 只留第一个。
//
// 选 mountinfo 而非 /proc/mounts 拿 major:minor 的原因：/proc/mounts 没有
// 该字段；statfs(2) 的 fsid 也能拿到，但要逐挂载点系统调用且
// syscall.Statfs 是 Linux 专属（破坏 Windows 交叉编译与单测）。
// 跨平台取舍同 cpu.go：非 Linux 运行期 df / mountinfo 缺失，降级为空列表
// + 日志（Hub 接受空 disks，不影响其余指标——PRD §5.3）。

package main

import (
	"context"
	"log/slog"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// DiskUsage 单个挂载点用量（字节）；JSON 字段与 AgentReportController
// parseDisks 白名单（mount / used / total）一致
type DiskUsage struct {
	Mount string `json:"mount"`
	Used  uint64 `json:"used"`
	Total uint64 `json:"total"`
}

// dfTimeout df 命令超时：df 对僵死的 NFS 挂载会无限阻塞，采集不能拖垮
// task19 的回传循环
const dfTimeout = 10 * time.Second

// excludedFsTypes 伪文件系统排除清单（PRD §5.3，封闭）
var excludedFsTypes = map[string]bool{
	"proc":     true,
	"sysfs":    true,
	"tmpfs":    true,
	"devtmpfs": true,
	"overlay":  true,
	"squashfs": true,
}

// excludedFsNames df 源名列的兜底排除名：mountinfo 查不到该挂载点（异常）
// 时使用。devtmpfs 在 df 源名列常显示为 udev；squashfs 源名列即 squashfs。
var excludedFsNames = map[string]bool{
	"proc":     true,
	"sysfs":    true,
	"tmpfs":    true,
	"devtmpfs": true,
	"udev":     true,
	"overlay":  true,
	"squashfs": true,
}

// mountInfo /proc/self/mountinfo 中本采集关心的字段
type mountInfo struct {
	// majorMinor "major:minor"：bind mount 去重键（PRD §5.3）
	majorMinor string
	// fsType 文件系统类型：排除清单依据（比 df 源列名权威）
	fsType string
}

// dfEntry df -P -k 输出的一行（未过滤）
type dfEntry struct {
	source string
	total  uint64 // 字节（1024 块 × 1024）
	used   uint64 // 字节
	mount  string
}

// collectDisks 采集磁盘用量：df 拿数字，mountinfo 拿类型与去重键
func collectDisks() []DiskUsage {
	ctx, cancel := context.WithTimeout(context.Background(), dfTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "df", "-P", "-k").Output()
	if err != nil {
		slog.Warn("磁盘采集失败，本次上报空列表", "error", err)
		return []DiskUsage{}
	}
	mounts := readMountinfo()
	return filterDiskEntries(parseDfOutput(string(out)), mounts)
}

// readMountinfo 读 /proc/self/mountinfo，建「挂载点 → major:minor + fstype」表
//
// 行格式（内核 Documentation/filesystems/proc.txt）：
//
//	36 35 98:0 /mnt1 /mnt2 rw,noatime master:1 - ext3 /dev/root rw,errors=continue
//	(1)(2)(3)   (4)   (5)   ...          可选字段...      -  (9)   (10)      (11)
//
// (3) 是 major:minor；(5) 之后到 "-" 分隔符之前是任意长度的可选字段
// （shared:X / master:X / tag:value），故定位 "-" 后再取其后两项（fstype
// 与源设备）。挂载点在 mountinfo 里以八进制转义表示（空格 \040 等），
// 需反转义才能与 df 输出的原始路径对齐。同一挂载点被重复挂载（overmount）
// 时后出现者才是可见的那个（与 df 一致），故后者覆盖前者。
func readMountinfo() map[string]mountInfo {
	data, err := os.ReadFile("/proc/self/mountinfo")
	if err != nil {
		slog.Warn("读取 /proc/self/mountinfo 失败，磁盘去重降级为按名排除", "error", err)
		return nil
	}
	return parseMountinfoContent(string(data))
}

// parseMountinfoContent 解析 /proc/self/mountinfo 内容（纯函数，测试用
// fixture；行格式注释见 readMountinfo）
func parseMountinfoContent(content string) map[string]mountInfo {
	mounts := make(map[string]mountInfo)
	for _, line := range strings.Split(content, "\n") {
		fields := strings.Fields(line)
		sep := -1
		for i, f := range fields {
			if f == "-" {
				sep = i
				break
			}
		}
		// sep < 5 时 fields[4]（挂载点）不存在；sep+2 越界则没有 fstype
		if sep < 5 || sep+2 >= len(fields) {
			continue
		}
		mounts[unescapeMountPath(fields[4])] = mountInfo{
			majorMinor: fields[2],
			fsType:     fields[sep+1],
		}
	}
	return mounts
}

// unescapeMountPath 还原 mountinfo 的八进制转义（\040 空格、\011 制表、
// \012 换行、\134 反斜杠；内核对路径里的这几类字符统一转义，真实路径
// 中的反斜杠一定写成 \134，不会误判）
func unescapeMountPath(s string) string {
	if !strings.Contains(s, `\`) {
		return s
	}
	return strings.NewReplacer(`\040`, " ", `\011`, "\t", `\012`, "\n", `\134`, `\`).Replace(s)
}

// parseDfOutput 解析 df -P -k 输出。表头（含本地化表头）第二列非数字，
// 被 ParseUint 自然跳过。挂载点是最后一列且可能含空格（-P 保证单行不
// 折行），故第 6 列起整体作为挂载点（含多个连续空格时会折叠成一个，
// 真实挂载点几乎不会出现，且 Hub 侧 mount ≤255 字符）。
func parseDfOutput(out string) []dfEntry {
	var entries []dfEntry
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 6 {
			continue
		}
		total, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		used, err := strconv.ParseUint(fields[2], 10, 64)
		if err != nil {
			continue
		}
		entries = append(entries, dfEntry{
			source: fields[0],
			total:  total * 1024,
			used:   used * 1024,
			mount:  strings.Join(fields[5:], " "),
		})
	}
	return entries
}

// filterDiskEntries 应用排除清单与去重（口径集中在此，便于测试）：
//   - 零块设备（total=0）直接排除——cgroup / devpts 等伪文件系统；
//   - mountinfo 有条目：按 fstype 过排除清单，按 (major:minor) 去重，
//     bind mount / 同设备多挂载点只留第一个（PRD §5.3）；
//   - mountinfo 无条目（异常）：按 df 源名列兜底排除，不去重（宁留勿丢）；
//   - 挂载点再防御性去重一次：Hub 对同一快照内重复 mount 拒整包
//     （AgentReportController::parseDisks），df 正常不会重复。
func filterDiskEntries(entries []dfEntry, mounts map[string]mountInfo) []DiskUsage {
	disks := make([]DiskUsage, 0, len(entries))
	seenDevice := make(map[string]bool, len(entries))
	seenMount := make(map[string]bool, len(entries))
	for _, e := range entries {
		if e.total == 0 {
			continue
		}
		if mi, ok := mounts[e.mount]; ok {
			if excludedFsTypes[mi.fsType] {
				continue
			}
			if seenDevice[mi.majorMinor] {
				continue
			}
			seenDevice[mi.majorMinor] = true
		} else if excludedFsNames[e.source] {
			continue
		}
		if seenMount[e.mount] {
			continue
		}
		seenMount[e.mount] = true
		disks = append(disks, DiskUsage{Mount: e.mount, Used: e.used, Total: e.total})
	}
	return disks
}
