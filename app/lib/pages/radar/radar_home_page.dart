import 'dart:async';
import 'dart:math' as math;

import 'package:collection/collection.dart';
import 'package:common/model/device.dart';
import 'package:flutter/material.dart';
import 'package:localsend_app/model/cross_file.dart';
import 'package:localsend_app/model/send_mode.dart';
import 'package:localsend_app/pages/radar/radar_layout.dart';
import 'package:localsend_app/pages/radar/transfer_queue_page.dart';
import 'package:localsend_app/pages/selected_files_page.dart';
import 'package:localsend_app/pages/tabs/settings_tab.dart';
import 'package:localsend_app/pages/troubleshoot_page.dart';
import 'package:localsend_app/provider/animation_provider.dart';
import 'package:localsend_app/provider/device_info_provider.dart';
import 'package:localsend_app/provider/favorites_provider.dart';
import 'package:localsend_app/provider/local_ip_provider.dart';
import 'package:localsend_app/provider/network/nearby_devices_provider.dart';
import 'package:localsend_app/provider/network/scan_facade.dart';
import 'package:localsend_app/provider/network/send_provider.dart';
import 'package:localsend_app/provider/receive_history_provider.dart';
import 'package:localsend_app/provider/selection/selected_sending_files_provider.dart';
import 'package:localsend_app/provider/settings_provider.dart';
import 'package:localsend_app/qlex/qlex_strings.dart';
import 'package:localsend_app/util/device_type_ext.dart';
import 'package:localsend_app/util/favorites.dart';
import 'package:localsend_app/util/file_size_helper.dart';
import 'package:localsend_app/util/native/file_picker.dart';
import 'package:localsend_app/widget/dialogs/add_file_dialog.dart';
import 'package:localsend_app/widget/dialogs/address_input_dialog.dart';
import 'package:localsend_app/widget/dialogs/favorite_delete_dialog.dart';
import 'package:localsend_app/widget/dialogs/favorite_edit_dialog.dart';
import 'package:refena_flutter/refena_flutter.dart';
import 'package:routerino/routerino.dart';

class RadarHomePage extends StatefulWidget {
  final bool dragActive;

  const RadarHomePage({required this.dragActive, super.key});

  @override
  State<RadarHomePage> createState() => _RadarHomePageState();
}

class _RadarHomePageState extends State<RadarHomePage> with Refena, SingleTickerProviderStateMixin {
  late final AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(vsync: this, duration: const Duration(milliseconds: 1800));
    unawaited(_pulseController.repeat());
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final strings = QlexStrings.of(context);
    final nearbyState = context.watch(nearbyDevicesProvider);
    final localInfo = context.watch(deviceFullInfoProvider);
    final localIps = context.watch(localIpProvider).localIps;
    final selectedFiles = context.watch(selectedSendingFilesProvider);
    final sendSessions = context.watch(sendProvider);
    final history = context.watch(receiveHistoryProvider);
    final animations = context.watch(animationProvider);
    final scanning = nearbyState.runningFavoriteScan || nearbyState.runningIps.isNotEmpty;
    final devices = RadarLayout.stableSort(nearbyState.devices.values);

    return Scaffold(
      body: SafeArea(
        child: Stack(
          children: [
            Column(
              children: [
                _QlexToolbar(scanning: scanning, transferCount: sendSessions.length, historyCount: history.length, onScan: _scan),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Column(
                      children: [
                        _ScanStatus(online: localIps.isNotEmpty, scanning: scanning, strings: strings),
                        const SizedBox(height: 6),
                        Expanded(
                          child: TickerMode(
                            enabled: animations && scanning,
                            child: _Radar(
                              animation: _pulseController,
                              animate: animations && scanning,
                              localDevice: localInfo,
                              devices: devices,
                              onDeviceTap: _onDeviceTap,
                              onDeviceLongPress: _toggleFavorite,
                              onOverflowTap: _showAllDevices,
                            ),
                          ),
                        ),
                        if (devices.isEmpty) _EmptyRadar(online: localIps.isNotEmpty, onScan: _scan, onManualIp: _manualAddress),
                        _SelectionTray(
                          files: selectedFiles,
                          onChoose: _chooseFiles,
                          onEdit: () async => context.push(() => const SelectedFilesPage()),
                          onClear: () => ref.redux(selectedSendingFilesProvider).dispatch(ClearSelectionAction()),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            if (widget.dragActive) const _DropOverlay(),
          ],
        ),
      ),
    );
  }

  Future<void> _scan() async {
    ref.redux(nearbyDevicesProvider).dispatch(ClearFoundDevicesAction());
    await ref.global.dispatchAsync(StartSmartScan(forceLegacy: false));
  }

  Future<void> _chooseFiles() async {
    final options = FilePickerOption.getOptionsForPlatform();
    if (options.length == 1) {
      await ref.global.dispatchAsync(PickFileAction(option: options.first, context: context));
    } else {
      await AddFileDialog.open(context: context, options: options);
    }
  }

  Future<void> _onDeviceTap(Device device) async {
    if (ref.read(selectedSendingFilesProvider).isEmpty) {
      await _chooseFiles();
    }
    if (!mounted || ref.read(selectedSendingFilesProvider).isEmpty) return;

    final current = ref
        .read(nearbyDevicesProvider)
        .devices
        .values
        .firstWhereOrNull((candidate) => candidate.fingerprint == device.fingerprint && candidate.ip == device.ip);
    if (current == null) {
      _showMessage(QlexStrings.of(context).deviceOffline);
      return;
    }
    await _confirmAndSend(current);
  }

  Future<void> _manualAddress() async {
    final device = await showDialog<Device?>(context: context, builder: (_) => const AddressInputDialog());
    if (device == null || !mounted) return;
    if (ref.read(selectedSendingFilesProvider).isEmpty) await _chooseFiles();
    if (!mounted || ref.read(selectedSendingFilesProvider).isEmpty) return;
    await _confirmAndSend(device);
  }

  Future<void> _confirmAndSend(Device device) async {
    final files = ref.read(selectedSendingFilesProvider);
    final strings = QlexStrings.of(context);
    final total = files.fold<int>(0, (sum, file) => sum + file.size);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        icon: Icon(device.deviceType.icon, color: Theme.of(dialogContext).colorScheme.primary),
        title: Text(strings.sendConfirm),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _ConfirmRow(label: strings.targetDevice, value: device.alias),
              _ConfirmRow(label: strings.fileCount, value: '${files.length}'),
              _ConfirmRow(label: strings.totalSize, value: total.asReadableFileSize),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(strings.cancel)),
          FilledButton.icon(onPressed: () => Navigator.pop(dialogContext, true), icon: const Icon(Icons.send_rounded), label: Text(strings.send)),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final multiple = ref.read(settingsProvider).sendMode == SendMode.multiple;
    await ref.notifier(sendProvider).startSession(target: device, files: files, background: multiple);
  }

  Future<void> _toggleFavorite(Device device) async {
    final favorites = ref.read(favoritesProvider);
    final favorite = favorites.findDevice(device);
    if (favorite == null) {
      await showDialog(
        context: context,
        builder: (_) => FavoriteEditDialog(prefilledDevice: device),
      );
      return;
    }
    final remove = await showDialog<bool>(context: context, builder: (_) => FavoriteDeleteDialog(favorite));
    if (remove == true) {
      await ref.redux(favoritesProvider).dispatchAsync(RemoveFavoriteAction(deviceFingerprint: device.fingerprint));
    }
  }

  Future<void> _showAllDevices(List<Device> devices) async {
    final strings = QlexStrings.of(context);
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
          children: [
            Text(strings.allDevices, style: Theme.of(sheetContext).textTheme.titleLarge),
            const SizedBox(height: 8),
            for (final device in devices)
              ListTile(
                leading: Icon(device.deviceType.icon),
                title: Text(device.alias),
                subtitle: Text(device.ip),
                onTap: () async {
                  Navigator.pop(sheetContext);
                  await _onDeviceTap(device);
                },
              ),
          ],
        ),
      ),
    );
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }
}

class _QlexToolbar extends StatelessWidget {
  final bool scanning;
  final int transferCount;
  final int historyCount;
  final VoidCallback onScan;

  const _QlexToolbar({required this.scanning, required this.transferCount, required this.historyCount, required this.onScan});

  @override
  Widget build(BuildContext context) {
    final strings = QlexStrings.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 10, 4),
      child: Row(
        children: [
          Image.asset('assets/img/qlex-mark.png', width: 34, height: 34, filterQuality: FilterQuality.high),
          const SizedBox(width: 9),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('qlex', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.5)),
              Text(strings.nearbyTransfer, style: Theme.of(context).textTheme.labelSmall),
            ],
          ),
          const Spacer(),
          IconButton(
            tooltip: strings.rescan,
            onPressed: onScan,
            icon:
                scanning ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.2)) : const Icon(Icons.radar_rounded),
          ),
          Badge(
            isLabelVisible: transferCount + historyCount > 0,
            label: Text('${transferCount + historyCount}'),
            child: IconButton(
              tooltip: strings.transfers,
              onPressed: () async => context.push(() => const TransferQueuePage()),
              icon: const Icon(Icons.swap_horiz_rounded),
            ),
          ),
          IconButton(
            tooltip: strings.help,
            onPressed: () async => context.push(() => const TroubleshootPage()),
            icon: const Icon(Icons.help_outline_rounded),
          ),
          IconButton(
            tooltip: strings.settings,
            onPressed: () async => context.push(
              () => Scaffold(
                appBar: AppBar(title: Text(strings.settings)),
                body: const SettingsTab(),
              ),
            ),
            icon: const Icon(Icons.settings_rounded),
          ),
        ],
      ),
    );
  }
}

class _ScanStatus extends StatelessWidget {
  final bool online;
  final bool scanning;
  final QlexStrings strings;

  const _ScanStatus({required this.online, required this.scanning, required this.strings});

  @override
  Widget build(BuildContext context) {
    final color = online ? Theme.of(context).colorScheme.primary : Theme.of(context).colorScheme.error;
    return Semantics(
      liveRegion: true,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 8),
          Text(!online ? strings.noNetwork : (scanning ? strings.scanning : strings.ready), style: Theme.of(context).textTheme.labelLarge),
        ],
      ),
    );
  }
}

class _Radar extends StatelessWidget {
  final Animation<double> animation;
  final bool animate;
  final Device localDevice;
  final List<Device> devices;
  final Future<void> Function(Device) onDeviceTap;
  final Future<void> Function(Device) onDeviceLongPress;
  final Future<void> Function(List<Device>) onOverflowTap;

  const _Radar({
    required this.animation,
    required this.animate,
    required this.localDevice,
    required this.devices,
    required this.onDeviceTap,
    required this.onDeviceLongPress,
    required this.onOverflowTap,
  });

  @override
  Widget build(BuildContext context) {
    final layout = RadarLayout.compute(devices);
    return LayoutBuilder(
      builder: (context, constraints) {
        final side = math.min(constraints.maxWidth, constraints.maxHeight).clamp(220.0, 620.0);
        final center = Offset(constraints.maxWidth / 2, constraints.maxHeight / 2);
        final innerRadius = side * 0.25;
        final outerRadius = side * 0.40;
        const nodeSize = 76.0;
        return AnimatedBuilder(
          animation: animation,
          builder: (context, _) {
            final pulse = animate ? animation.value : 0.0;
            return Stack(
              clipBehavior: Clip.none,
              children: [
                Positioned.fill(
                  child: CustomPaint(
                    painter: _RadarPainter(
                      color: Theme.of(context).colorScheme.primary,
                      innerRadius: innerRadius,
                      outerRadius: outerRadius,
                      pulse: pulse,
                    ),
                  ),
                ),
                Positioned(
                  left: center.dx - 49,
                  top: center.dy - 49,
                  child: _LocalNode(device: localDevice),
                ),
                for (final placement in layout.placements)
                  Positioned(
                    left: center.dx + math.cos(placement.angle) * (placement.ring == 0 ? innerRadius : outerRadius) - nodeSize / 2,
                    top: center.dy + math.sin(placement.angle) * (placement.ring == 0 ? innerRadius : outerRadius) - nodeSize / 2,
                    child: _DeviceNode(
                      device: placement.device,
                      onTap: () async => onDeviceTap(placement.device),
                      onLongPress: () async => onDeviceLongPress(placement.device),
                    ),
                  ),
                if (layout.overflow.isNotEmpty)
                  Positioned(
                    right: math.max(0, center.dx - outerRadius - 8),
                    bottom: math.max(0, center.dy - outerRadius - 8),
                    child: _OverflowNode(count: layout.overflow.length, onTap: () async => onOverflowTap(devices)),
                  ),
              ],
            );
          },
        );
      },
    );
  }
}

class _RadarPainter extends CustomPainter {
  final Color color;
  final double innerRadius;
  final double outerRadius;
  final double pulse;

  const _RadarPainter({required this.color, required this.innerRadius, required this.outerRadius, required this.pulse});

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final base = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2
      ..color = color.withValues(alpha: 0.22 + pulse * 0.08);
    _drawDashedCircle(canvas, center, innerRadius + pulse * 3, base);
    _drawDashedCircle(canvas, center, outerRadius + pulse * 5, base..color = color.withValues(alpha: 0.14 + pulse * 0.08));
    canvas.drawCircle(
      center,
      58 + pulse * 7,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 10
        ..color = color.withValues(alpha: 0.06 * (1 - pulse)),
    );
  }

  void _drawDashedCircle(Canvas canvas, Offset center, double radius, Paint paint) {
    const dashes = 72;
    const gap = 0.045;
    final rect = Rect.fromCircle(center: center, radius: radius);
    for (var i = 0; i < dashes; i++) {
      final start = i * 2 * math.pi / dashes;
      canvas.drawArc(rect, start, 2 * math.pi / dashes - gap, false, paint);
    }
  }

  @override
  bool shouldRepaint(_RadarPainter oldDelegate) => oldDelegate.pulse != pulse || oldDelegate.color != color;
}

class _LocalNode extends StatelessWidget {
  final Device device;

  const _LocalNode({required this.device});

  @override
  Widget build(BuildContext context) {
    final strings = QlexStrings.of(context);
    return Semantics(
      label: '${strings.thisDevice}: ${device.alias}',
      child: Container(
        width: 98,
        height: 98,
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: Theme.of(context).colorScheme.surface,
          border: Border.all(color: Theme.of(context).colorScheme.primary, width: 2),
          boxShadow: [BoxShadow(color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.20), blurRadius: 26)],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(device.deviceType.icon, size: 28, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 3),
            Text(
              device.alias,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            Text(strings.thisDevice, style: Theme.of(context).textTheme.labelSmall),
          ],
        ),
      ),
    );
  }
}

class _DeviceNode extends StatelessWidget {
  final Device device;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  const _DeviceNode({required this.device, required this.onTap, required this.onLongPress});

  @override
  Widget build(BuildContext context) {
    final color = _stableDeviceColor(device.fingerprint, Theme.of(context).brightness);
    return Semantics(
      button: true,
      label: '${device.alias}, ${device.deviceType.name}',
      child: Tooltip(
        message: '${device.alias}\n${device.ip}',
        child: InkResponse(
          radius: 48,
          onTap: onTap,
          onLongPress: onLongPress,
          child: SizedBox(
            width: 76,
            height: 76,
            child: Column(
              children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: color.withValues(alpha: 0.18),
                    border: Border.all(color: color, width: 1.5),
                  ),
                  child: Icon(device.deviceType.icon, color: color, size: 26),
                ),
                const SizedBox(height: 3),
                Text(
                  device.alias,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _OverflowNode extends StatelessWidget {
  final int count;
  final VoidCallback onTap;

  const _OverflowNode({required this.count, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: '${QlexStrings.of(context).overflowDevices}: $count',
      child: InkResponse(
        onTap: onTap,
        radius: 36,
        child: CircleAvatar(
          radius: 27,
          backgroundColor: Theme.of(context).colorScheme.secondaryContainer,
          child: Text('+$count', style: const TextStyle(fontWeight: FontWeight.w800)),
        ),
      ),
    );
  }
}

class _EmptyRadar extends StatelessWidget {
  final bool online;
  final VoidCallback onScan;
  final VoidCallback onManualIp;

  const _EmptyRadar({required this.online, required this.onScan, required this.onManualIp});

  @override
  Widget build(BuildContext context) {
    final strings = QlexStrings.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        children: [
          Text(online ? strings.noDevices : strings.noNetwork, style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 2),
          Text(online ? strings.noDevicesDetail : strings.noNetworkDetail, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            alignment: WrapAlignment.center,
            children: [
              OutlinedButton.icon(onPressed: onScan, icon: const Icon(Icons.refresh_rounded), label: Text(strings.rescan)),
              TextButton.icon(onPressed: onManualIp, icon: const Icon(Icons.pin_drop_outlined), label: Text(strings.manualIp)),
            ],
          ),
        ],
      ),
    );
  }
}

class _SelectionTray extends StatelessWidget {
  final List<CrossFile> files;
  final VoidCallback onChoose;
  final VoidCallback onEdit;
  final VoidCallback onClear;

  const _SelectionTray({required this.files, required this.onChoose, required this.onEdit, required this.onClear});

  @override
  Widget build(BuildContext context) {
    final strings = QlexStrings.of(context);
    if (files.isEmpty) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(0, 4, 0, 12),
        child: FilledButton.icon(onPressed: onChoose, icon: const Icon(Icons.add_rounded), label: Text(strings.chooseFiles)),
      );
    }
    final size = files.fold<int>(0, (sum, file) => sum + file.size);
    return Card(
      margin: const EdgeInsets.fromLTRB(0, 4, 0, 12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: Theme.of(context).colorScheme.primaryContainer,
              child: Icon(Icons.folder_copy_rounded, color: Theme.of(context).colorScheme.onPrimaryContainer),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(strings.filesSelected(files.length), style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text(
                    '${size.asReadableFileSize} · ${strings.tapDevice}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            IconButton(tooltip: strings.addFiles, onPressed: onChoose, icon: const Icon(Icons.add_rounded)),
            IconButton(tooltip: strings.editSelection, onPressed: onEdit, icon: const Icon(Icons.edit_outlined)),
            IconButton(tooltip: strings.clear, onPressed: onClear, icon: const Icon(Icons.close_rounded)),
          ],
        ),
      ),
    );
  }
}

class _DropOverlay extends StatelessWidget {
  const _DropOverlay();

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: ColoredBox(
        color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.94),
        child: Center(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 36, vertical: 30),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: Theme.of(context).colorScheme.primary, width: 2),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.file_download_outlined, size: 72, color: Theme.of(context).colorScheme.primary),
                const SizedBox(height: 12),
                Text(QlexStrings.of(context).dropFiles, style: Theme.of(context).textTheme.titleMedium),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ConfirmRow extends StatelessWidget {
  final String label;
  final String value;

  const _ConfirmRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Expanded(child: Text(label, style: Theme.of(context).textTheme.bodyMedium)),
          const SizedBox(width: 16),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

Color _stableDeviceColor(String fingerprint, Brightness brightness) {
  var hash = 0x811c9dc5;
  for (final unit in fingerprint.codeUnits) {
    hash ^= unit;
    hash = (hash * 0x01000193) & 0xffffffff;
  }
  final hue = (hash % 360).toDouble();
  return HSVColor.fromAHSV(1, hue, brightness == Brightness.dark ? 0.62 : 0.74, brightness == Brightness.dark ? 0.92 : 0.68).toColor();
}
