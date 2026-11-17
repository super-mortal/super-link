module github.com/super-mortal/super-link/agent

// go 1.23 取保守下限：本地工具链 go1.26.5 向前兼容，CI（task20，
// actions/setup-go）安装 ≥1.23 即可构建；不写更高版本是为避免 runner
// 镜像缺少对应 toolchain 时触发自动下载。
// 零第三方依赖（决策 D2 静态编译零依赖）：采集全部走标准库（/proc、
// net/http、encoding/json），Docker 采集直连 Docker Engine API 不用
// SDK，故本文件没有 require 块。
go 1.23
