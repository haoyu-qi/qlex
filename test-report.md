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
| 差异完整性 | `git diff --check` | 通过 |

qlex 新增测试覆盖雷达空/单/多设备与溢出布局、按指纹稳定排序、深浅主题，以及文本消息拒绝和普通 `.txt` 文件放行。

## 当前环境未执行

- Android release APK：当前 macOS 主机未安装 Android SDK。
- Windows x64 与 Inno Setup：当前主机不是 Windows。
- Android/Windows 真机文件、文件夹、大文件、断网、端口占用和取消/拒绝验证。
- qlex 与 LocalSend 的三组真实互通矩阵。
- 断网抓包确认没有自动公网请求。

以上项目已写入 GitHub Actions 或 `design-qa.md` 验收清单，必须在发布 `0.1.0` 前完成。
