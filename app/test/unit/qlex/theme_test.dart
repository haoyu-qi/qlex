import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:localsend_app/config/theme.dart';
import 'package:localsend_app/model/persistence/color_mode.dart';

void main() {
  test('qlex light theme uses fog surface and cyan-derived primary', () {
    final theme = getTheme(ColorMode.localsend, Brightness.light, null);
    expect(theme.scaffoldBackgroundColor, qlexFog);
    expect(theme.colorScheme.primary, const Color(0xFF007C91));
  });

  test('qlex dark theme uses graphite surface and cyan primary', () {
    final theme = getTheme(ColorMode.localsend, Brightness.dark, null);
    expect(theme.scaffoldBackgroundColor, qlexGraphite);
    expect(theme.colorScheme.primary, qlexCyan);
  });
}
