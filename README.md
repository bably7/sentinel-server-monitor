# Sentinel 服务器监控

一款通过 SSH 采集 Linux 服务器指标的 Windows 桌面监控工具。无需在服务器安装 Agent。

## 功能

- 实时查看 CPU 使用率、核心数和 1/5/15 分钟负载
- 查看内存总量、已用量和占用比例
- 查看各挂载磁盘容量与使用率
- 查看主要进程/项目的 CPU、内存、PID 和完整启动命令
- 多服务器切换，5 秒自动刷新
- 桌面置顶浮窗，突出显示 CPU 和内存占用
- 浮窗支持拖动、折叠、手动刷新和一键打开主面板
- SSH 密码或 OpenSSH 私钥认证
- 凭据通过 Electron `safeStorage` 调用 Windows DPAPI 加密保存
- 内置本机演示节点，安装后可立即预览

## 运行

需要 Node.js 20 或更高版本。

```powershell
npm install
npm start
```

## 打包 Windows 安装程序

```powershell
npm run dist
```

安装程序生成在 `dist` 目录。

## 服务器要求

- Linux 服务器开放 SSH，监控电脑可访问 SSH 端口
- SSH 用户能够执行 `hostname`、`uname`、`awk`、`df`、`ps`、`nproc` 和 `cat`
- 指标读取不需要 root 权限

进程列表默认按 CPU 使用率排序并显示前 15 个进程。应用通过进程名称和启动命令识别主要项目，因此 Node.js、Java、Python、Docker 代理进程和数据库服务都可以直接查看。

## 安全说明

密码和私钥不会发送到监控目标之外。保存时使用当前 Windows 用户的 DPAPI 加密，配置文件位于 Electron 用户数据目录。远程命令仅采集 `/proc`、`df` 与 `ps` 的只读指标。
