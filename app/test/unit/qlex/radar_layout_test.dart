import 'package:common/model/device.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:localsend_app/pages/radar/radar_layout.dart';

void main() {
  Device device(int index, {String? fingerprint}) => Device(
        ip: '192.168.1.${index + 2}',
        version: '2.1',
        port: 53317,
        https: true,
        fingerprint: fingerprint ?? 'fingerprint-${index.toString().padLeft(2, '0')}',
        alias: 'Device $index',
        deviceModel: null,
        deviceType: DeviceType.desktop,
        download: false,
      );

  test('empty radar has no placements or overflow', () {
    final result = RadarLayout.compute(const []);
    expect(result.placements, isEmpty);
    expect(result.overflow, isEmpty);
  });

  test('one device is placed on the inner ring', () {
    final result = RadarLayout.compute([device(0)]);
    expect(result.placements, hasLength(1));
    expect(result.placements.single.ring, 0);
  });

  test('devices are stable-sorted by fingerprint', () {
    final result = RadarLayout.compute([device(0, fingerprint: 'c'), device(1, fingerprint: 'a'), device(2, fingerprint: 'b')]);
    expect(result.placements.map((entry) => entry.device.fingerprint), ['a', 'b', 'c']);
  });

  test('layout uses two rings and exposes overflow', () {
    final result = RadarLayout.compute(List.generate(14, device));
    expect(result.placements, hasLength(RadarLayout.visibleCapacity));
    expect(result.placements.where((entry) => entry.ring == 0), hasLength(RadarLayout.innerCapacity));
    expect(result.placements.where((entry) => entry.ring == 1), hasLength(RadarLayout.outerCapacity));
    expect(result.overflow, hasLength(4));
  });
}
