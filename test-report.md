# qlex v0.1.0 测试报告

日期：2026-08-04  
基线：LocalSend v1.17.0 (`7f21d1f9082a43803e05c37f021912e012145aa5`)  
工具链：Flutter 3.41.9 / Dart 3.11.5

## 已完成的自动化验证

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| qlex 格式检查 | `dart format --line-length 150 --output=none --set-exit-if-changed lib/pages/radar lib/qlex test/unit/qlex` | 通过，0 个文件需修改 |
| App 静态分析 | `flutter analyze --no-fatal-infos` | 通过，无 error/warning；保留 15 条上游 info |
| App 全量测试 | `flutter test` | 通过，60/60 |
| Shared LAN 静态分析 | `dart analyze` | 通过；保留 4 条上游 info |
| Shared LAN 测试 | `dart test` | 通过，7/7 |
| Windows x64 release 构建 | GitHub Actions / Flutter 3.41.9 | 通过 |
| Windows Inno Setup 安装包 | GitHub Actions / Inno Setup 6 | 通过，未签名安装包已上传并下载校验 |
| 差异完整性 | `git diff --check` | 通过 |

qlex 新增测试覆盖雷达空/单/多设备与溢出布局、按指纹稳定排序、深浅主题，以及文本消息拒绝和普通 `.txt` 文件放行。

## 未完成与暂缓项目

- Android release APK：分析与 60 项 Flutter 测试通过，但 release 原生构建仍未通过；按当前交付决定停止继续修复，未产出 APK。
- Android/Windows 真机文件、文件夹、大文件、断网、端口占用和取消/拒绝验证。
- qlex 与 LocalSend 的三组真实互通矩阵。
- 断网抓包确认没有自动公网请求。

Windows 安装包为测试交付包，未签名，Windows 可能显示 SmartScreen 提示。上述未完成项目仍保留在 GitHub Actions 或 `design-qa.md` 验收清单中；在正式发布 Android 版本或宣称完整 `0.1.0` 验收通过前必须补齐。
