# qlex

qlex 是一个专注于 Android 与 Windows 的局域网文件互传客户端。它基于
[LocalSend v1.17.0](https://github.com/localsend/localsend/releases/tag/v1.17.0)
修改，保留 LocalSend v2 HTTPS 文件传输和 v2.1 UDP 组播发现协议，因此可以与
原版 LocalSend 在同一局域网中互相发现并收发文件。

qlex 只提供文件传输：没有账号、云端中继、公网信令、文本聊天、Web Send、捐赠、
应用内购买或自动更新。核心收发功能无需互联网。

## v0.1.0 范围

- Android：`com.qlex.transfer`
- Windows：`qlex.exe`
- 默认端口：TCP/UDP `53317`
- 接收默认逐次确认，快速接收默认关闭
- 文件、文件夹、多文件、Windows 拖放、收藏设备、手动 IP、托盘、自启动和右键发送
- 统一雷达首页，支持“先选文件后选设备”和“先选设备后选文件”
- 简体中文、英文 qlex 新增文案；其他语言沿用上游并回退英文

完整行为与验收标准见 [Product-Spec.md](Product-Spec.md)。

## 构建

需要 Flutter `3.41.9`、Java 17，以及 Android 或 Windows 对应平台工具链。

```bash
cd app
flutter pub get
flutter test
flutter build apk --release
```

Windows：

```powershell
cd app
flutter pub get
flutter build windows --release
cd ..
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" scripts\compile_windows_exe-inno.iss
```

GitHub Actions 会生成：

- `qlex-0.1.0-android-universal.apk`
- `qlex-0.1.0-windows-x64-setup.exe`

v0.1.0 的 Android CI 包使用测试签名；Windows 安装包未签名，首次安装可能显示
Microsoft Defender SmartScreen 提示。这些包不是应用商店正式签名版本。

## 上游同步

仓库保留 LocalSend 为 `upstream`：

```bash
git fetch upstream
git merge upstream/main
```

合并上游时应优先保留 LocalSend 协议兼容性，并重新检查 qlex 的产品层裁剪、包名、
数据目录和雷达首页。

## 许可证与归属

本项目采用 [Apache License 2.0](LICENSE)。qlex 基于 LocalSend 修改；原始 LocalSend
项目及其贡献者的版权归各自权利人所有。详见 [NOTICE.md](NOTICE.md)。
