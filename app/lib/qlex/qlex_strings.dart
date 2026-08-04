import 'package:flutter/widgets.dart';

/// Small product-specific catalog. New qlex copy is complete in English and
/// Simplified Chinese; every other locale intentionally falls back to English.
class QlexStrings {
  final bool _zh;

  const QlexStrings._(this._zh);

  factory QlexStrings.of(BuildContext context) {
    final locale = Localizations.localeOf(context);
    return QlexStrings._(locale.languageCode.toLowerCase() == 'zh');
  }

  String get nearbyTransfer => _zh ? '局域网文件互传' : 'Local network file transfer';
  String get scanning => _zh ? '正在搜索附近设备' : 'Scanning for nearby devices';
  String get ready => _zh ? '已连接局域网' : 'Connected to local network';
  String get noNetwork => _zh ? '未连接局域网' : 'No local network connection';
  String get noNetworkDetail => _zh ? '请将设备连接到同一 Wi-Fi 或有线网络后重试。' : 'Connect both devices to the same Wi-Fi or wired network, then try again.';
  String get noDevices => _zh ? '暂未发现附近设备' : 'No nearby devices yet';
  String get noDevicesDetail =>
      _zh ? '保持 qlex 或 LocalSend 在另一台设备上打开，或使用手动 IP。' : 'Keep qlex or LocalSend open on the other device, or use a manual IP address.';
  String get rescan => _zh ? '重新扫描' : 'Scan again';
  String get manualIp => _zh ? '手动 IP' : 'Manual IP';
  String get history => _zh ? '接收历史' : 'Receive history';
  String get transfers => _zh ? '传输队列' : 'Transfer queue';
  String get help => _zh ? '使用说明与排障' : 'Help and troubleshooting';
  String get settings => _zh ? '设置' : 'Settings';
  String get thisDevice => _zh ? '本机' : 'This device';
  String get chooseFiles => _zh ? '选择文件' : 'Choose files';
  String get addFiles => _zh ? '继续添加' : 'Add more';
  String get editSelection => _zh ? '编辑选择' : 'Edit selection';
  String get clear => _zh ? '清空' : 'Clear';
  String get selected => _zh ? '已选择' : 'Selected';
  String get dropFiles => _zh ? '松开以添加文件或文件夹' : 'Drop to add files or folders';
  String get tapDevice => _zh ? '点击设备开始发送' : 'Tap a device to start sending';
  String get chooseAfterDevice => _zh ? '先为此设备选择文件' : 'Choose files for this device';
  String get sendConfirm => _zh ? '确认发送' : 'Confirm send';
  String get send => _zh ? '发送' : 'Send';
  String get cancel => _zh ? '取消' : 'Cancel';
  String get targetDevice => _zh ? '目标设备' : 'Target device';
  String get totalSize => _zh ? '总大小' : 'Total size';
  String get fileCount => _zh ? '文件数量' : 'Files';
  String get deviceOffline => _zh ? '设备已离线，请重新扫描。' : 'This device is offline. Scan again.';
  String get textUnsupported => _zh ? 'qlex 仅传输文件，不支持文本消息。' : 'qlex transfers files only. Text messages are not supported.';
  String get overflowDevices => _zh ? '更多设备' : 'More devices';
  String get allDevices => _zh ? '全部附近设备' : 'All nearby devices';
  String get favoriteHint => _zh ? '长按可收藏或取消收藏' : 'Long-press to add or remove a favorite';
  String get noTransfers => _zh ? '当前没有传输任务' : 'No transfer tasks';
  String get aboutLan => _zh ? '所有数据仅在局域网内传输' : 'All data stays on your local network';
  String get openHistory => _zh ? '打开接收历史' : 'Open receive history';
  String filesSelected(int count) => _zh ? '已选择 $count 个文件' : '$count file${count == 1 ? '' : 's'} selected';
}
