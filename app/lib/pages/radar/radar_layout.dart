import 'dart:math' as math;

import 'package:common/model/device.dart';

class RadarDevicePlacement {
  final Device device;
  final int ring;
  final int slot;
  final double angle;

  const RadarDevicePlacement({required this.device, required this.ring, required this.slot, required this.angle});
}

class RadarLayoutResult {
  final List<RadarDevicePlacement> placements;
  final List<Device> overflow;

  const RadarLayoutResult({required this.placements, required this.overflow});
}

class RadarLayout {
  static const innerCapacity = 4;
  static const outerCapacity = 6;
  static const visibleCapacity = innerCapacity + outerCapacity;

  static List<Device> stableSort(Iterable<Device> devices) {
    final sorted = devices.toList();
    sorted.sort((a, b) {
      final fingerprint = a.fingerprint.compareTo(b.fingerprint);
      return fingerprint != 0 ? fingerprint : a.ip.compareTo(b.ip);
    });
    return List.unmodifiable(sorted);
  }

  static RadarLayoutResult compute(Iterable<Device> devices) {
    final sorted = stableSort(devices);
    final visible = sorted.take(visibleCapacity).toList();
    final innerCount = math.min(innerCapacity, visible.length);
    final outerCount = visible.length - innerCount;
    final placements = <RadarDevicePlacement>[];

    for (var index = 0; index < innerCount; index++) {
      placements.add(RadarDevicePlacement(device: visible[index], ring: 0, slot: index, angle: _angle(index, innerCount, -math.pi / 2)));
    }
    for (var index = 0; index < outerCount; index++) {
      placements.add(
        RadarDevicePlacement(device: visible[innerCount + index], ring: 1, slot: index, angle: _angle(index, outerCount, -math.pi / 2 + math.pi / 6)),
      );
    }

    return RadarLayoutResult(placements: List.unmodifiable(placements), overflow: List.unmodifiable(sorted.skip(visibleCapacity)));
  }

  static double _angle(int index, int count, double start) {
    if (count <= 1) return start;
    return start + (2 * math.pi * index / count);
  }
}
